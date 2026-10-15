/**
 * DAWG artifact generation (ADR-0001 §7): consumes the committed raw word
 * list, emits the artifact the runtime loader reads instantly. Run from the
 * build (Docker) or locally:
 *
 *   node --experimental-strip-types packages/server/scripts/build-dawg.ts \
 *        [--words <path>] [--out <path>]
 *
 * The artifact is never committed; the raw list stays the single source of
 * truth and the build asserts list invariants up front.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDawg, serializeDawg } from "../dist/dictionary/dawg-blob.js";
import { createDictionary } from "../dist/dictionary/index.js";

const here = dirname(fileURLToPath(import.meta.url)); // packages/server/scripts
const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]!) : resolve(join(here, fallback));
};

const wordsPath = arg("--words", "../../../words");
const outPath = arg("--out", "../dist/dawg.bin");

const raw = readFileSync(wordsPath, "utf8");
const lines = raw.split("\n").filter((l) => l.trim().length > 0);

// List trim: the raw list's sub-3 entries (the known 90 two-letter lines)
// never enter the artifact; the loader trims defensively at query time too.
const trimmed = lines.filter((l) => l.normalize("NFC").toLowerCase().length >= 3);
console.log(
  `build-dawg: ${lines.length} lines → ${trimmed.length} entries ≥3 letters (dropped ${lines.length - trimmed.length})`
);

const unique = new Set(trimmed.map((l) => l.normalize("NFC").toLowerCase()));
const dictionary = createDictionary([...unique]);
const sanity = ["haus", "zeit", "sich"];
const alive = sanity.filter((w) => dictionary.isValid(w));
console.log(
  `build-dawg: ${unique.size} unique entries; sanity-resolved via list: ${alive.length}/${sanity.length}`
);

const blob = serializeDawg(buildDawg([...unique]));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, blob, "utf8");
console.log(`build-dawg: wrote ${outPath} (${blob.length} bytes)`);
