/**
 * Placeholder implementations of the injected domain seams for tests that
 * need fixed boards/dictionaries. Production wires the real modules in
 * `main.ts` (dictionary + boardgen from #7, scoring + reveal from #6/#17).
 */
import type { DictionaryLike, BoardGenerator } from "./config.js";

export class PlaceholderDictionary implements DictionaryLike {
  private readonly words: Set<string>;
  constructor(words: string[]) {
    this.words = new Set(words.map((w) => w.normalize("NFC").toLowerCase()));
  }
  isValid(word: string): boolean {
    return this.words.has(word.normalize("NFC").toLowerCase());
  }
}

/** Placeholder board: pseudo-random single letters (a–f) so games run. */
export const placeholderBoard: BoardGenerator = (seed: bigint) => {
  let state = seed & 0x7fffffffffffffffn;
  const next = () => {
    state = (state * 1103515245n + 12345n) & 0x7fffffffffffffffn;
    return Number(state / 0x7fffffffn) / 0x7fffffff;
  };
  const bag = "abcdef";
  return {
    board: Array.from({ length: 16 }, () => bag.charAt(Math.floor(next() * 6))),
    words: [],
  };
};
