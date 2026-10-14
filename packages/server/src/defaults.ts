/**
 * Placeholder implementations of the injected domain seams until their
 * tickets land. The wire contract has no dependency on their internals:
 * #7 replaces the board generator (and the real dictionary per ADR-0001),
 * #6 replaces scoring and the reveal payload.
 */
import type { RevealFn, ScoreFn, DictionaryLike, BoardGenerator } from "./config.js";

export class PlaceholderDictionary implements DictionaryLike {
  private readonly words: Set<string>;
  constructor(words: string[]) {
    this.words = new Set(words.map((w) => w.normalize("NFC").toLowerCase()));
  }
  isValid(word: string): boolean {
    return this.words.has(word.normalize("NFC").toLowerCase());
  }
  isPathable(word: string, board: string[]): boolean {
    return isPlaceableOnBoard(word, board);
  }
}

/**
 * Structural walk over the 4x4 board: 8-way adjacency, each tile at most
 * once, matching the word's letter sequence. Works for single-letter tiles
 * (the current placeholder board); multi-letter cells are #7's extension.
 */
export function isPlaceableOnBoard(word: string, board: string[]): boolean {
  if (word.length < 3 || word.length > board.length) return false;
  const used = new Array<boolean>(board.length).fill(false);
  const letters = Array.from(word);

  const walk = (i: number, k: number): boolean => {
    if (k >= letters.length) return true;
    for (let t = 0; t < board.length; t++) {
      if (used[t] || board[t] !== letters[k]) continue;
      if (k > 0 && !adjacent(i, t)) continue;
      used[t] = true;
      if (walk(t, k + 1)) {
        used[t] = false;
        return true;
      }
      used[t] = false;
    }
    return false;
  };
  return walk(-1, 0);
}

function adjacent(a: number, b: number): boolean {
  const r1 = Math.floor(a / 4);
  const c1 = a % 4;
  const r2 = Math.floor(b / 4);
  const c2 = b % 4;
  return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1 && !(r1 === r2 && c1 === c2);
}

/** Placeholder board: pseudo-random single letters (a–f) so games run. */
export const placeholderBoard: BoardGenerator = (roundNumber) => {
  let seed = (roundNumber + 1) * 2654435761;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const bag = "abcdef";
  return Array.from({ length: 16 }, () => bag.charAt(Math.floor(next() * 6)));
};

/** Placeholder scoring: one point per letter (ticket #6 replaces this). */
export const placeholderScore: ScoreFn = (word) => word.length;

/** Placeholder reveal: an empty payload (ticket #6 replaces this). */
export const placeholderReveal: RevealFn = () => ({});
