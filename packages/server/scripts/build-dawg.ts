/**
 * DAWG artifact generation for both authorities (ADR-0001, ADR-0031): the
 * committed raw word list plus the reviewed exclusion list produce one
 * artifact. The default run writes it to the client's stable public path
 * `/data/dawg.bin` and to the server's artifact-first loader path; it is never
 * committed.
 *
 *   node --experimental-strip-types packages/engine/scripts/build-dawg.ts \
 *        [--words <path>] [--exclusions <path>] [--out <path>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDawg, serializeDawg, walk } from "../../engine/dist/dictionary/dawg-blob.js";
import { rawLinesToWords } from "../../engine/dist/dictionary/index.js";
import { normalizeWord } from "../../engine/dist/text.js";

const here = dirname(fileURLToPath(import.meta.url)); // packages/engine/scripts
const repo = resolve(join(here, "..", "..", ".."));
const argv = process.argv.slice(2);
const explicitOut = argv.includes("--out");
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]!) : resolve(join(here, fallback));
};

const wordsPath = arg("--words", "../../../words");
const exclusionsPath = arg("--exclusions", "../word-exclusions.txt");
const outPath = arg("--out", "../../client/public/data/dawg.bin");

const lines = readFileSync(wordsPath, "utf8")
  .split("\n")
  .filter((l) => l.trim().length > 0);
const exclusionLines = readFileSync(exclusionsPath, "utf8").split("\n");

// Single ingestion seam: the same subtraction the dev fallback uses.
const words = rawLinesToWords(lines, exclusionLines);
// Sub-3 trim: the pinned list's known 90 two-letter entries never enter.
const sub3 = lines.length - lines.filter((l) => normalizeWord(l).length >= 3).length;
console.log(
  `build-dawg: ${lines.length} lines → ${words.length} unique entries ≥3 letters (sub-3 dropped: ${sub3}, exclusions applied: ${exclusionLines.filter((l) => l.trim() && !l.trim().startsWith("#")).length})`
);
if (sub3 !== 90) {
  console.error(`build-dawg: unexpected sub-3 count (${sub3} ≠ 90) — refusing to emit the artifact`);
  process.exit(1);
}

const dictionary = buildDawg(words);
// Sanity: the artifact answers membership through the automaton walk.
const sanity = ["haus", "zeit", "sich"];
const alive = sanity.filter((w) => {
  const end = walk(dictionary, w);
  return end !== null && end.final;
});
console.log(`build-dawg: ${words.length} unique entries; sanity walk: ${alive.length}/${sanity.length}`);

const blob = serializeDawg(dictionary);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, blob, "utf8");
console.log(`build-dawg: wrote ${outPath} (${blob.length} bytes)`);

// One artifact, two loaders: the server keeps its instant artifact-first path.
if (!explicitOut) {
  const serverOut = resolve(join(repo, "packages/server/dist/dawg.bin"));
  mkdirSync(dirname(serverOut), { recursive: true });
  writeFileSync(serverOut, blob, "utf8");
  console.log(`build-dawg: wrote ${serverOut} (${blob.length} bytes)`);
}
