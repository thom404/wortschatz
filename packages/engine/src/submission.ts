/**
 * The one word-acceptance rule, shared by the server's rooms and the local
 * solo authority. It normalizes both readings, rejects short words, resolves
 * an either/or alternate, requires formability, requires dictionary
 * membership, treats the resolved word as duplicate identity and prices the
 * accepted word. Rooms record the verdict against a seat; solo records it
 * against its own player id.
 */
import type { ErrorCode } from "@wortschatz/shared";
import { isFormable } from "./boardgen/index.js";
import { normalizeWord } from "./text.js";

export interface SubmissionDictionary {
  isValid(word: string): boolean;
}

export interface SubmissionRuleInput {
  /** The raw primary reading sent by the player. */
  word: string;
  /** The optional second reading of an either/or tile on the path. */
  alternate?: string | undefined;
  board: readonly string[];
  dictionary: SubmissionDictionary;
  /** Words already accepted for this player this round. */
  foundWords: ReadonlySet<string> | readonly string[];
  /** The word's price in this game; server and solo use the same table. */
  points: (word: string) => number;
}

export type SubmissionVerdict =
  { kind: "accepted"; word: string; points: number } | { kind: "rejected"; code: ErrorCode; detail?: string };

function hasWord(found: ReadonlySet<string> | readonly string[], word: string): boolean {
  return Array.isArray(found) ? found.includes(word) : (found as ReadonlySet<string>).has(word);
}

/**
 * Decide one submission. The primary reading is tried first; an either/or
 * alternate joins it. The best valid reading wins by points, then length,
 * then alphabetical order (ADR-0027). The resolved word — not the raw path
 * or primary reading — is the duplicate identity.
 */
export function submissionVerdict(input: SubmissionRuleInput): SubmissionVerdict {
  const word = normalizeWord(input.word);
  if (word.length < 3) return { kind: "rejected", code: "invalid-word", detail: "too short" };

  const readings = new Set([word]);
  if (input.alternate !== undefined) readings.add(normalizeWord(input.alternate));

  const candidates = [...readings]
    .filter(
      (candidate) =>
        candidate.length >= 3 &&
        isFormable(candidate, input.board as string[]) &&
        input.dictionary.isValid(candidate)
    )
    .map((candidate) => ({ word: candidate, points: input.points(candidate) }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.word.length - a.word.length ||
        (a.word < b.word ? -1 : a.word > b.word ? 1 : 0)
    );

  const best = candidates[0];
  if (!best) {
    if (!isFormable(word, input.board as string[])) {
      return { kind: "rejected", code: "invalid-word", detail: "not placeable" };
    }
    return { kind: "rejected", code: "invalid-word", detail: word };
  }
  if (hasWord(input.foundWords, best.word)) {
    return { kind: "rejected", code: "word-duplicate", detail: best.word };
  }
  return { kind: "accepted", word: best.word, points: best.points };
}

/** Descriptive aliases: the same rule table under the names callers use. */
export const judgeSubmission = submissionVerdict;
export const evaluateSubmission = submissionVerdict;
