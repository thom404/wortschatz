import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { buildDawg, serializeDawg } from "../src/dictionary/dawg-blob.js";
import { loadDictionary } from "../src/dictionary/loader.js";

const FIXTURE_WORDS = readFileSync(join(import.meta.dirname, "fixtures", "words.txt"), "utf8")
  .split("\n")
  .filter(Boolean);

let dir: string;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined as unknown as string;
});

describe("loadDictionary", () => {
  it("loads artifact-first, no fallback warning", async () => {
    dir = await mkdtemp(join(tmpdir(), "wm-dict-"));
    const dawgPath = join(dir, "dawg.bin");
    const root = buildDawg(["test", "wort", "äpfel"]);
    await writeFile(dawgPath, serializeDawg(root), "utf8");
    const warnings: unknown[] = [];
    const { dictionary, fellBack } = await loadDictionary({
      dawgPath,
      wordsPath: "unused-because-artifact-exists",
      log: { warn: (o) => warnings.push(o) } as never,
    });
    expect(fellBack).toBe(false);
    expect(warnings).toHaveLength(0);
    expect(dictionary.isValid("test")).toBe(true);
    expect(dictionary.isValid("äpfel")).toBe(true);
    expect(dictionary.isValid("apfel")).toBe(false);
  });

  it("falls back to building from the raw word list, with a warning", async () => {
    dir = await mkdtemp(join(tmpdir(), "wm-dict-"));
    const wordsPath = join(dir, "words");
    await writeFile(wordsPath, ["Test", "wort", "de", "straße"].join("\n"), "utf8");
    const warnings: Record<string, unknown>[] = [];
    const { dictionary, fellBack } = await loadDictionary({
      dawgPath: join(dir, "missing.bin"),
      wordsPath,
      log: { warn: (o) => warnings.push(o) } as never,
    });
    expect(fellBack).toBe(true);
    expect(warnings[0]?.["event"]).toBe("dawg-fallback-build");
    expect(dictionary.isValid("test")).toBe(true);
    expect(dictionary.isValid("wort")).toBe(true);
    expect(dictionary.isValid("straße")).toBe(true);
    // <3 entries dropped at load, same semantics as in-process creation.
    expect(dictionary.isValid("de")).toBe(false);
  });
});

void readFile;
