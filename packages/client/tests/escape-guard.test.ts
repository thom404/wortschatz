import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The one-home guard (#163, ADR-0015): the five-character escaping table lives
 * in exactly one module. This scans the client's TypeScript source for another
 * copy and is itself tested against a planted copy, so a green result proves
 * the check ran rather than merely existing.
 */

const CLIENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_SRC = join(CLIENT_ROOT, "src");

/** The table's entity literals in replacement order. */
const ENTITIES = ["&amp;", "&lt;", "&gt;", "&quot;", "&#39;"] as const;

function containsTable(source: string): boolean {
  let cursor = 0;
  for (const entity of ENTITIES) {
    const at = source.indexOf(entity, cursor);
    if (at === -1) return false;
    cursor = at + entity.length;
  }
  return true;
}

/** The paths whose source still holds the table, skipping the helper itself. */
export function findTableCopies(sources: ReadonlyMap<string, string>): string[] {
  return [...sources]
    .filter(([path, source]) => !isHelper(path) && containsTable(source))
    .map(([path]) => path);
}

function isHelper(path: string): boolean {
  return path === "escape.ts" || path.endsWith("/escape.ts") || path.endsWith("\\escape.ts");
}

/** The client's TypeScript source, excluding the vendored QR encoder. */
function readClientSources(dir: string, sources = new Map<string, string>()): Map<string, string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "vendor") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) readClientSources(full, sources);
    else if (entry.name.endsWith(".ts")) sources.set(relative(CLIENT_ROOT, full), readFileSync(full, "utf8"));
  }
  return sources;
}

describe("escaping table has one home (#163)", () => {
  it("finds no copy in the client's TypeScript source", () => {
    const offenders = findTableCopies(readClientSources(CLIENT_SRC));
    const hint = offenders.length
      ? `Import escapeHtml from ./escape.js instead of copying the table in: ${offenders.join(", ")}`
      : "No copied escaping table found.";
    expect(offenders, hint).toEqual([]);
  });

  it("returns the path of a planted copy, proving the guard can fail", () => {
    const plantedPath = "packages/client/src/planted.ts";
    const planted = `const escape = (s: string) => s.replace(/[&<>"']/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
    );`;
    expect(findTableCopies(new Map([[plantedPath, planted]]))).toEqual([plantedPath]);
  });
});
