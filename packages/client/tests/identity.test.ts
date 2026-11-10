// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountHarness, type Mounted } from "./harness.js";
import { pageBackground, SKINS } from "../src/skins.js";

/**
 * The installed app's identity (issue #255): the Home document's head, the
 * manifest's colours and the theme colour mirroring the active Skin.
 */
const CLIENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_HTML = readFileSync(join(CLIENT_ROOT, "index.html"), "utf8");

let app: Mounted | null = null;

beforeEach(() => {
  window.history.pushState({}, "", "/");
  app = mountHarness();
});

afterEach(() => {
  app?.unmount();
  app = null;
});

function themeColor(): string {
  return document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? "";
}

function chooseSkin(value: string): void {
  const select = app!.root.querySelector<HTMLSelectElement>("#skin-select")!;
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

describe("installable identity (#255)", () => {
  it("links the manifest, Apple touch icon and 192 favicon, and declares the Standard theme", () => {
    expect(INDEX_HTML).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(INDEX_HTML).toContain(
      '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />'
    );
    expect(INDEX_HTML).toContain(
      '<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />'
    );
    expect(INDEX_HTML).toContain('<meta name="theme-color" content="#f4f7fb" />');
  });

  it("mirrors the Standard page background on boot", () => {
    expect(themeColor()).toBe("#f4f7fb");
    expect(pageBackground("standard")).toBe("#f4f7fb");
  });

  it("follows every Skin change in both directions", () => {
    chooseSkin("arcade");
    expect(themeColor()).toBe("#0b0f1c");

    chooseSkin("standard");
    expect(themeColor()).toBe("#f4f7fb");
  });

  it("boots onto the stored Arcade Skin with its dark theme colour", () => {
    localStorage.setItem("wordament:skin", "arcade");
    try {
      app!.unmount();
      app = mountHarness();
      expect(document.body.dataset.skin).toBe("arcade");
      expect(themeColor()).toBe("#0b0f1c");
    } finally {
      localStorage.removeItem("wordament:skin");
    }
  });

  it("keeps the registry's page backgrounds equal to the manifest colours", () => {
    const manifest = JSON.parse(
      readFileSync(join(CLIENT_ROOT, "public", "manifest.webmanifest"), "utf8")
    ) as { theme_color: string; background_color: string };
    expect(manifest.theme_color).toBe(SKINS[0]!.pageBackground);
    expect(manifest.background_color).toBe(SKINS[0]!.pageBackground);
  });
});
