/**
 * Dictionary loading (ADR-0001 §4/§7, ADR-0003 determinism budget):
 * artifact-first — the DAWG blob generated at Docker build is read instantly;
 * a dev fallback builds the DAWG in-process from the committed raw word list
 * plus the reviewed exclusion list, with a structured warning. Production
 * wiring uses this in `main.ts`.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "../config.js";
import { Dictionary, createDictionary } from "./index.js";
import { deserializeDawg } from "./dawg-blob.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Default: `dawg.bin` beside the compiled package output. */
export function defaultDawgPath(): string {
  return join(moduleDir, "..", "dawg.bin");
}

/** Default: the committed raw list at the repo root. */
export function defaultWordsPath(): string {
  // src|dist/dictionary → src|dist → packages/server → packages → repo root
  return join(moduleDir, "..", "..", "..", "..", "words");
}

/** Default: the reviewed exclusions beside the server package sources. */
export function defaultExclusionsPath(): string {
  // src|dist/dictionary → src|dist → packages/server
  return join(moduleDir, "..", "..", "word-exclusions.txt");
}

export interface LoadDictionaryOptions {
  dawgPath?: string;
  wordsPath?: string;
  exclusionsPath?: string;
  log?: Logger;
}

export async function loadDictionary(
  opts: LoadDictionaryOptions = {}
): Promise<{ dictionary: Dictionary; fellBack: boolean }> {
  const dawgPath = opts.dawgPath ?? defaultDawgPath();
  const wordsPath = opts.wordsPath ?? defaultWordsPath();
  const exclusionsPath = opts.exclusionsPath ?? defaultExclusionsPath();
  const log = opts.log ?? { info() {}, warn() {}, error() {} };

  let blob: string;
  try {
    blob = await readFile(dawgPath, "utf8");
  } catch {
    const lines = (await readFile(wordsPath, "utf8")).split("\n");
    const exclusions = (await readFile(exclusionsPath, "utf8")).split("\n");
    const dictionary = createDictionary(lines, exclusions);
    log.warn({ event: "dawg-fallback-build", dawgPath, wordsPath, exclusionsPath });
    return { dictionary, fellBack: true };
  }
  return { dictionary: new Dictionary(deserializeDawg(blob)), fellBack: false };
}
