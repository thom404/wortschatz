import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EITHER_OR_MENU, TILE_BAG, isDigram, isEitherOr } from "@wortschatz/shared";
import {
  Dictionary,
  buildDawg,
  createDictionary,
  deserializeDawg,
  generateBoard,
  isFormable,
  makeRng,
  normalizeWord,
  rawLinesToWords,
  revealAll,
  serializeDawg,
  submissionVerdict,
  walk,
} from "../src/index.js";

const FIXTURE_WORDS = readFileSync(
  join(import.meta.dirname, "..", "..", "server", "tests", "fixtures", "words.txt"),
  "utf8"
)
  .split("\n")
  .filter(Boolean);

const BOARD = ["t", "e", "s", "t", "w", "o", "r", "t", "z", "z", "a", "a", "b", "b", "c", "c"];

describe("engine dictionary", () => {
  it("serializes and deserializes the DAWG through the browser path", () => {
    const dictionary = createDictionary(["test", "wort", "äpfel", "straße"]);
    const root = buildDawg(rawLinesToWords(["test", "wort", "äpfel", "straße"]));
    const restored = new Dictionary(deserializeDawg(serializeDawg(root)));

    for (const word of ["test", "WORT", "äpfel", "straße", "fehlt"]) {
      expect(restored.isValid(word), word).toBe(dictionary.isValid(word));
    }
  });

  it("enumerates every board word and honours either/or readings", () => {
    const dictionary = createDictionary(["test", "wort", "tor", "tort", "ein", "ain"]);
    expect(dictionary.findWords(BOARD).sort()).toEqual(["test", "tor", "tort", "wort"]);
    const choice = ["a/e", "i", "n", "s", "n", "o", "r", "d", "b", "b", "c", "c", "z", "z", "y", "y"];
    expect(dictionary.findWords(choice).sort()).toEqual(["ain", "ein"]);
    expect(isFormable("ain", choice)).toBe(true);
    expect(isFormable("ein", choice)).toBe(true);
  });

  it("normalizes words once for both authorities", () => {
    expect(normalizeWord("  SÜSS ")).toBe("süss");
  });
});

describe("engine board generation", () => {
  const dictionary = createDictionary(FIXTURE_WORDS);

  it("is deterministic per seed and keeps the inventory, variety and coverage gates", () => {
    const a = generateBoard(42n, dictionary);
    const b = generateBoard(42n, dictionary);
    expect(a).toEqual(b);
    expect(a.board).toHaveLength(16);
    const specials = a.board.filter((t) => isDigram(t) || isEitherOr(t));
    expect(specials).toHaveLength(1);
    expect(
      specials[0]!.startsWith("e/") || EITHER_OR_MENU.includes(specials[0] as never) || TILE_BAG[specials[0]!]
    ).toBeTruthy();

    const rng = makeRng(42n);
    expect(rng.range(10)).toBeGreaterThanOrEqual(0);
    expect(rng.range(10)).toBeLessThan(10);
  });
});

describe("the one submission rule", () => {
  const dictionary = createDictionary(["test", "wort", "tor", "tort", "ein", "ain"]);
  const base = { board: BOARD, dictionary, foundWords: new Set<string>(), points: (w: string) => w.length };

  it("accepts a formable list word, refuses duplicates and invalid words", () => {
    expect(submissionVerdict({ ...base, word: "test" })).toEqual({
      kind: "accepted",
      word: "test",
      points: 4,
    });
    expect(submissionVerdict({ ...base, word: "test", foundWords: new Set(["test"]) })).toEqual({
      kind: "rejected",
      code: "word-duplicate",
      detail: "test",
    });
    expect(submissionVerdict({ ...base, word: "te" })).toEqual({
      kind: "rejected",
      code: "invalid-word",
      detail: "too short",
    });
    expect(submissionVerdict({ ...base, word: "zzz" })).toEqual({
      kind: "rejected",
      code: "invalid-word",
      detail: "not placeable",
    });
  });

  it("resolves either/or readings to the best valid word, which is the duplicate identity", () => {
    const choice = ["a/e", "i", "n", "s", "n", "o", "r", "d", "b", "b", "c", "c", "z", "z", "y", "y"];
    const verdict = submissionVerdict({
      word: "ain",
      alternate: "ein",
      board: choice,
      dictionary,
      foundWords: new Set(),
      points: (w) => w.length,
    });
    expect(verdict).toMatchObject({ kind: "accepted", word: "ain" });
    expect(
      submissionVerdict({
        word: "ain",
        alternate: "ein",
        board: choice,
        dictionary,
        foundWords: new Set(["ain"]),
        points: (w) => w.length,
      })
    ).toMatchObject({ kind: "rejected", code: "word-duplicate", detail: "ain" });
  });
});

describe("the shared reveal builder", () => {
  it("groups by length and annotates finders with the shared score", () => {
    const reveal = revealAll({
      words: ["wort", "ort", "test"],
      wordsBySeat: new Map([
        [1, ["ort"]],
        [2, ["wort", "ort"]],
      ]),
      points: (w) => w.length,
    });
    expect(reveal.groups.map((g) => g.length)).toEqual([3, 4]);
    expect(reveal.groups[0]!.words).toEqual([{ word: "ort", points: 3, foundBy: [1, 2] }]);
    expect(reveal.groups[1]!.words).toEqual([
      { word: "test", points: 4, foundBy: [] },
      { word: "wort", points: 4, foundBy: [2] },
    ]);
  });
});

describe("dawg walk", () => {
  it("finds only final nodes", () => {
    const root = buildDawg(["wort"]);
    expect(walk(root, "wor")?.final).toBe(false);
    expect(walk(root, "wort")?.final).toBe(true);
  });
});
