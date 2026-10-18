/**
 * On-demand word-list audit (ADR-0001 amendment, #107). Deterministic and
 * offline: it reads the vendored raw list, the reviewed exclusions and the
 * vendored upstream `enz` blacklist, then prints candidates grouped by
 * reason. Nothing is removed automatically — a human curates.
 *
 *   npm run build && npm run audit-words
 *   node --experimental-strip-types packages/server/scripts/audit-word-list.ts \
 *        [--words <path>] [--exclusions <path>] [--blacklist <path>]
 *
 * Like board-sim, full-list runs are ad hoc and stay out of the default
 * vitest run.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runWordListAudit, formatWordListAudit } from "../dist/audit/index.js";
import { defaultExclusionsPath, defaultWordsPath } from "../dist/dictionary/loader.js";

const BLACKLIST_SHA256 = "7feaaed9b39473f01de967caf2da7e3f5cf34a2dad49fb6a5d5b6840d51acf68";

const here = dirname(fileURLToPath(import.meta.url)); // packages/server/scripts
const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1]) return resolve(argv[i + 1]!);
  return isAbsolute(fallback) ? fallback : resolve(join(here, fallback));
};

const wordsPath = arg("--words", defaultWordsPath());
const exclusionsPath = arg("--exclusions", defaultExclusionsPath());
const defaultBlacklistPath = resolve(join(here, "..", "data", "enz-blacklist"));
const blacklistPath = arg("--blacklist", defaultBlacklistPath);

const readLines = (path: string): string[] => readFileSync(path, "utf8").split("\n");

const blacklistRaw = readFileSync(blacklistPath, "utf8");
if (blacklistPath === defaultBlacklistPath) {
  const digest = createHash("sha256").update(blacklistRaw).digest("hex");
  if (digest !== BLACKLIST_SHA256) {
    console.error(`audit-words: vendored blacklist checksum mismatch (${digest})`);
    process.exit(1);
  }
}

const report = runWordListAudit({
  words: readLines(wordsPath),
  exclusions: readLines(exclusionsPath),
  upstreamBlacklist: blacklistRaw.split("\n"),
});

process.stdout.write(formatWordListAudit(report));
