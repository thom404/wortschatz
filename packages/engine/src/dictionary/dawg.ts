/**
 * The DAWG: a minimal acyclic FSA over the word list. It stays private to
 * the dictionary module (ADR-0001 §6/§8): the module's surface is
 * `isValid`/`findWords`/`createDictionary` only.
 *
 * Construction is the classic incremental minimization for sorted input:
 * beyond the divergence point, nodes are interned bottom-up by structural
 * signature, so suffix sharing happens without a transient full trie.
 */
export interface DawgNode {
  final: boolean;
  edges: Map<string, DawgNode>;
}

interface FreshNode {
  final: boolean;
  edges: Map<string, FreshNode>;
}

/**
 * Build the DAWG from words; input is normalized upstream but the builder
 * only requires code-point-sorted-able strings. Duplicates and empties are
 * skipped.
 */
export function buildDawg(words: string[]): DawgNode {
  const root: FreshNode = { final: false, edges: new Map() };
  const sorted = [...words].sort();
  const ids = new Map<FreshNode, number>();
  const registry = new Map<string, FreshNode>();
  let nextId = 0;

  const intern = (node: FreshNode): FreshNode => {
    if (ids.has(node)) return node;
    // Signature from already-interned children plus the final flag.
    let sig = node.final ? "F" : "N";
    for (const ch of [...node.edges.keys()].sort()) {
      const child = ids.get(node.edges.get(ch)!);
      if (child === undefined) throw new Error("dawg: internal order violation");
      sig += `|${ch}:${child}`;
    }
    const canonical = registry.get(sig);
    if (canonical) return canonical;
    ids.set(node, nextId++);
    registry.set(sig, node);
    return node;
  };

  // The current path; entries carry the char that led into the node.
  const path: { ch: string; node: FreshNode }[] = [{ ch: "", node: root }];
  const commonPrefixLen = (a: string, b: string): number => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    return i;
  };

  let last = "";
  for (const word of sorted) {
    if (word.length === 0) continue;
    if (word === last) continue;
    const k = commonPrefixLen(last, word);
    // Intern the previous word's states below the attach node, deepest first.
    while (path.length - 1 > k) {
      const entry = path.pop()!;
      const parent = path[path.length - 1]!.node;
      const canonical = intern(entry.node);
      parent.edges.set(entry.ch, canonical);
    }
    const attach = path[path.length - 1]!.node;
    let cursor = attach;
    const runes = Array.from(word);
    for (let i = k; i < runes.length; i += 1) {
      const ch = runes[i]!;
      const fresh: FreshNode = { final: false, edges: new Map() };
      cursor.edges.set(ch, fresh);
      cursor = fresh;
      path.push({ ch, node: fresh });
    }
    cursor.final = true;
    last = word;
  }

  // Minimize the final word's tail.
  while (path.length - 1 > 0) {
    const entry = path.pop()!;
    const parent = path[path.length - 1]!.node;
    const canonical = intern(entry.node);
    parent.edges.set(entry.ch, canonical);
  }

  return root;
}

/** Walk the automaton along a letter sequence; null when paths diverge. */
export function walk(root: DawgNode, word: string): DawgNode | null {
  let node: DawgNode | null = root;
  for (const ch of word) {
    node = node?.edges.get(ch) ?? null;
    if (!node) return null;
  }
  return node;
}
