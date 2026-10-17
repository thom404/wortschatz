import { describe, expect, it } from "vitest";
import { TILE_BAG, isEitherOr, isPrefix, isSuffix, tileSpellingLength } from "@wortschatz/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateBoard, isFormable, passesGate } from "../src/boardgen/index.js";
import { createDictionary } from "../src/dictionary/index.js";

/** Fixture-dictionary twin for the pure boardgen seam. */
const FIXTURE_WORDS = readFileSync(join(import.meta.dirname, "fixtures", "words.txt"), "utf8")
  .split("\n")
  .filter(Boolean);
const fixtureDictionary = createDictionary(FIXTURE_WORDS);

describe("generateBoard", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const dict = createDictionary([]);
    const a1 = generateBoard(1n, fixtureDictionary);
    const a2 = generateBoard(1n, fixtureDictionary);
    const b = generateBoard(2n, fixtureDictionary);
    expect(a1.board).toEqual(a2.board);
    expect(a1.words).toEqual(a2.words);
    expect(a1.board).not.toEqual(b.board);
  });

  it("returns a 16-cell board drawn from the tile bag", () => {
    const dict = createDictionary([]);
    const { board } = generateBoard(7n, fixtureDictionary);
    expect(board).toHaveLength(16);
    for (const t of board) {
      expect(TILE_BAG[t]).toBeGreaterThan(0);
    }
  });

  it("keeps the decided special-tile composition", () => {
    const dict = createDictionary([]);
    for (let s = 0; s < 50; s++) {
      const { board } = generateBoard(BigInt(s), fixtureDictionary);
      const either = board.filter(isEitherOr);
      const prefixes = board.filter(isPrefix);
      const suffixes = board.filter(isSuffix);
      expect(either.length).toBeLessThanOrEqual(1);
      expect(prefixes.length).toBeLessThanOrEqual(2);
      expect(suffixes.length).toBeLessThanOrEqual(2);
    }
  });

  it("never places two multi-letter tiles adjacent", () => {
    const dict = createDictionary([]);
    for (let s = 0; s < 100; s++) {
      const { board } = generateBoard(BigInt(s), fixtureDictionary);
      const multiIdx = board.map((t, i) => (tileSpellingLength(t) > 1 ? i : -1)).filter((i) => i >= 0);
      // King-graph feasibility on the 4×4: at most 4 multi tiles can exist.
      expect(multiIdx.length).toBeLessThanOrEqual(4);
      for (const i of multiIdx) {
        for (const j of multiIdx) {
          if (i === j) continue;
          const [r1, c1] = [Math.floor(i / 4), i % 4];
          const [r2, c2] = [Math.floor(j / 4), j % 4];
          expect(Math.abs(r1 - r2) > 1 || Math.abs(c1 - c2) > 1).toBe(true);
        }
      }
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
