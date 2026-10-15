import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDictionary } from "../src/dictionary/index.js";
import { generateBoard } from "../src/boardgen/index.js";

const FIXTURE_WORDS = readFileSync(join(import.meta.dirname, "fixtures", "words.txt"), "utf8")
  .split("\n")
  .filter(Boolean);
const GOLDEN = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "golden-board.json"), "utf8")
) as { seed: string; board: string[]; words: string[] };

describe("golden fixture board", () => {
  it("reproduces the committed snapshot for the pinned seed", () => {
    const dictionary = createDictionary(FIXTURE_WORDS);
    const { board, words } = generateBoard(BigInt(GOLDEN.seed), dictionary);
    expect(board).toEqual(GOLDEN.board);
    expect(words).toEqual(GOLDEN.words);
  });
});
