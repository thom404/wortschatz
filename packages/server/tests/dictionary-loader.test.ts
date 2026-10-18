import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { buildDawg, serializeDawg } from "../src/dictionary/dawg-blob.js";
import { rawLinesToWords } from "../src/dictionary/index.js";
import { loadDictionary } from "../src/dictionary/loader.js";

const FIXTURE_WORDS = readFileSync(join(import.meta.dirname, "fixtures", "words.txt"), "utf8")
  .split("\n")
  .filter(Boolean);

let dir: string | undefined = undefined;
afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

const silentLog = { info() {}, warn() {}, error() {} };

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
      exclusionsPath: "unused-because-artifact-exists",
      log: { info() {}, warn: (o) => warnings.push(o), error() {} },
    });
    expect(fellBack).toBe(false);
    expect(warnings).toHaveLength(0);
    expect(dictionary.isValid("test")).toBe(true);
    expect(dictionary.isValid("äpfel")).toBe(true);
    expect(dictionary.isValid("apfel")).toBe(false);
  });

  it("falls back to building from the raw word list plus exclusions, with a warning", async () => {
    dir = await mkdtemp(join(tmpdir(), "wm-dict-"));
    const wordsPath = join(dir, "words");
    const exclusionsPath = join(dir, "word-exclusions.txt");
    await writeFile(wordsPath, ["Test", "wort", "de", "straße", "Bébé", "Café"].join("\n"), "utf8");
    await writeFile(exclusionsPath, "# reviewed\nBÉBÉ\n", "utf8");
    const warnings: Record<string, unknown>[] = [];
    const { dictionary, fellBack } = await loadDictionary({
      dawgPath: join(dir, "missing.bin"),
      wordsPath,
      exclusionsPath,
      log: { info() {}, warn: (o) => warnings.push(o), error() {} },
    });
    expect(fellBack).toBe(true);
    expect(warnings[0]?.["event"]).toBe("dawg-fallback-build");
    expect(warnings[0]?.["exclusionsPath"]).toBe(exclusionsPath);
    expect(dictionary.isValid("test")).toBe(true);
    expect(dictionary.isValid("wort")).toBe(true);
    expect(dictionary.isValid("straße")).toBe(true);
    expect(dictionary.isValid("café")).toBe(true);
    expect(dictionary.isValid("bébé")).toBe(false);
    // <3 entries dropped at load, same semantics as in-process creation.
    expect(dictionary.isValid("de")).toBe(false);
  });

  it("gives the artifact and the dev fallback identical acceptance", async () => {
    dir = await mkdtemp(join(tmpdir(), "wm-dict-"));
    const wordsPath = join(dir, "words");
    const exclusionsPath = join(dir, "word-exclusions.txt");
    const dawgPath = join(dir, "dawg.bin");
    const lines = ["Test", "wort", "de", "straße", "Bébé", "Bébés", "Café", "Cliché", "Coupé"];
    const exclusionLines = ["bébé", "bébés"];
    await writeFile(wordsPath, lines.join("\n"), "utf8");
    await writeFile(exclusionsPath, exclusionLines.join("\n"), "utf8");
    // Artifact generation uses the same ingestion seam as the fallback.
    const artifactRoot = buildDawg(rawLinesToWords(lines, exclusionLines));
    await writeFile(dawgPath, serializeDawg(artifactRoot), "utf8");

    const artifact = await loadDictionary({ dawgPath, wordsPath, exclusionsPath, log: silentLog });
    const fallback = await loadDictionary({
      dawgPath: join(dir, "missing.bin"),
      wordsPath,
      exclusionsPath,
      log: silentLog,
    });
    expect(artifact.fellBack).toBe(false);
    expect(fallback.fellBack).toBe(true);

    const sample = ["test", "wort", "straße", "café", "cliché", "coupé", "bébé", "bébés", "de", "fehlt"];
    for (const word of sample) {
      expect(artifact.dictionary.isValid(word), word).toBe(fallback.dictionary.isValid(word));
    }
    expect(artifact.dictionary.isValid("bébé")).toBe(false);
    expect(artifact.dictionary.isValid("café")).toBe(true);
  });
});
