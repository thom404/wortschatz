import { beforeAll, describe, expect, it } from "vitest";
import {
  EITHER_OR_MENU,
  PREFIX_MENU,
  SUFFIX_MENU,
  TILE_BAG,
  isDigram,
  neighbors,
  tileKind,
  type Board,
} from "@wortschatz/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COVERAGE_THRESHOLD,
  MAX_SINGLE_COPIES,
  coverageCounts,
  generateBoard,
  isFormable,
  passesCoverage,
  passesGate,
  passesVariety,
  type BoardResult,
} from "../src/boardgen/index.js";
import { createDictionary } from "../src/dictionary/index.js";
import { defaultExclusionsPath, defaultWordsPath } from "../src/dictionary/loader.js";

/** Fixture-dictionary twin for the pure boardgen seam. */
const FIXTURE_WORDS = readFileSync(join(import.meta.dirname, "fixtures", "words.txt"), "utf8")
  .split("\n")
  .filter(Boolean);
const fixtureDictionary = createDictionary(FIXTURE_WORDS);

/** Full committed word list, as production uses it. */
const FULL_WORDS = readFileSync(defaultWordsPath(), "utf8").split("\n");
const FULL_EXCLUSIONS = readFileSync(defaultExclusionsPath(), "utf8").split("\n");
const fullDictionary = createDictionary(FULL_WORDS, FULL_EXCLUSIONS);

const DIGRAM_MENU = Object.keys(TILE_BAG).filter((t) => isDigram(t));
const SPECIAL_MENU = new Set<string>([...DIGRAM_MENU, ...EITHER_OR_MENU, ...PREFIX_MENU, ...SUFFIX_MENU]);

const isSingleTile = (t: string): boolean => tileKind(t) === "single";
const isSpecialTile = (t: string): boolean => !isSingleTile(t);

/** A board with every cell filled with `x`, then the given overrides. */
function boardWith(overrides: Array<[number, string]>): Board {
  const board = new Array<string>(16).fill("x");
  for (const [cell, tile] of overrides) board[cell] = tile;
  return board;
}

describe("generateBoard", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a1 = generateBoard(1n, fixtureDictionary);
    const a2 = generateBoard(1n, fixtureDictionary);
    const b = generateBoard(2n, fixtureDictionary);
    expect(a1.board).toEqual(a2.board);
    expect(a1.words).toEqual(a2.words);
    expect(a1.board).not.toEqual(b.board);
  });

  it("returns 16 cells: 15 singles from the inventory and one special from a menu", () => {
    const { board } = generateBoard(7n, fixtureDictionary);
    expect(board).toHaveLength(16);
    expect(board.filter(isSpecialTile)).toHaveLength(1);
    for (const t of board) {
      if (isSingleTile(t)) {
        expect(TILE_BAG[t], t).toBeGreaterThan(0);
      } else {
        expect(SPECIAL_MENU.has(t), t).toBe(true);
      }
    }
  });

  it("draws special types across all four menus with digrams most often", () => {
    const kinds = PROPERTY_BOARDS.flatMap(({ board }) => board.filter(isSpecialTile).map((t) => tileKind(t)));
    const counts = {
      digram: kinds.filter((k) => k === "digram").length,
      either: kinds.filter((k) => k === "either-or").length,
      prefix: kinds.filter((k) => k === "prefix").length,
      suffix: kinds.filter((k) => k === "suffix").length,
    };
    expect(counts.digram).toBeGreaterThan(0);
    expect(counts.either).toBeGreaterThan(0);
    expect(counts.prefix).toBeGreaterThan(0);
    expect(counts.suffix).toBeGreaterThan(0);
    expect(counts.digram).toBeGreaterThan(Math.max(counts.either, counts.prefix, counts.suffix));
  });

  it("keeps board variety across 200 seeds", () => {
    for (const { board } of PROPERTY_BOARDS) {
      expect(board).toHaveLength(16);
      expect(board.filter(isSpecialTile)).toHaveLength(1);

      const singles = new Map<string, number>();
      for (const t of board.filter(isSingleTile)) {
        singles.set(t, (singles.get(t) ?? 0) + 1);
      }
      for (const [tile, count] of singles) {
        expect(count, tile).toBeLessThanOrEqual(MAX_SINGLE_COPIES);
      }

      for (let cell = 0; cell < board.length; cell++) {
        for (const nb of neighbors(cell)) {
          if (nb > cell) expect(board[nb], `cells ${cell}/${nb}`).not.toBe(board[cell]);
        }
      }
      expect(passesVariety(board)).toBe(true);
    }
  });

  it("gives every cell at least three usable words across 200 seeds", () => {
    for (const { board, words } of PROPERTY_BOARDS) {
      const counts = coverageCounts(board, words);
      for (let cell = 0; cell < board.length; cell++) {
        expect(counts[cell], `cell ${cell}`).toBeGreaterThanOrEqual(COVERAGE_THRESHOLD);
      }
      expect(passesCoverage(board, words)).toBe(true);
    }
  });

  it("passesGate checks the three thresholds exactly", () => {
    const three = Array.from(
      { length: 40 },
      (_, i) => `abc${"abdeg"[i % 5]}${"cfghi"[i % 5]}${"lkjmn"[i % 5]}`
    );
    expect(passesGate([])).toBe(false); // no words → it is also rejected at the enumeration stage
    expect(passesGate(["aaaaaaa"])).toBe(false); // 1 word
    expect(passesGate(three)).toBe(false); // 40 short words, no ≥5
    expect(
      passesGate([
        ...Array.from({ length: 14 }, () => "aaaaa"),
        ...Array.from({ length: 26 }, () => "abab"),
        ...Array.from({ length: 2 }, () => "aaaaaaa"),
      ])
    ).toBe(true);
  });

  it("only ships words that survive the isFormable post-filter", () => {
    for (const seed of [11n, 12n, 13n]) {
      const { board, words } = generateBoard(seed, fixtureDictionary);
      const enumeration = fixtureDictionary.findWords(board);
      for (const w of words) {
        expect(isFormable(w, board)).toBe(true);
        expect(enumeration.includes(w)).toBe(true);
      }
    }
  });

  it("falls back deterministically when the gate never passes", () => {
    const poor = { findWords: () => [] };
    const r1 = generateBoard(3n, poor);
    const r2 = generateBoard(3n, poor);
    expect(r1.board).toEqual(r2.board);
    expect(r1.board).toHaveLength(16);
    expect(r1.words).toEqual([]);
  });
});

const PROPERTY_SEEDS = Array.from({ length: 200 }, (_, i) => BigInt(1) + BigInt(i) * 7919n);
let PROPERTY_BOARDS: BoardResult[] = [];
beforeAll(() => {
  PROPERTY_BOARDS = PROPERTY_SEEDS.map((seed) => generateBoard(seed, fullDictionary));
});

describe("passesVariety", () => {
  const valid: Board = ["e", "t", "a", "e", "i", "o", "u", "n", "r", "s", "h", "e", "l", "g", "m", "st"];

  it("accepts three copies of a single letter, one special and distinct neighbours", () => {
    expect(passesVariety(valid)).toBe(true);
  });

  it("rejects a fourth copy of a single letter", () => {
    const board = [...valid];
    board[2] = "e";
    expect(passesVariety(board)).toBe(false);
  });

  it("rejects a second special tile", () => {
    const board = [...valid];
    board[2] = "er";
    expect(passesVariety(board)).toBe(false);
  });

  it("rejects identical tiles that touch 8-way", () => {
    const board = [...valid];
    board[2] = "t";
    expect(passesVariety(board)).toBe(false);
  });

  it("ignores a special tile next to the single letter it contains", () => {
    const board: Board = ["er", "e", "t", "a", "i", "o", "u", "n", "r", "s", "h", "l", "g", "m", "d", "b"];
    expect(passesVariety(board)).toBe(true);
  });
});

describe("coverageCounts", () => {
  it("counts a cell reachable only through a digram", () => {
    const board = boardWith([
      [0, "st"],
      [1, "e"],
    ]);
    const counts = coverageCounts(board, ["ste"]);
    expect(counts[0]).toBe(1);
    expect(counts[1]).toBe(1);
    expect(counts.slice(2).every((n) => n === 0)).toBe(true);
  });

  it("counts a suffix tile that ends a word, and not one that would sit mid-word", () => {
    const board = boardWith([
      [0, "a"],
      [1, "r"],
      [2, "t"],
      [3, "-s"],
    ]);
    const withSuffix = coverageCounts(board, ["arts"]);
    expect(withSuffix[3]).toBe(1);
    const withoutSuffix = coverageCounts(board, ["tra"]);
    expect(withoutSuffix[3]).toBe(0);
  });

  it("counts an either/or tile against both variants", () => {
    const board = boardWith([
      [0, "a/e"],
      [1, "i"],
      [2, "n"],
    ]);
    const counts = coverageCounts(board, ["ein", "ain"]);
    expect(counts[0]).toBe(2);
    expect(counts[1]).toBe(2);
    expect(counts[2]).toBe(2);
  });

  it("lets a prefix start a word but never sit in the middle", () => {
    const board = boardWith([
      [0, "w"],
      [1, "an-"],
      [2, "d"],
      [3, "a"],
    ]);
    const prefixStart = coverageCounts(board, ["and"]);
    expect(prefixStart[1]).toBe(1);
    expect(prefixStart[2]).toBe(1);
    const midWord = coverageCounts(board, ["wand"]);
    expect(midWord.slice(0, 4).every((n) => n === 0)).toBe(true);
  });

  it("counts a word reachable by two paths once per cell", () => {
    const board = boardWith([
      [0, "a"],
      [1, "b"],
      [4, "b"],
      [5, "a"],
    ]);
    const counts = coverageCounts(board, ["aba"]);
    expect(counts[0]).toBe(1);
    expect(counts[1]).toBe(1);
    expect(counts[4]).toBe(1);
    expect(counts[5]).toBe(1);
  });

  it("caps coverage counts at the stop threshold", () => {
    const board = boardWith([
      [0, "a"],
      [1, "b"],
      [4, "b"],
      [5, "a"],
    ]);
    const counts = coverageCounts(board, ["aba", "abb"], 1);
    expect(counts[0]).toBe(1);
    expect(counts.every((n) => n <= 1)).toBe(true);
  });
});

describe("isFormable", () => {
  it("requires a full matching 8-way path, each tile once", () => {
    const board = ["t", "e", "s", "t", "w", "o", "r", "t", "z", "z", "a", "a", "b", "b", "c", "c"];
    expect(isFormable("test", board)).toBe(true);
    expect(isFormable("wort", board)).toBe(true);
    expect(isFormable("toot", board)).toBe(false); // tile reuse
    expect(isFormable("seat", board)).toBe(false); // s(2)-e(1)-a? adjacency
    expect(isFormable("tet", board)).toBe(false); // too short? 3 letters: t-e-t not formable... t(0)-e(1)-t(3)
  });

  it("matches through digram tiles", () => {
    const board = ["qu", "a", "t", "s", "ei", "n", "ch", "r", "st", "o", "r", "d", "b", "b", "c", "c"];
    expect(isFormable("quatsch", board)).toBe(true);
    expect(isFormable("stein", board)).toBe(true);
    expect(isFormable("quash", board)).toBe(false); // needs ch as one tile
  });

  it("enforces prefix-start and suffix-end", () => {
    // w an- d a ...: "and" starts on the prefix tile; "wand" would need it mid-word.
    const board = ["w", "an-", "d", "a", "e", "r", "n", "t", "s", "t", "o", "b", "c", "c", "z", "z"];
    expect(isFormable("and", board)).toBe(true);
    expect(isFormable("wand", board)).toBe(false);
    const sBoard = ["a", "r", "t", "-s", "e", "n", "o", "b", "c", "c", "z", "z", "w", "w", "y", "y"];
    expect(isFormable("arts", sBoard)).toBe(true);
    expect(isFormable("tra", sBoard)).toBe(true); // t-r-a avoids the suffix tile
    expect(isFormable("tar", sBoard)).toBe(false); // t(2)-a(0) not adjacent
  });

  it("matches either/or tiles against either variant", () => {
    const board = ["a/e", "i", "n", "s", "n", "o", "r", "d", "b", "b", "c", "c", "z", "z", "y", "y"];
    expect(isFormable("ein", board)).toBe(true);
    expect(isFormable("ain", board)).toBe(true);
    expect(isFormable("an", board)).toBe(false);
  });

  it("counts letters, not tiles, for the minimum length", () => {
    const board = ["sch", "w", "a", "r", "z", "e", "n", "o", "b", "c", "z", "z", "y", "y", "d", "d"];
    expect(isFormable("schwar", board)).toBe(true); // 6 letters via one 3-letter tile
    expect(isFormable("zwar", board)).toBe(true);
    expect(isFormable("ar", board)).toBe(false); // two letters: below minimum
  });
});
