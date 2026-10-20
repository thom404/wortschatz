/**
 * The shared scoring surface: the canonical German Scrabble table, its floor
 * value, per-character and word sums, and the tile-value projection the board
 * displays. The server awards points through the same table, so a tile's
 * corner number can never disagree with the scoreboard.
 *
 * A word scores the plain sum of its letters' values — no length multiplier,
 * no multiplier tiles. Tile structure never needs inspecting: a multi-letter
 * tile contributes the sum of its constituent letters, and an either/or tile
 * scores the variant the player actually spelled.
 */
import type { Tile } from "./tiles.js";
import { tileStrings } from "./tiles.js";

/**
 * The canonical German Scrabble value table:
 * 1 = e n s i r t u a d · 2 = h g l o · 3 = m b w z · 4 = c f k p ·
 * 6 = ä j ü v · 8 = ö x · 10 = q y · ß = 2 (the value of an SS pair).
 */
export const LETTER_VALUES: Readonly<Record<string, number>> = {
  e: 1,
  n: 1,
  s: 1,
  i: 1,
  r: 1,
  t: 1,
  u: 1,
  a: 1,
  d: 1,
  h: 2,
  g: 2,
  l: 2,
  o: 2,
  m: 3,
  b: 3,
  w: 3,
  z: 3,
  c: 4,
  f: 4,
  k: 4,
  p: 4,
  ä: 6,
  j: 6,
  ü: 6,
  v: 6,
  ö: 8,
  x: 8,
  q: 10,
  y: 10,
  ß: 2,
} as const;

/** Any character the table does not carry is worth this much. */
export const MIN_VALUE = 1;

/** One letter's table value; any off-table character clamps to the floor. */
export function charScore(ch: string): number {
  return LETTER_VALUES[ch] ?? MIN_VALUE;
}

/** Plain sum of the word's letters' values (letters are NFC-normalized per ADR-0001's word rules). */
export function wordScore(word: string): number {
  let total = 0;
  for (const ch of word) total += charScore(ch);
  return total;
}

/**
 * The points for each spelling a tile can produce: one entry for single,
 * digram, prefix and suffix tiles, and one per variant for either/or tiles in
 * the order the variants are declared. Display collapses equal variants and
 * joins differing ones with `/`; the game never scores a whole either/or tile.
 */
export function tileValues(tile: Tile): number[] {
  return tileStrings(tile).map(wordScore);
}
