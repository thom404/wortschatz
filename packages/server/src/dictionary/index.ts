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
 *
 * Curation (ADR-0001 amendment, #107): the reviewed exclusion list is
 * subtracted here — the single ingestion seam shared by `createDictionary`,
 * the dev fallback loader and the DAWG build. Exclusion entries are
 * normalized, deduped and must exist in the raw list, so stale curation
 * fails loudly instead of silently doing nothing.
 */
import { PROTOCOL, neighbors, tileStrings, type Tile } from "@wortschatz/shared";
import { normalizeWord } from "../text.js";
import { buildDawg, walk, type DawgNode } from "./dawg.js";

/** The load and lookup paths share the server's one word normalizer. */
export { normalizeWord } from "../text.js";

/**
 * Exclusion-list lines → normalized, deduped entries. Blank lines and lines
 * starting with `#` are comments. Entries shorter than three letters can
 * never be present in the loaded list, so they are rejected up front.
 */
export function normalizeExclusions(lines: string[]): string[] {
  const seen = new Set<string>();
  for (const line of lines) {
    const text = line.trim();
    if (text.length === 0 || text.startsWith("#")) continue;
    const word = normalizeWord(text);
    if (word.length < 3) {
      throw new Error(`word exclusion shorter than 3 letters: ${JSON.stringify(text)}`);
    }
    seen.add(word);
  }
  return [...seen].sort();
}

/**
 * Raw word-list lines → normalized, deduped, ≥3-letters entries with the
 * reviewed exclusions subtracted. Each exclusion must be present in the raw
 * list; a stale or mistyped entry is an error, not a no-op.
 */
export function rawLinesToWords(lines: string[], exclusionLines: string[] = []): string[] {
  const seen = new Set<string>();
  for (const line of lines) {
    const word = normalizeWord(line);
    if (word.length < 3) continue;
    seen.add(word);
  }
  const exclusions = normalizeExclusions(exclusionLines);
  for (const word of exclusions) {
    if (!seen.has(word)) {
      throw new Error(`word exclusion not present in the word list: "${word}"`);
    }
  }
  for (const word of exclusions) seen.delete(word);
  return [...seen];
}

export function createDictionary(lines: string[], exclusionLines: string[] = []): Dictionary {
  const root = buildDawg(rawLinesToWords(lines, exclusionLines));
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
