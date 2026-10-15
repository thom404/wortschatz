/**
 * The board as it travels on the wire: an opaque `string[16]`, row-major
 * (index 0–3 = top row, left→right). Which strings exist per tile and how a
 * board is generated are owned by ticket #7; this package only fixes the
 * shape so the wire contract compiles today.
 */
export type Board = string[];

/** Board cell geometry: the at-most-8 8-way neighbors of a cell index. */
export function neighbors(index: number): number[] {
  const row = Math.floor(index / 4);
  const col = index % 4;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r > 3 || c < 0 || c > 3) continue;
      out.push(r * 4 + c);
    }
  }
  return out;
}
