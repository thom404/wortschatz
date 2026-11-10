/**
 * DAWG artifact (de)serialization: line 0 carries the root node id; each
 * following line is one node, post-order so children exist before parents
 * on load. Private to the dictionary module; the build script writes it,
 * the loader reads it.
 */
import { buildDawg, type DawgNode } from "./dawg.js";

export { buildDawg, walk } from "./dawg.js";

export function serializeDawg(root: DawgNode): string {
  const idOf = new Map<DawgNode, number>();
  const lines: string[] = [];
  const emit = (node: DawgNode): number => {
    const known = idOf.get(node);
    if (known !== undefined) return known;
    const childIds: string[] = [];
    for (const [ch, child] of node.edges) {
      childIds.push(`${ch}:${emit(child)}`);
    }
    const id = lines.length;
    idOf.set(node, id);
    lines.push(`${node.final ? "1" : "0"}|${childIds.join(",")}`);
    return id;
  };
  const rootId = emit(root);
  return `${rootId}\n${lines.join("\n")}`;
}

export function deserializeDawg(text: string): DawgNode {
  const parts = text.trimEnd().split("\n");
  const rootId = Number(parts[0]);
  const raw = parts.slice(1);
  if (!Number.isInteger(rootId) || rootId < 0 || rootId >= raw.length) {
    throw new Error("dawg artifact corrupt: root id out of range");
  }
  const nodes: DawgNode[] = raw.map((line) => {
    const [flags] = line.split("|");
    return { final: flags === "1", edges: new Map() };
  });
  for (let i = 0; i < raw.length; i++) {
    const edges = raw[i]!.split("|")[1] ?? "";
    if (edges === "") continue;
    for (const entry of edges.split(",")) {
      if (entry === "") continue;
      const sep = entry.lastIndexOf(":");
      const ch = entry.slice(0, sep);
      const child = Number(entry.slice(sep + 1));
      if (!Number.isInteger(child) || child >= i) {
        throw new Error("dawg artifact corrupt: child out of order");
      }
      const childNode = nodes[child];
      if (childNode === undefined) throw new Error("dawg artifact corrupt: missing child");
      nodes[i]!.edges.set(ch, childNode);
    }
  }
  return nodes[rootId]!;
}
