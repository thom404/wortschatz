/**
 * Scoring engine: the #6-ticket resolution formula behind the `ScoreFn`
 * seam. A word scores the plain sum of its letters' canonical German
 * Scrabble values — no length multiplier, no multiplier tiles.
 *
 * The engine is a pure word function on purpose: the word string already
 * contains the letters the player actually spelled, so tile structure never
 * needs inspecting. The #6 rules fall out for free:
 * - a multi-letter tile (`ch`, `sch`, prefix/suffix) contributes the sum of
 *   its constituent letters' values, and its letters count toward the
 *   length gate (which tests the word string);
 * - an either/or tile (`e/ä`) scores the value of the variant the player
 *   actually spelled, never the sum of both options;
 * - a `ß`/`SS` tile, were one shipped, is worth 2;
 * - dedupe identity stays the word string — same spelling, same score.
 */
import type { ScoreFn } from "../config.js";

/**
 * The canonical German Scrabble value table pinned by #6:
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

/** The production `ScoreFn`: every seat's word scores identically. */
export const germanScore: ScoreFn = (word) => wordScore(word);
