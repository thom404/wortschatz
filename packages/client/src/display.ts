/**
 * Display is independent of data (ADR-0002): every rendered tile or word
 * goes through this one pure mapping. The uppercase look is CSS's; the one
 * letter the browser's Unicode full case mapping would expand, `ß` → `SS`,
 * is substituted with capital `ẞ` (U+1E9E) so it stays a single unmistakable
 * glyph and a `ß` word never collides with an `ss` word.
 *
 * The mapping changes display only: submission, matching and scoring keep
 * spelling the canonical `ß` from the data.
 */

/** The letters a word shows on every word surface (`ß` → `ẞ`, nothing else). */
export function displayWord(word: string): string {
  return word.replace(/ß/g, "ẞ");
}

/** The displayed tile notation: prefix/suffix markers drop off, either/or
 *  tiles keep both candidate variants, and the letters take the same
 *  `ß` → `ẞ` mapping as every word surface. */
export function displayTile(t: string): string {
  if (t.includes("/")) return displayWord(t);
  return displayWord(t.replace(/^-|-$/g, ""));
}
