/**
 * Round-end reveal (#6 resolution, #17 concrete shape): from the round's
 * enumerated findable words, build the grouped payload — groups ascend by
 * word length, every word priced by the injected scoring engine (the same
 * price every seat's submissions were awarded), found words annotated with
 * their finders' seat ids, missed words present with an empty `foundBy`. No
 * tile paths, no first-finder credit — the reveal trusts the enumerated list
 * and the submit path, redisplaying rather than re-deciding.
 */
import type { RevealPayload, RevealGroup } from "@wordament/shared";
import type { RevealFn } from "./config.js";

export const revealAll: RevealFn = ({ words, wordsBySeat, points }) => {
  const finders = new Map<string, number[]>();
  for (const [seatId, found] of wordsBySeat) {
    for (const word of found) {
      const ids = finders.get(word);
      if (ids) ids.push(seatId);
      else finders.set(word, [seatId]);
    }
  }
  const byLength = new Map<number, RevealPayload["groups"][number]["words"]>();
  for (const word of words) {
    let list = byLength.get(word.length);
    if (!list) {
      list = [];
      byLength.set(word.length, list);
    }
    const foundBy = [...(finders.get(word) ?? [])].sort((x, y) => x - y);
    list.push({ word, points: points(word), foundBy });
  }
  const groups: RevealGroup[] = [...byLength.entries()]
    .sort(([a], [b]) => a - b)
    .map(([length, list]) => ({ length, words: list.sort(byWord) }));
  return { groups };
};

function byWord(a: { word: string }, b: { word: string }): number {
  return a.word < b.word ? -1 : a.word > b.word ? 1 : 0;
}
