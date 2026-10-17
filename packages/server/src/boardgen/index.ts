/**
 * Board generation (ADR-0003): sealed RNG draw, special-tile composition,
 * placement with the no-adjacent-multi constraint, solvability gate and
 * the `isFormable` submission mirror. Server-only; the browser never builds
 * a board.
 */
import {
  type Board,
  TILE_BAG,
  EITHER_OR_MENU,
  PREFIX_MENU,
  SUFFIX_MENU,
  PROTOCOL,
  isDigram,
  isMulti,
  isPrefix,
  isSuffix,
  neighbors,
  tileStrings,
  type Tile,
} from "@wortschatz/shared";
import { makeRng, type Rng } from "./rng.js";

/** Solvability gate, frozen by simulation (ADR-0003 §7). */
export const GATE = {
  minWords: 40,
  minWordsLen5: 14,
  minWordsLen7: 2,
} as const;

/** Max draw attempts before ranking fallback. */
export const MAX_BOARD_ATTEMPTS = 200;

/** ~5 special/multi-letter slots per board (ADR-0003 §6; capped by 8-way feasibility). */
const MULTI_SLOTS = 5;

export interface BoardResult {
  board: Board;
  /** The enumerated distinct-word list; stored in round state (ADR-0003 §9). */
  words: string[];
}

export type BoardDict = { findWords(board: Board): string[] };

export function generateBoard(seed: bigint, dict: BoardDict): BoardResult {
  const rng = makeRng(seed);
  let best: { board: Board; words: string[]; rank: [number, number] } | null = null;

  for (let attempt = 0; attempt < MAX_BOARD_ATTEMPTS; attempt++) {
    const board = drawBoard(rng);
    // The dictionary enumerates constraint-obliviously; special-tile
    // positioning is applied here by post-filtering (spec #14, ADR-0003 §8).
    const words = dict
      .findWords(board)
      .filter((w) => isFormable(w, board))
      .sort();
    if (passesGate(words)) return { board, words };
    const rank: [number, number] = [words.filter((w) => w.length >= 5).length, words.length];
    if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1])) {
      best = { board, words, rank };
    }
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
/* Draw                                                                   */
/* --------------------------------------------------------------------- */

function expandBag(): Tile[] {
  const out: Tile[] = [];
  for (const [tile, count] of Object.entries(TILE_BAG)) {
    for (let i = 0; i < count; i++) out.push(tile);
  }
  return out;
}

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

/** Indices of the tiles satisfying a predicate (multi slots, upgrade slots). */
function indicesWhere(tiles: Tile[], pred: (t: Tile) => boolean): number[] {
  const out: number[] = [];
  tiles.forEach((t, i) => {
    if (pred(t)) out.push(i);
  });
  return out;
}

const DIGRAM_UPGRADES = Object.entries(TILE_BAG)
  .filter(([t]) => isDigram(t))
  .map(([t]) => t);

function drawBoard(rng: Rng): Board {
  const bag = shuffle(expandBag(), rng);
  let tiles: Tile[] = bag.slice(0, PROTOCOL.BOARD_SIZE);

  // Queen-graph feasibility: at most 4 multi-letter tiles can sit on a 4×4
  // with no 8-way adjacency. Excess drawn multis are traded for singles from
  // the unused bag tail, preserving the draw's letter distribution.
  const replaceExcessMultis = (tiles: Tile[]): Tile[] => {
    const multiIdx = indicesWhere(tiles, isMulti);
    if (multiIdx.length <= MAX_MULTI) return tiles;
    const candidates = bag.slice(PROTOCOL.BOARD_SIZE).filter((t) => !isMulti(t) && !tiles.includes(t));
    shuffle(candidates, rng);
    const result = [...tiles];
    for (let i = 0; i < multiIdx.length - MAX_MULTI; i++) {
      result[multiIdx[i]!] = candidates[i % candidates.length] ?? "e";
    }
    return result;
  };
  tiles = replaceExcessMultis(tiles);

  // Special-tile composition (ADR-0003 §6): 0–1 either/or weighted to usually
  // appear, 0–2 prefixes, 0–2 suffixes; the ~5 slots' remainder fills with
  // the digrams the draw already produced (upgrading single tiles otherwise),
  // always within the 4-multi feasibility cap.
  const either = rng.range(4) !== 0;
  const prefixes = rng.range(3);
  const suffixes = rng.range(3);
  const digramTarget = MULTI_SLOTS - (either ? 1 : 0) - prefixes - suffixes;
  const multis = tiles.filter((t) => isMulti(t)).length;
  const extraDigrams = Math.max(
    0,
    Math.min(digramTarget - multis, MAX_MULTI - multis - (either ? 1 : 0) - prefixes - suffixes)
  );

  const upgrades: Tile[] = [];
  if (either && multis + 1 <= MAX_MULTI) {
    upgrades.push(EITHER_OR_MENU[rng.range(EITHER_OR_MENU.length)]!);
  }
  for (let i = 0; i < prefixes && multis + upgrades.length < MAX_MULTI; i++) {
    upgrades.push(PREFIX_MENU[rng.range(PREFIX_MENU.length)]!);
  }
  for (let i = 0; i < suffixes && multis + upgrades.length < MAX_MULTI; i++) {
    upgrades.push(SUFFIX_MENU[rng.range(SUFFIX_MENU.length)]!);
  }
  for (let i = 0; i < extraDigrams && multis + upgrades.length < MAX_MULTI; i++) {
    upgrades.push(DIGRAM_UPGRADES[rng.range(DIGRAM_UPGRADES.length)]!);
  }

  const singleIdx = indicesWhere(tiles, (t) => !isMulti(t));
  if (singleIdx.length >= upgrades.length) {
    shuffle(singleIdx, rng);
    for (let i = 0; i < upgrades.length; i++) {
      tiles[singleIdx[i]!] = upgrades[i]!;
    }
  }

  return place(tiles, rng);
}

/** 8-way feasibility cap: max independent cells on the 4×4 king graph. */
const MAX_MULTI = 4;

/** Assign tiles to cells so no two multi-letter tiles touch (all 8-way). */
function place(tiles: Tile[], rng: Rng): Board {
  const multi = countMulti(tiles);
  if (multi <= 1) return shuffle([...tiles], rng);

  // Greedy independent-set placement: multis claim cells first (with
  // rejection only against placed multis), singles fill the rest in random
  // order. Nearly always succeeds outright at ≤ 4 multis.
  const board: (Tile | undefined)[] = new Array(PROTOCOL.BOARD_SIZE).fill(undefined);
  const freeCells: number[] = shuffle(
    Array.from({ length: PROTOCOL.BOARD_SIZE }, (_, i) => i),
    rng
  );
  const multis: Tile[] = [];
  const singles: Tile[] = [];
  for (const t of tiles) (isMulti(t) ? multis : singles).push(t);

  for (const t of multis) {
    if (!assignMulti(board, freeCells, t, rng)) return placeFallback(tiles);
  }
  shuffle(singles, rng);
  for (const t of singles) {
    const cell = freeCells.pop();
    if (cell !== undefined) board[cell] = t;
  }
  return board.map((t) => t ?? "e");
}

/** Claim a non-adjacent free cell for one multi tile. */
function assignMulti(board: (Tile | undefined)[], freeCells: number[], t: Tile, rng: Rng): boolean {
  for (let tries = 0; tries < 64 && freeCells.length > 0; tries++) {
    const pickIdx = rng.range(freeCells.length);
    const cell = freeCells[pickIdx]!;
    let blocked = false;
    for (const nb of NEIGHBOR_CACHE[cell]!) {
      const placed = board[nb];
      if (placed !== undefined && isMulti(placed)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      board[cell] = t;
      freeCells.splice(pickIdx, 1);
      return true;
    }
    freeCells.splice(pickIdx, 1);
    freeCells.push(cell); // keep the blocked cell eligible for singles later
  }
  return false;
}

/** Corner cells pairwise non-adjacent under 8-way movement. */
const CORNERS = [0, 2, 8, 10];

function placeFallback(tiles: Tile[]): Board {
  const board: (Tile | undefined)[] = new Array(PROTOCOL.BOARD_SIZE).fill(undefined);
  const multi = tiles.filter((t) => isMulti(t));
  const single = tiles.filter((t) => !isMulti(t));
  multi.forEach((t, i) => {
    if (i < CORNERS.length) board[CORNERS[i]!] = t;
  });
  for (const t of single) {
    const i = board.indexOf(undefined);
    if (i >= 0) board[i] = t;
  }
  return board.map((t) => t ?? "e");
}

function countMulti(tiles: Tile[]): number {
  return tiles.filter((t) => isMulti(t)).length;
}

const NEIGHBOR_CACHE: number[][] = Array.from({ length: PROTOCOL.BOARD_SIZE }, (_, i) => neighbors(i));

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
  const w = word.normalize("NFC").toLowerCase();
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
