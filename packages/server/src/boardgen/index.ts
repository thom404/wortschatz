/**
 * Board generation (ADR-0003): sealed RNG draw, one-special composition,
 * placement with the no-adjacent-twins constraint, solvability gate,
 * board variety, per-cell coverage and the `isFormable` submission mirror.
 * Server-only; the browser never builds a board.
 */
import {
  type Board,
  TILE_BAG,
  EITHER_OR_MENU,
  PREFIX_MENU,
  SUFFIX_MENU,
  PROTOCOL,
  isDigram,
  isEitherOr,
  isMulti,
  isPrefix,
  isSuffix,
  neighbors,
  tileStrings,
  type Tile,
} from "@wortschatz/shared";
import { normalizeWord } from "../text.js";
import { makeRng, type Rng } from "./rng.js";

/** Solvability gate, frozen by simulation (ADR-0003 §7). */
export const GATE = {
  minWords: 40,
  minWordsLen5: 14,
  minWordsLen7: 2,
} as const;

/** Max draw attempts before ranking fallback. */
export const MAX_BOARD_ATTEMPTS = 200;

/** Max copies of any single-letter tile on a board (ADR-0003 #148). */
export const MAX_SINGLE_COPIES = 3;

/** Distinct words each cell must be usable in (ADR-0003 #148). */
export const COVERAGE_THRESHOLD = 3;

/** Special-tile type weights: digram 9, either/or 2, prefix 2, suffix 2. */
const SPECIAL_WEIGHT_TOTAL = 15;
const DIGRAM_WEIGHT = 9;
const EITHER_OR_WEIGHT = 2;
const PREFIX_WEIGHT = 2;

export interface BoardResult {
  board: Board;
  /** The enumerated distinct-word list; stored in round state (ADR-0003 §9). */
  words: string[];
}

export type BoardDict = { findWords(board: Board): string[] };

export function generateBoard(seed: bigint, dict: BoardDict): BoardResult {
  const rng = makeRng(seed);
  let best: { board: Board; words: string[]; rank: Rank } | null = null;

  for (let attempt = 0; attempt < MAX_BOARD_ATTEMPTS; attempt++) {
    const board = drawBoard(rng);
    // The dictionary enumerates constraint-obliviously; special-tile
    // positioning is applied here by post-filtering (spec #14, ADR-0003 §8).
    const words = dict
      .findWords(board)
      .filter((w) => isFormable(w, board))
      .sort();
    const gate = passesGate(words);
    const coverage = passesCoverage(board, words);
    const variety = passesVariety(board);
    if (gate && coverage && variety) return { board, words };

    const rank: Rank = [
      gate ? 1 : 0,
      coverage ? 1 : 0,
      variety ? 1 : 0,
      words.filter((w) => w.length >= 5).length,
      words.length,
    ];
    if (!best || compareRank(rank, best.rank) > 0) best = { board, words, rank };
  }
  return { board: best!.board, words: best!.words };
}

export function passesGate(words: string[]): boolean {
  return (
    words.length >= GATE.minWords &&
    words.filter((w) => w.length >= 5).length >= GATE.minWordsLen5 &&
    words.filter((w) => w.length >= 7).length >= GATE.minWordsLen7
  );
}

/* --------------------------------------------------------------------- */
/* Variety                                                                */
/* --------------------------------------------------------------------- */

/** A special tile is any cell that is not a plain single letter (either/or included). */
function isSpecial(tile: Tile): boolean {
  return isMulti(tile) || isEitherOr(tile);
}

/**
 * Board variety (ADR-0003 #148): at most three copies of any single-letter
 * tile, exactly one special tile, and no two identical tiles 8-way adjacent.
 * Comparison is exact; letters inside a special do not count toward the
 * single-letter cap.
 */
export function passesVariety(board: Board): boolean {
  let specials = 0;
  const singles = new Map<Tile, number>();

  for (const tile of board) {
    if (isSpecial(tile)) {
      specials += 1;
    } else {
      const count = (singles.get(tile) ?? 0) + 1;
      if (count > MAX_SINGLE_COPIES) return false;
      singles.set(tile, count);
    }
  }
  if (specials !== 1) return false;

  for (let i = 0; i < board.length; i++) {
    for (const nb of NEIGHBOR_CACHE[i] ?? []) {
      if (nb > i && board[nb] === board[i]) return false;
    }
  }
  return true;
}

/* --------------------------------------------------------------------- */
/* Coverage                                                               */
/* --------------------------------------------------------------------- */

/**
 * How many distinct words each cell can take part in. A word counts once per
 * cell even when several valid paths use that cell. `stopAt` caps each count
 * so the acceptance loop can stop as soon as every cell has reached the
 * threshold (ADR-0003 #148).
 */
export function coverageCounts(board: Board, words: string[], stopAt = Infinity): number[] {
  const counts = new Array<number>(PROTOCOL.BOARD_SIZE).fill(0);
  for (const word of words) {
    for (const cell of cellsUsedByWord(word, board)) {
      counts[cell] = Math.min((counts[cell] ?? 0) + 1, stopAt);
    }
    if (counts.every((n) => n >= stopAt)) break;
  }
  return counts;
}

/** True iff every cell is usable in at least `threshold` distinct words. */
export function passesCoverage(board: Board, words: string[], threshold = COVERAGE_THRESHOLD): boolean {
  return coverageCounts(board, words, threshold).every((n) => n >= threshold);
}

/**
 * Cells that appear in at least one valid path spelling `word`. Mirrors the
 * `isFormable` path rules; returns every cell across every valid path so the
 * coverage metric can count a word once per cell.
 */
function cellsUsedByWord(word: string, board: Board): number[] {
  const w = normalizeWord(word);
  if (w.length < 3) return [];
  const used = new Array<boolean>(PROTOCOL.BOARD_SIZE).fill(false);
  const path: number[] = [];
  const cells = new Set<number>();

  const match = (pos: number, cell: number): void => {
    const t = board[cell];
    if (t === undefined) return;
    if (isPrefix(t) && pos > 0) return; // word-start only
    for (const cand of tileStrings(t)) {
      if (!w.startsWith(cand, pos)) continue;
      const end = pos + cand.length;
      if (isSuffix(t) && end !== w.length) continue; // word-end only
      if (end === w.length) {
        cells.add(cell);
        for (const p of path) cells.add(p);
        continue;
      }
      used[cell] = true;
      path.push(cell);
      for (const nb of NEIGHBOR_CACHE[cell] ?? []) {
        if (!used[nb]) match(end, nb);
      }
      path.pop();
      used[cell] = false;
    }
  };

  for (let c = 0; c < PROTOCOL.BOARD_SIZE; c++) {
    used.fill(false);
    path.length = 0;
    match(0, c);
  }
  return [...cells];
}

/* --------------------------------------------------------------------- */
/* Draw                                                                   */
/* --------------------------------------------------------------------- */

/** Single-letter entries of the committed inventory, one entry per copy. */
function expandSingles(): Tile[] {
  const out: Tile[] = [];
  for (const [tile, count] of Object.entries(TILE_BAG)) {
    if (isMulti(tile)) continue;
    for (let i = 0; i < count; i++) out.push(tile);
  }
  return out;
}

/** Digram menu: every digram entry of the committed inventory. */
const DIGRAM_MENU = Object.keys(TILE_BAG).filter((t) => isDigram(t));

function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.range(i + 1);
    const a = arr[i]!,
      b = arr[j]!;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

/** Weighted special-tile draw: digram 9/15, then 2/15 for each other type. */
function drawSpecial(rng: Rng): Tile {
  const roll = rng.range(SPECIAL_WEIGHT_TOTAL);
  if (roll < DIGRAM_WEIGHT) return DIGRAM_MENU[rng.range(DIGRAM_MENU.length)]!;
  if (roll < DIGRAM_WEIGHT + EITHER_OR_WEIGHT) {
    return EITHER_OR_MENU[rng.range(EITHER_OR_MENU.length)]!;
  }
  if (roll < DIGRAM_WEIGHT + EITHER_OR_WEIGHT + PREFIX_WEIGHT) {
    return PREFIX_MENU[rng.range(PREFIX_MENU.length)]!;
  }
  return SUFFIX_MENU[rng.range(SUFFIX_MENU.length)]!;
}

/** 15 singles drawn without replacement + exactly one special. */
function drawBoard(rng: Rng): Board {
  const special = drawSpecial(rng);
  const singles = shuffle(expandSingles(), rng).slice(0, PROTOCOL.BOARD_SIZE - 1);
  return place([special, ...singles], rng);
}

/**
 * Assign tiles to cells so no two identical tiles touch (all 8-way).
 * Greedy most-frequent-first placement; with the variety cap the retry
 * almost always succeeds on the first shuffled cell order.
 */
function place(tiles: Tile[], rng: Rng): Board {
  const frequencies = new Map<Tile, number>();
  for (const t of tiles) frequencies.set(t, (frequencies.get(t) ?? 0) + 1);

  for (let attempt = 0; attempt < 64; attempt++) {
    const board: (Tile | undefined)[] = new Array(PROTOCOL.BOARD_SIZE).fill(undefined);
    const cells = shuffle(
      Array.from({ length: PROTOCOL.BOARD_SIZE }, (_, i) => i),
      rng
    );
    const ordered = shuffle([...tiles], rng).sort(
      (a, b) => (frequencies.get(b) ?? 0) - (frequencies.get(a) ?? 0)
    );

    let placed = true;
    for (const t of ordered) {
      let cell: number | undefined;
      for (const candidate of cells) {
        if (board[candidate] !== undefined) continue;
        if (NEIGHBOR_CACHE[candidate]!.some((nb) => board[nb] === t)) continue;
        cell = candidate;
        break;
      }
      if (cell === undefined) {
        placed = false;
        break;
      }
      board[cell] = t;
    }
    if (placed) return board.map((t) => t ?? "e");
  }
  return placeFallback(tiles);
}

/** Corner cells pairwise non-adjacent under 8-way movement. */
const CORNERS = [0, 2, 8, 10];

function placeFallback(tiles: Tile[]): Board {
  const board: (Tile | undefined)[] = new Array(PROTOCOL.BOARD_SIZE).fill(undefined);
  const ordered = [...tiles].sort(
    (a, b) => tiles.filter((t) => t === b).length - tiles.filter((t) => t === a).length
  );
  ordered.forEach((t, i) => {
    const preferred = CORNERS[i];
    const cell =
      preferred !== undefined && board[preferred] === undefined ? preferred : board.indexOf(undefined);
    if (cell >= 0) board[cell] = t;
  });
  return board.map((t) => t ?? "e");
}

const NEIGHBOR_CACHE: number[][] = Array.from({ length: PROTOCOL.BOARD_SIZE }, (_, i) => neighbors(i));

/* --------------------------------------------------------------------- */
/* Fallback ranking                                                       */
/* --------------------------------------------------------------------- */

type Rank = [gate: number, coverage: number, variety: number, len5: number, total: number];

function compareRank(a: Rank, b: Rank): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return 0;
}

/* --------------------------------------------------------------------- */
/* Submission mirror (ADR-0003 §8)                                        */
/* --------------------------------------------------------------------- */

/**
 * True iff `word` is spellable on `board` along an 8-way path, each tile at
 * most once, honoring prefix-start/suffix-end and either/or variants. The
 * mirror of `Dictionary.findWords` (tile rules live here, NOT membership —
 * that stays `Dictionary.isValid` per ADR-0001).
 */
export function isFormable(word: string, board: Board): boolean {
  const w = normalizeWord(word);
  if (w.length < 3) return false;
  const used = new Array<boolean>(PROTOCOL.BOARD_SIZE).fill(false);

  const match = (pos: number, cell: number): boolean => {
    const t = board[cell];
    if (t === undefined) return false;
    if (isPrefix(t) && pos > 0) return false; // word-start only
    for (const cand of tileStrings(t)) {
      if (!w.startsWith(cand, pos)) continue;
      const end = pos + cand.length;
      if (isSuffix(t)) {
        if (end !== w.length) continue; // word-end only
        return true;
      }
      if (end === w.length) return true;
      used[cell] = true;
      for (const nb of NEIGHBOR_CACHE[cell] ?? []) {
        if (!used[nb] && match(end, nb)) {
          used[cell] = false;
          return true;
        }
      }
      used[cell] = false;
    }
    return false;
  };

  for (let c = 0; c < PROTOCOL.BOARD_SIZE; c++) {
    used.fill(false);
    used[c] = true;
    if (match(0, c)) return true;
  }
  return false;
}
