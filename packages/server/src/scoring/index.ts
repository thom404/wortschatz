/**
 * Server scoring seam: the injectable `ScoreFn` production uses. The German
 * Scrabble table, its floor, the per-character lookup and the word sum live
 * on the shared package's scoring surface so the client's tile values read
 * the very same table; this module re-exports those names so existing server
 * imports and behaviour are unchanged.
 *
 * The engine is a pure word function on purpose: the word string already
 * contains the letters the player actually spelled, so tile structure never
 * needs inspecting. The #6 rules fall out for free:
 * - a digram tile (`ch`, `sch`) contributes the sum of its constituent
 *   letters' values, and its letters count toward the length gate (which
 *   tests the word string);
 * - an either/or tile (`e/ä`) scores the value of the variant the player
 *   actually spelled, never the sum of both options;
 * - a `ß`/`SS` tile, were one shipped, is worth 2;
 * - dedupe identity stays the word string — same spelling, same score.
 */
import { wordScore } from "@wortschatz/shared";
import type { ScoreFn } from "../config.js";

export { LETTER_VALUES, MIN_VALUE, charScore, wordScore } from "@wortschatz/shared";

/** The production `ScoreFn`: every seat's word scores identically. */
export const germanScore: ScoreFn = (word) => wordScore(word);
