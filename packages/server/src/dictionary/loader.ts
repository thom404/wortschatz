/**
 * Dictionary loading (ADR-0001 §4/§7, ADR-0003 determinism budget):
 * artifact-first — the DAWG blob generated at Docker build is read instantly;
 * a dev fallback builds the DAWG in-process from the committed raw word list,
 * with a structured warning. Production wiring uses this in `main.ts`.
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

export interface LoadDictionaryOptions {
  dawgPath?: string;
  wordsPath?: string;
  log?: Logger;
}

export async function loadDictionary(
  opts: LoadDictionaryOptions = {}
): Promise<{ dictionary: Dictionary; fellBack: boolean }> {
  const dawgPath = opts.dawgPath ?? defaultDawgPath();
  const wordsPath = opts.wordsPath ?? defaultWordsPath();
  const log = opts.log ?? { info() {}, warn() {}, error() {} };

  let blob: string;
  try {
    blob = await readFile(dawgPath, "utf8");
  } catch {
    const dictionary = createDictionary((await readFile(wordsPath, "utf8")).split("\n"));
    log.warn({ event: "dawg-fallback-build", dawgPath, wordsPath });
    return { dictionary, fellBack: true };
  }
  return { dictionary: new Dictionary(deserializeDawg(blob)), fellBack: false };
}
