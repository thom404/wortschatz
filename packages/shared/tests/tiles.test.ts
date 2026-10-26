import { describe, expect, it } from "vitest";
import {
  TILE_BAG,
  TILE_BAG_SIZE,
  isDigram,
  isEitherOr,
  tileKind,
  tileLetters,
  tileSpellingLength,
  tileStrings,
} from "../src/index.js";

describe("tile notation", () => {
  it("classifies plain letters and digrams", () => {
    expect(tileKind("a")).toBe("single");
    expect(tileKind("st")).toBe("digram");
    expect(tileKind("sch")).toBe("digram");
    expect(isDigram("sch")).toBe(true);
    expect(isDigram("a")).toBe(false);
  });

  it("classifies either/or tiles", () => {
    expect(tileKind("a/e")).toBe("either-or");
    expect(tileKind("e/ä")).toBe("either-or");
    expect(isEitherOr("i/e")).toBe(true);
    expect(isEitherOr("ie")).toBe(false);
  });

  it("treats retired prefix and suffix notation as plain digrams", () => {
    expect(tileKind("an-")).toBe("digram");
    expect(tileKind("-ung")).toBe("digram");
  });

  it("contributes letters, not tiles, to word length", () => {
    expect(tileLetters("sch")).toEqual(["s", "c", "h"]);
    expect(tileLetters("a")).toEqual(["a"]);
    expect(tileLetters("a/e")).toEqual(["a", "e"]);
  });

  it("yields the candidate letter-strings the cell can spell", () => {
    expect(tileStrings("st")).toEqual(["st"]);
    // Either/or: word valid if either variant is on the list.
    expect(tileStrings("a/e")).toEqual(["a", "e"]);
    expect(tileStrings("qu")).toEqual(["qu"]);
  });

  it("knows how wide a tile spells for adjacency constraints", () => {
    expect(tileSpellingLength("a")).toBe(1);
    expect(tileSpellingLength("a/e")).toBe(1); // either variant: one letter
    expect(tileSpellingLength("st")).toBe(2);
    expect(tileSpellingLength("sch")).toBe(3);
  });
});

describe("tile bag", () => {
  it("holds exactly the decided counts per tile", () => {
    expect(TILE_BAG).toEqual({
      e: 10,
      a: 6,
      i: 6,
      o: 4,
      u: 4,
      ä: 2,
      ö: 1,
      ü: 1,
      t: 4,
      r: 4,
      n: 4,
      s: 3,
      h: 2,
      l: 3,
      g: 2,
      c: 2,
      m: 2,
      d: 2,
      b: 2,
      f: 1,
      p: 1,
      k: 1,
      w: 1,
      v: 1,
      z: 1,
      x: 1,
      j: 1,
      y: 1,
      ß: 2,
      er: 3,
      en: 3,
      te: 3,
      ch: 2,
      sch: 3,
      st: 3,
      ei: 2,
      qu: 2,
    });
  });

  it("totals 96 tiles with 30/96 vowel mass and no standalone q", () => {
    expect(TILE_BAG_SIZE).toBe(96);
    // 31.25% vowel mass counts the plain vowels; the umlaut tiles sit on top.
    const vowels = TILE_BAG["e"] + TILE_BAG["a"] + TILE_BAG["i"] + TILE_BAG["o"] + TILE_BAG["u"];
    expect(vowels).toBe(30);
    expect("q" in TILE_BAG).toBe(false);
    expect("qu" in TILE_BAG).toBe(true);
  });

  it("carries the same alphabet as the word list semantics", () => {
    const letters = Object.keys(TILE_BAG).filter((t) => tileKind(t) === "single");
    expect([...letters].sort()).toEqual(
      [
        "a",
        "ä",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
        "h",
        "i",
        "j",
        "k",
        "l",
        "m",
        "n",
        "o",
        "ö",
        "p",
        "q",
        "r",
        "s",
        "t",
        "u",
        "ü",
        "v",
        "w",
        "x",
        "y",
        "z",
        "ß",
      ]
        .filter((c) => c !== "q")
        .sort()
    );
  });
});
