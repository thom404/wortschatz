/** The scoring surface is the shared table, re-exported for server callers
 *  (the engine and client read the same values). */
export { LETTER_VALUES, MIN_VALUE, charScore, wordScore } from "@wortschatz/shared";
import { wordScore } from "@wortschatz/shared";
import type { ScoreFn } from "../config.js";

/** The production `ScoreFn`: every seat's word scores identically. */
export const germanScore: ScoreFn = (word) => wordScore(word);
