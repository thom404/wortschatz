/**
 * The German word-list dictionary (ADR-0001): a deep, server-only module.
 * Public surface: `createDictionary` (from raw lines) and the `Dictionary`
 * class answering membership (`isValid`) and board enumeration
 * (`findWords`). The DAWG stays private to the module.
 *
 * Validity semantics (ADR-0001 §2/§9): case-insensitive with lowercase NFC
 * canonical form; real `ä/ö/ü/ß` with no `ae/oe/ue/ss` aliasing; strict list
 * membership; entries shorter than three letters are dropped at load;
 * colliding entries are deduped.
 */
import { PROTOCOL } from "@wordament/shared";
import { buildDawg, walk, type DawgNode } from "./dawg.js";
import { tileKind, tileStrings, type Tile } from "@wordament/shared";

function normalize(word: string): string {
  return word.normalize("NFC").toLowerCase();
}

export function createDictionary(lines: string[]): Dictionary {
  const seen = new Set<string>();
  for (const line of lines) {
    const word = normalize(line);
    if (word.length < 3) continue;
    seen.add(word);
  }
  const root = buildDawg([...seen]);
  return new Dictionary(root);
}

export class Dictionary {
  private readonly root: DawgNode;

  constructor(root: DawgNode) {
    this.root = root;
  }

  isValid(word: string): boolean {
    const n = normalize(word);
    if (n.length < 3) return false;
    const end = walk(this.root, n);
    return end !== null && end.final;
  }

  /**
   * All distinct words formable on the caller-supplied board: 8-way steps,
   * each tile at most once, candidates per cell from the tile notation
   * (shared `tiles.ts`), min length 3 via the loaded list. Prefix tiles may
   * only start a path, suffix tiles may only end one (word-start/word-end
   * mechanics from #3); either/or tiles try both variants.
   */
  findWords(board: Tile[]): string[] {
    if (board.length !== PROTOCOL.BOARD_SIZE) throw new Error("board must have 16 cells");
    const found = new Set<string>();
    const used = new Array<boolean>(PROTOCOL.BOARD_SIZE).fill(false);

    const record = (s: string, node: DawgNode): void => {
      if (s.length >= 3 && node.final) found.add(s);
    };

    // Step from `node`, letter sequence `s`-so-far, onto cell `t`.
    // Returns nodes reached per variant (multi for either/or tiles).
    const step = (node: DawgNode, s: string, t: number): void => {
      const tile = board[t];
      if (tile === undefined) return;
      const kind = tileKind(tile);
      if (kind === "prefix" && s.length > 0) return; // word-start only
      for (const cand of tileStrings(tile)) {
        const next = walk(node, cand);
        if (!next) continue;
        record(s + cand, next);
        if (kind === "suffix") continue; // word-end only, no further tiles
        used[t] = true;
        for (const nb of neighbors(t)) {
          if (!used[nb]) step(next, s + cand, nb);
        }
        used[t] = false;
      }
    };

    for (let c = 0; c < PROTOCOL.BOARD_SIZE; c += 1) {
      used.fill(false);
      used[c] = true;
      step(this.root, "", c);
    }
    return [...found];
  }
}

export function neighbors(t: number): number[] {
  const r = Math.floor(t / 4);
  const col = t % 4;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = col + dc;
      if (nr < 0 || nr > 3 || nc < 0 || nc > 3) continue;
      out.push(nr * 4 + nc);
    }
  }
  return out;
}
