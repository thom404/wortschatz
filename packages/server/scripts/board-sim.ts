/**
 * Ad hoc board-generation simulation against the FULL word list (ADR-0003
 * was derived this way; re-run when the bag, composition or acceptance rules
 * are under suspicion). Not part of the default vitest run — a full-list
 * board keeps CI honest.
 *
 *   npx tsc -b packages/shared packages/server
 *   node --experimental-strip-types packages/server/scripts/board-sim.ts [boards] [--seed <n>]
 *
 * Reports the acceptance families (gate + variety + coverage), word-count
 * medians, generation-time median/p95, fallback count, vowel share and the
 * special-type distribution.
 */
import { tileKind, isDigram, isEitherOr } from "@wortschatz/shared";
import { loadDictionary, defaultWordsPath } from "../dist/dictionary/loader.js";
import { generateBoard, passesCoverage, passesGate, passesVariety } from "../dist/boardgen/index.js";

const argv = process.argv.slice(2);
const N = Number(argv[0] && !argv[0].startsWith("--") ? argv[0] : 50) || 50;
const seedIdx = argv.indexOf("--seed");
const seed0 = seedIdx >= 0 ? BigInt(argv[seedIdx + 1]!) : 1n;

const t0 = performance.now();
const { dictionary, fellBack } = await loadDictionary({ wordsPath: defaultWordsPath() });
console.log(
  `board-sim: dictionary loaded (${fellBack ? "fallback build" : "artifact"}), ${dictionary.isValid("haus") ? "live" : "broken"}`
);

let accepted = 0;
let fallback = 0;
let vowelTotal = 0;
const counts: number[] = [];
const len5: number[] = [];
const len7: number[] = [];
const times: number[] = [];
const specials = { digram: 0, either: 0 };

for (let i = 0; i < N; i++) {
  const seed = seed0 + BigInt(i) * 7919n;
  const t = performance.now();
  const { board, words } = generateBoard(seed, dictionary);
  times.push(performance.now() - t);
  counts.push(words.length);
  len5.push(words.filter((w) => w.length >= 5).length);
  len7.push(words.filter((w) => w.length >= 7).length);
  vowelTotal += board.filter((tile) => "aeiouäöü".includes(tile)).length;
  for (const tile of board) {
    if (isDigram(tile)) specials.digram += 1;
    else if (isEitherOr(tile)) specials.either += 1;
  }
  const pass = passesGate(words) && passesCoverage(board, words) && passesVariety(board);
  if (pass) accepted += 1;
  else fallback += 1;
  if (board.filter((tile) => tileKind(tile) !== "single").length !== 1) {
    console.log(`board-sim: seed ${seed} has not exactly one special tile`);
  }
}

const percentile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
};
const median = (xs: number[]): number => percentile(xs, 0.5);
console.log(
  `board-sim: ${accepted}/${N} boards accepted (${fallback} fallback) · ` +
    `median words ${median(counts)} · median ≥5 ${median(len5)} · median ≥7 ${median(len7)} · ` +
    `median gen ${median(times).toFixed(2)} ms · p95 gen ${percentile(times, 0.95).toFixed(2)} ms · ` +
    `vowel share ${(vowelTotal / (N * 16)).toFixed(3)} · ` +
    `specials ${specials.digram}/${specials.either} (digram/either)`
);
