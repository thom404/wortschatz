import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The app version's one source of truth (#181): the root workspace
 * manifest's `version` field. The client build (`vite.config.ts`) and the
 * behavior-test config (`vitest.config.ts`) both call this reader and inject
 * its result as `__APP_VERSION__`; `src/version.ts` exposes the injected
 * value as `APP_VERSION`. No other place may carry the literal.
 */
export function readAppVersion(): string {
  const manifestPath = findRootManifest();
  const manifest = readManifest(manifestPath);
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`The root manifest (${manifestPath}) has no version field.`);
  }
  return manifest.version;
}

/** Walk up from the run directory (root for `npm test`, the client package
 *  for `vite build`) and from this module, and take the workspace root — the
 *  manifest that owns the workspaces. */
function findRootManifest(): string {
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    for (let dir = resolve(start); ; dir = dirname(dir)) {
      const candidate = resolve(dir, "package.json");
      const manifest = readManifest(candidate);
      if (manifest.name === "wortschatz" && Array.isArray(manifest.workspaces)) {
        return candidate;
      }
      if (dirname(dir) === dir) break;
    }
  }
  throw new Error("Could not find the root wortschatz manifest.");
}

function readManifest(path: string): { name?: unknown; version?: unknown; workspaces?: unknown } {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as {
      name?: unknown;
      version?: unknown;
      workspaces?: unknown;
    };
  } catch {
    return {};
  }
}
