import { describe, expect, it } from "vitest";
import { createDictionary } from "../src/dictionary/index.js";

const LINES = [
  "Test", // capitalised safely; membership is case-insensitive
  "WORT",
  // umlauts and ß are real, with no ae/oe/ue/ss aliasing
  "äpfel",
  "straße",
  "SÜSS",
  // duplicates within tolerance: colliding after lowercase NFC
  "wort",
  "straße",
  // too-short entries are dropped at load
  "de",
  "ok",
];

describe("createDictionary", () => {
  const dict = createDictionary(LINES);

  it("accepts list members regardless of case", () => {
    expect(dict.isValid("test")).toBe(true);
    expect(dict.isValid("TEST")).toBe(true);
    expect(dict.isValid("wort")).toBe(true);
  });

  it("matches umlauts and ß literally, with no aliasing", () => {
    expect(dict.isValid("äpfel")).toBe(true);
    expect(dict.isValid("apfel")).toBe(false);
    expect(dict.isValid("äppel")).toBe(false);
    expect(dict.isValid("straße")).toBe(true);
    expect(dict.isValid("strasse")).toBe(false);
    expect(dict.isValid("süss")).toBe(true);
    expect(dict.isValid("suess")).toBe(false);
  });

  it("rejects words that are not on the list", () => {
    expect(dict.isValid("schatz")).toBe(false);
    expect(dict.isValid("")).toBe(false);
  });

  it("drops entries shorter than three letters at load", () => {
    expect(dict.isValid("de")).toBe(false);
    expect(dict.isValid("ok")).toBe(false);
  });

  it("dedupes entries that collide after normalization", () => {
    // "wort" and "straße" appear twice up front; the fold must not break
    // membership or rejection.
    expect(dict.isValid("Wort")).toBe(true);
    expect(dict.isValid("straße")).toBe(true);
  });
});

/* ---------------- enumeration ---------------- */

describe("findWords", () => {
  it("enumerates exactly the formable list words", () => {
    const dict = createDictionary(["test", "wort"]);
    // Board: t e s t / w o r t / z z a a / b b c c
    const board = ["t", "e", "s", "t", "w", "o", "r", "t", "z", "z", "a", "a", "b", "b", "c", "c"];
    expect(dict.findWords(board).sort()).toEqual(["test", "wort"]);
  });

  it("respects tile-once and 8-way adjacency", () => {
    const dict = createDictionary(["tor", "tort"]);
    // tort: t(3) o(5) r(6) t(7) — distinct cells along the first row pair.
    const board = ["t", "e", "s", "t", "w", "o", "r", "t", "z", "z", "a", "a", "b", "b", "c", "c"];
    const words = dict.findWords(board).sort();
    expect(words).toEqual(["tor", "tort"]);
  });

  it("cannot reuse the same tile twice in a word", () => {
    const dict = createDictionary(["toot"]);
    const board = ["t", "e", "s", "t", "w", "o", "r", "t", "z", "z", "a", "a", "b", "b", "c", "c"];
    expect(dict.findWords(board)).toEqual([]);
  });

  it("spells through digram tiles", () => {
    const dict = createDictionary(["quatsch", "stein", "nord"]);
    // qu a t s / ei n ch r / st o r d / b b c c
    const board = ["qu", "a", "t", "s", "ei", "n", "ch", "r", "st", "o", "r", "d", "b", "b", "c", "c"];
    const words = dict.findWords(board).sort();
    expect(words).toEqual(["nord", "quatsch", "stein"]);
  });

  it("treats either/or tiles as either variant, both spellable", () => {
    // a/e i n / ... : "ein" via e-variant and "ain" via a-variant.
    const dict = createDictionary(["ein", "ain"]);
    const board = ["a/e", "i", "n", "s", "n", "o", "r", "d", "b", "b", "c", "c", "z", "z", "y", "y"];
    expect(dict.findWords(board).sort()).toEqual(["ain", "ein"]);
  });

  it("enumerates prefix tile candidates at any path position (constraint-oblivious)", () => {
    // w an- d ... : "and" spells via the prefix tile at word start, "wand"
    // via the same tile mid-word. Positioning is boardgen's post-filter job.
    const dict = createDictionary(["wand", "and"]);
    const board = ["w", "an-", "d", "a", "e", "r", "n", "t", "s", "t", "o", "b", "c", "c", "z", "z"];
    expect(dict.findWords(board).sort()).toEqual(["and", "wand"]);
  });

  it("enumerates suffix tile candidates independent of position (constraint-oblivious)", () => {
    // a r t -s ... : "arts" ends on the suffix tile — allowed.
    const dict = createDictionary(["art", "arts"]);
    const board = ["a", "r", "t", "-s", "e", "n", "o", "b", "c", "c", "z", "z", "w", "w", "y", "y"];
    expect(dict.findWords(board).sort()).toEqual(["art", "arts"]);
  });

  it("enumerates words that pass through a suffix tile mid-path (constraint-oblivious)", () => {
    // a -s t ... : "ast" consumes -s mid-word; enumerated here, removed later
    // by boardgen's isFormable post-filter (tested in boardgen.test.ts).
    const dict = createDictionary(["ast"]);
    const board = ["a", "-s", "t", "e", "n", "o", "b", "c", "z", "z", "w", "w", "y", "y", "d", "d"];
    expect(dict.findWords(board)).toEqual(["ast"]);
  });
});
