/**
 * Text normalization that belongs to the game rules. Word canonical form is
 * NFC + lowercase + trim, matching dictionary load/lookup and submission
 * (ADR-0001 §9). Names and room codes stay server-side wire concerns.
 */

/** A word's canonical form: NFC, lowercase and trimmed. */
export function normalizeWord(word: string): string {
  return word.normalize("NFC").toLowerCase().trim();
}
