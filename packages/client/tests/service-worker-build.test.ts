import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { readAppVersion } from "../app-version.js";
import { APP_SHELL_CACHE_PREFIX } from "../src/app-shell.js";

const CLIENT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const VERSION = readAppVersion();
const DAWG_PUBLIC_PATH = join(CLIENT_ROOT, "public", "data", "dawg.bin");
let createdDawg = false;

let outDir: string;
let files: string[];
let serviceWorker: string;
let mainScript: string;

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? listFiles(join(dir, entry.name), path) : [path];
    })
  );
  return nested.flat().sort();
}

beforeAll(async () => {
  // The artifact is a build product and never committed. Materialise a
  // fixture one so this test proves the dictionary is in the precache set.
  try {
    await access(DAWG_PUBLIC_PATH);
  } catch {
    await mkdir(join(CLIENT_ROOT, "public", "data"), { recursive: true });
    await writeFile(DAWG_PUBLIC_PATH, "0\n0|", "utf8");
    createdDawg = true;
  }
  outDir = await mkdtemp(join(tmpdir(), "wortschatz-client-build-"));
  await build({
    root: CLIENT_ROOT,
    mode: "production",
    logLevel: "silent",
    build: { outDir, emptyOutDir: true },
  });
  files = await listFiles(outDir);
  serviceWorker = await readFile(join(outDir, "sw.js"), "utf8");
  const scripts = files.filter((path) => path.startsWith("assets/") && path.endsWith(".js"));
  expect(scripts).toHaveLength(1);
  mainScript = await readFile(join(outDir, scripts[0]!), "utf8");
}, 60_000);

afterAll(async () => {
  if (outDir) await rm(outDir, { recursive: true, force: true });
  if (createdDawg) await rm(DAWG_PUBLIC_PATH, { force: true });
});

describe("production app shell build", () => {
  it("emits the Home document, hashed scripts and styles, manifest, four icons and one worker", () => {
    expect(files).toContain("index.html");
    expect(files).toContain("manifest.webmanifest");
    expect(files).toContain("data/dawg.bin");
    expect(files).toContain("sw.js");
    expect(files.filter((path) => path.startsWith("assets/") && path.endsWith(".js"))).toHaveLength(1);
    expect(files.filter((path) => path.startsWith("assets/") && path.endsWith(".css"))).toHaveLength(1);
    for (const icon of [
      "icons/icon-192.png",
      "icons/icon-512.png",
      "icons/icon-512-maskable.png",
      "icons/apple-touch-icon.png",
    ])
      expect(files).toContain(icon);
  });

  it("injects exactly the shell precache set, excluding the worker and the vector source", () => {
    const precache = [...serviceWorker.matchAll(/"url":"([^"]+)"/g)].map((match) => match[1]!);
    const hashedAssets = files.filter(
      (path) => path.startsWith("assets/") && (path.endsWith(".js") || path.endsWith(".css"))
    );

    expect(precache.sort()).toEqual(
      [
        "index.html",
        "manifest.webmanifest",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/icon-512-maskable.png",
        "icons/apple-touch-icon.png",
        "data/dawg.bin",
        ...hashedAssets,
      ].sort()
    );
    expect(precache).not.toContain("sw.js");
    expect(precache).not.toContain("icons/letter-mark.svg");
  });

  it("names the cache after the app version and registers the worker once in production", () => {
    expect(serviceWorker).toContain(APP_SHELL_CACHE_PREFIX);
    expect(serviceWorker).toContain(VERSION);
    expect(mainScript.match(/\/sw\.js/g)).toHaveLength(1);
  });
});
