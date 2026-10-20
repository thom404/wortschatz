import { describe, expect, it } from "vitest";
import { LETTER_VALUES, MIN_VALUE, charScore, tileValues, wordScore } from "../src/index.js";

/** One word per value class, so every letter of the German table is exercised
 *  through the public word-score function. */
const TABLE_CASES: readonly (readonly [string, number])[] = [
  ["adriane", 7], // a d r i n e — the whole value-1 class
  ["stur", 4], // s t u r
  ["mut", 5], // m = 3
  ["blitz", 10], // b l z — b 3, l 2, z 3
  ["box", 13], // o 2, x 8
  ["wall", 8], // w 3
  ["gelb", 8], // g 2
  ["pack", 13], // p 4, c 4
  ["quark", 17], // q 10, k 4
  ["tuft", 7], // f 4
  ["ära", 8], // ä 6
  ["jahr", 10], // j 6, h 2
  ["fünf", 15], // ü 6
  ["vier", 9], // v 6
  ["öde", 10], // ö 8
  ["yacht", 18], // y 10
  ["fuß", 7], // ß 2
];

describe("German Scrabble letter values", () => {
  for (const [word, points] of TABLE_CASES) {
    it(`prices ${word} at exactly ${points}`, () => {
      expect(wordScore(word)).toBe(points);
    });
  }

  it("exposes the table and its floor", () => {
    expect(LETTER_VALUES["e"]).toBe(1);
    expect(LETTER_VALUES["y"]).toBe(10);
    expect(LETTER_VALUES["ß"]).toBe(2);
    expect(MIN_VALUE).toBe(1);
  });

  it("clamps an off-table character to the floor", () => {
    expect(charScore("!")).toBe(MIN_VALUE);
    expect(charScore("A")).toBe(MIN_VALUE);
    expect(wordScore("a!")).toBe(2);
  });
});

describe("tile values", () => {
  it("gives a plain single tile one value", () => {
    expect(tileValues("e")).toEqual([1]);
  });

  it("sums a digram's letters", () => {
    expect(tileValues("sch")).toEqual([7]);
    expect(tileValues("st")).toEqual([2]);
    expect(tileValues("qu")).toEqual([11]);
  });

  it("sums prefix and suffix tiles", () => {
    expect(tileValues("an-")).toEqual([2]);
    expect(tileValues("-ung")).toEqual([4]);
  });

  it("gives an either/or tile one value per variant in declared order", () => {
    expect(tileValues("e/ä")).toEqual([1, 6]);
    expect(tileValues("o/u")).toEqual([2, 1]);
  });

  it("keeps equal either/or variants as one value per variant", () => {
    expect(tileValues("i/e")).toEqual([1, 1]);
    expect(tileValues("a/e")).toEqual([1, 1]);
  });
});
