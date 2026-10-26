/**
 * Either/or pair-menu calibration (ADR-0027). Reproduces the measured menu in
 * `EITHER_OR_MENU` from the real generator and the full committed word list.
 * Not part of the default vitest run: it is a deliberate measurement, not a
 * gate.
 *
 *   npx tsc -b packages/shared packages/server
 *   node --experimental-strip-types packages/server/scripts/either-or-pair-calibration.ts [boards] [--seed <n>]
 *
 * For every board it puts each candidate pair in the special cell, enumerates
 * the board, and counts the words the pair adds over the same board with an
 * `e` in that cell. Candidate letters exclude standalone `q` (the inventory
 * has only the `qu` digram). The menu is the top eight pairs by total added
 * words across the sample.
 */
import { readFileSync } from "node:fs";
import { createDictionary } from "../dist/dictionary/index.js";
import { defaultExclusionsPath, defaultWordsPath } from "../dist/dictionary/loader.js";
import { generateBoard, isFormable } from "../dist/boardgen/index.js";

const argv = process.argv.slice(2);
const N = Number(argv[0] && !argv[0].startsWith("--") ? argv[0] : 40) || 40;
const seedIdx = argv.indexOf("--seed");
const seed0 = seedIdx >= 0 ? BigInt(argv[seedIdx + 1]!) : 1n;

const words = readFileSync(defaultWordsPath(), "utf8").split("\n");
const exclusions = readFileSync(defaultExclusionsPath(), "utf8").split("\n");
const dictionary = createDictionary(words, exclusions);

/** No standalone `q`: the tile bag reaches it only through `qu`. */
const LETTERS = [..."abcdefghijklmnoprstuvwxyzäöüß"];
const PAIRS: string[] = [];
for (let i = 0; i < LETTERS.length; i++) {
  for (let j = i + 1; j < LETTERS.length; j++) PAIRS.push(`${LETTERS[i]}/${LETTERS[j]}`);
}

const scores = new Map<string, { added: number; words: number; min: number; max: number }>();
for (let i = 0; i < N; i++) {
  const seed = seed0 + BigInt(i) * 7919n;
  const { board } = generateBoard(seed, dictionary);
  const special = board.findIndex((tile) => tile.includes("/") || tile.length > 1);
  if (special < 0) throw new Error(`seed ${seed} has no special tile`);
  const base = board.slice();
  base[special] = "e";
  const baseline = new Set(dictionary.findWords(base));

  for (const pair of PAIRS) {
    const candidate = board.slice();
    candidate[special] = pair;
    const found = dictionary.findWords(candidate).filter((word) => isFormable(word, candidate));
    const added = found.filter((word) => !baseline.has(word)).length;
    const score = scores.get(pair) ?? { added: 0, words: 0, min: Infinity, max: 0 };
    score.added += added;
    score.words += found.length;
    score.min = Math.min(score.min, found.length);
    score.max = Math.max(score.max, found.length);
    scores.set(pair, score);
  }
}

const ranked = [...scores.entries()].sort((a, b) => b[1].added - a[1].added);
console.log(`either-or-pair-calibration: ${N} boards, ${PAIRS.length} candidate pairs`);
for (const [pair, score] of ranked.slice(0, 15)) {
  console.log(
    `${pair} · added ${score.added} (${(score.added / N).toFixed(1)}/board) · ` +
      `words ${(score.words / N).toFixed(1)}/board · range ${score.min}-${score.max}`
  );
}
console.log(
  `measured menu: [${ranked
    .slice(0, 8)
    .map(([pair]) => JSON.stringify(pair))
    .join(", ")}]`
);
