/**
 * Golden fixture board regeneration (deliberate, never automatic): pinned
 * seed through the real generator over the tiny fixture word list. Run after
 * coherent changes to tiles/boardgen, commit the output — the test suite
 * asserts against the committed file from then on.
 *
 *   node --experimental-strip-types packages/server/scripts/regen-golden-board.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateBoard } from "../dist/boardgen/index.js";
import { createDictionary } from "../dist/dictionary/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureWords = resolve(join(here, "..", "tests", "fixtures", "words.txt"));
const outPath = join(here, "..", "tests", "fixtures", "golden-board.json");

const lines = readFileSync(fixtureWords, "utf8").split("\n").filter(Boolean);
const dictionary = createDictionary(lines);
const SEED = 42n;
const { board, words } = generateBoard(SEED, dictionary);

writeFileSync(
  outPath,
  JSON.stringify(
    {
      seed: SEED.toString(),
      board,
      words,
      note: "pinned seed through the real generator + fixture fs list; regenerate only deliberately",
    },
    null,
    2
  ) + "\n",
  "utf8"
);
console.log(`regen-golden-board: seed=${SEED} words=${words.length} → ${outPath}`);
