/**
 * One home for text normalization (ADR-0015): names on Create and Join, words
 * at submission and in the dictionary, and room codes at the wire boundary.
 * Keeping the canonical forms here is what stops the copies from drifting.
 */

/** A nickname's canonical form: NFC, trimmed, at most 24 characters. */
export function normalizeNickname(nickname: string): string {
  return nickname.normalize("NFC").trim().slice(0, 24);
}

/** The collision fold: two names are the same when this form is equal. */
export function fold(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

/** A normalized nickname is valid iff something is left to show. */
export function validNickname(nickname: string): boolean {
  return nickname.length > 0;
}

/**
 * A word's canonical form: NFC, lowercase and trimmed, matching submission
 * and the dictionary's load/lookup semantics (ADR-0001 §9).
 */
export function normalizeWord(word: string): string {
  return word.normalize("NFC").toLowerCase().trim();
}

/** A room code's canonical form: trimmed and uppercase. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}
