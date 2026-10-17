/**
 * The German word-list dictionary (ADR-0001): a deep, server-only module.
 * Public surface: `createDictionary`/`rawLinesToWords` (from raw lines) and
 * the `Dictionary` class answering membership (`isValid`) and
 * *constraint-oblivious* board enumeration (`findWords`). The DAWG stays
 * private to the module. Special-tile positioning (prefix word-start,
 * suffix word-end, either/or variants) is NOT applied here — tile rules
 * live with the board (#7 boardgen); the enumerated superset is
 * post-filtered there via `isFormable` (ADR-0003 §8).
 *
 * Validity semantics (ADR-0001 §2/§9): case-insensitive with lowercase NFC
 * canonical form; real `ä/ö/ü/ß` with no `ae/oe/ue/ss` aliasing; strict list
 * membership; entries shorter than three letters are dropped at load;
 * colliding entries are deduped.
 */
import { PROTOCOL, neighbors, tileStrings, type Tile } from "@wortschatz/shared";
import { buildDawg, walk, type DawgNode } from "./dawg.js";

export function normalizeWord(word: string): string {
  return word.normalize("NFC").toLowerCase();
}

/** Raw word-list lines → normalized, deduped, ≥3-letters entries. */
export function rawLinesToWords(lines: string[]): string[] {
  const seen = new Set<string>();
  for (const line of lines) {
    const word = normalizeWord(line);
    if (word.length < 3) continue;
    seen.add(word);
  }
  return [...seen];
}

export function createDictionary(lines: string[]): Dictionary {
  const root = buildDawg(rawLinesToWords(lines));
  return new Dictionary(root);
}

export class Dictionary {
  private readonly root: DawgNode;

  constructor(root: DawgNode) {
    this.root = root;
  }

  /** Membership check; case/NFC-insensitive like the load path. */
  isValid(word: string): boolean {
    const n = normalizeWord(word);
    if (n.length < 3) return false;
    const end = walk(this.root, n);
    return end !== null && end.final;
  }

  /**
   * All distinct words spellable on the caller-supplied board, IGNORING
   * special-tile positioning: 8-way steps, each tile at most once, candidate
   * letter-strings per cell from the tile notation, min length 3 via the
   * loaded list. Either/or tiles contribute both variants. Callers apply
   * tile constraints by post-filtering with `isFormable` (boardgen).
   */
  findWords(board: Tile[]): string[] {
    if (board.length !== PROTOCOL.BOARD_SIZE) throw new Error("board must have 16 cells");
    const found = new Set<string>();
    const used = new Array<boolean>(PROTOCOL.BOARD_SIZE).fill(false);

    const step = (node: DawgNode, s: string, t: number): void => {
      const tile = board[t];
      if (tile === undefined) return;
      for (const cand of tileStrings(tile)) {
        const next = walk(node, cand);
        if (!next) continue;
        const word = s + cand;
        if (word.length >= 3 && next.final) found.add(word);
        used[t] = true;
        for (const nb of neighbors(t)) {
          if (!used[nb]) step(next, word, nb);
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
