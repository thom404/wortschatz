/**
 * Deterministic, offline word-list audit (ADR-0001 amendment, #107).
 *
 * The audit never removes anything: it groups candidates for a human to
 * adjudicate. The reviewed decisions live in `word-exclusions.txt`.
 *
 * Groups, in stable report order:
 * 1. `upstream-blacklist` — normalized forms present in the vendored `enz`
 *    blacklist (proper nouns/toponyms/abbreviations upstream rejected).
 * 2. `non-german-codepoints` — forms containing anything outside
 *    `a-zäöüß`. This is a review flag, not a rule: Duden-accepted loanwords
 *    such as Café and Cliché must survive.
 * 3. `abbreviation-patterns` — a leading uppercase pair (the upstream
 *    `verify.sh` rule) or a capitalised token of at most three letters
 *    (e.g. Pkw, Dax, Ufo).
 * 4. `input-anomalies` — inner uppercase (e.g. JavaScript) or a raw-list
 *    ordering violation under German collation.
 *
 * Output is sorted with one collator and contains no timestamps, so repeated
 * runs can be diffed.
 */
import { normalizeExclusions, normalizeWord } from "../dictionary/index.js";

export const AUDIT_REASONS = [
  "upstream-blacklist",
  "non-german-codepoints",
  "abbreviation-patterns",
  "input-anomalies",
] as const;

export type AuditReason = (typeof AUDIT_REASONS)[number];

export interface AuditGroup {
  reason: AuditReason;
  words: string[];
}

export interface WordListAuditReport {
  rawWords: number;
  acceptedWords: number;
  excludedWords: number;
  blacklistEntries: number;
  groups: AuditGroup[];
}

export interface WordListAuditInput {
  /** Raw word-list lines, as vendored. */
  words: string[];
  /** Raw exclusion-list lines (comments allowed). */
  exclusions: string[];
  /** Raw upstream `enz` blacklist lines. */
  upstreamBlacklist: string[];
}

const GERMAN_FORM = /^[a-zäöüß]+$/u;
const LEADING_UPPERCASE_PAIR = /^\p{Lu}\p{Lu}/u;
const SHORT_CAPITALISED = /^\p{Lu}\p{L}{0,2}$/u;
const INNER_UPPERCASE = /\p{Ll}\p{Lu}/u;
const collator = new Intl.Collator("de", { sensitivity: "variant" });

const compareWords = (a: string, b: string): number => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/** Sorted normalized forms from an arbitrary line-oriented input. */
function normalizedLines(lines: string[]): string[] {
  const seen = new Set<string>();
  for (const line of lines) {
    const text = line.trim();
    if (text.length === 0) continue;
    seen.add(normalizeWord(text));
  }
  return [...seen].sort(compareWords);
}

export function runWordListAudit(input: WordListAuditInput): WordListAuditReport {
  const rawWords = input.words.map((line) => line.trim()).filter((line) => line.length > 0);
  const accepted = new Set<string>();
  const rawByWord = new Map<string, string>();
  for (const raw of rawWords) {
    const word = normalizeWord(raw);
    if (word.length < 3) continue;
    accepted.add(word);
    if (!rawByWord.has(word)) rawByWord.set(word, raw);
  }

  const exclusions = new Set(normalizeExclusions(input.exclusions));
  for (const word of exclusions) {
    if (!accepted.has(word)) {
      throw new Error(`word exclusion not present in the word list: "${word}"`);
    }
  }
  const candidates = [...accepted].filter((word) => !exclusions.has(word)).sort(compareWords);

  const blacklist = new Set(normalizedLines(input.upstreamBlacklist));
  const anomalous = new Set<string>();
  let previous: string | undefined = undefined;
  for (const raw of rawWords) {
    const word = normalizeWord(raw);
    if (INNER_UPPERCASE.test(raw)) anomalous.add(word);
    if (previous !== undefined && collator.compare(previous, raw) > 0) anomalous.add(word);
    previous = raw;
  }

  const groups: AuditGroup[] = [
    {
      reason: "upstream-blacklist",
      words: candidates.filter((word) => blacklist.has(word)),
    },
    {
      reason: "non-german-codepoints",
      words: candidates.filter((word) => !GERMAN_FORM.test(word)),
    },
    {
      reason: "abbreviation-patterns",
      words: candidates.filter((word) => {
        const raw = rawByWord.get(word) ?? word;
        return LEADING_UPPERCASE_PAIR.test(raw) || SHORT_CAPITALISED.test(raw);
      }),
    },
    {
      reason: "input-anomalies",
      words: candidates.filter((word) => anomalous.has(word)),
    },
  ];

  return {
    rawWords: rawWords.length,
    acceptedWords: accepted.size - exclusions.size,
    excludedWords: exclusions.size,
    blacklistEntries: input.upstreamBlacklist.filter((line) => line.trim().length > 0).length,
    groups,
  };
}

/** Stable, line-oriented report suitable for re-running and diffing. */
export function formatWordListAudit(report: WordListAuditReport): string {
  const lines = [
    "wortschatz word-list audit",
    `words: ${report.rawWords} raw → ${report.acceptedWords} accepted (${report.excludedWords} excluded)`,
    `upstream blacklist: ${report.blacklistEntries} entries`,
    "review flags only; add adjudicated entries to word-exclusions.txt",
  ];
  for (const group of report.groups) {
    lines.push("", `## ${group.reason} (${group.words.length})`);
    for (const word of group.words) lines.push(word);
  }
  return lines.join("\n") + "\n";
}
