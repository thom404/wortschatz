/**
 * Ad hoc board-generation simulation against the FULL word list (ADR-0003
 * was derived this way; re-run when the bag or the gate is under suspicion).
 * Not part of the default vitest run — 200+ ms per board keeps CI honest.
 *
 *   node --experimental-strip-types packages/server/scripts/board-sim.ts [boards] [--seed <n>]
 */
import { loadDictionary, defaultWordsPath } from "../dist/dictionary/loader.js";
import { generateBoard } from "../dist/boardgen/index.js";

const argv = process.argv.slice(2);
const N = Number(argv[0] && !argv[0].startsWith("--") ? argv[0] : 50) || 50;
const seedIdx = argv.indexOf("--seed");
const seed0 = seedIdx >= 0 ? BigInt(argv[seedIdx + 1]!) : 1n;

const t0 = performance.now();
const { dictionary, fellBack } = await loadDictionary({ wordsPath: defaultWordsPath() });
console.log(
  `board-sim: dictionary loaded (${fellBack ? "fallback build" : "artifact"}), ${dictionary.isValid("haus") ? "live" : "broken"}`
);

let pass = 0;
const counts: number[] = [];
const len5: number[] = [];
const len7: number[] = [];
let totalMs = 0;

for (let i = 0; i < N; i++) {
  const seed = seed0 + BigInt(i) * 7919n;
  const t = performance.now();
  const { words } = generateBoard(seed, dictionary);
  totalMs += performance.now() - t;
  counts.push(words.length);
  len5.push(words.filter((w) => w.length >= 5).length);
  len7.push(words.filter((w) => w.length >= 7).length);
  if (counts[i] >= 40 && len5[i] >= 14 && len7[i] >= 2) pass += 1;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
console.log(
  `board-sim: ${pass}/${N} boards passed the gate · median words ${median(counts)} · median ≥5 ${median(len5)} · median ≥7 ${median(len7)} · median gen ${(totalMs / N) | 0} ms`
);
