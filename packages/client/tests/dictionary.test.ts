import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDawg, rawLinesToWords, serializeDawg } from "@wortschatz/engine";
import { DAWG_PATH, loadSoloDictionary, resetSoloDictionary } from "../src/dictionary.js";

const ARTIFACT = serializeDawg(buildDawg(rawLinesToWords(["haus", "test", "wort"])));

afterEach(() => resetSoloDictionary());

describe("browser dictionary loader", () => {
  it("fetches the stable artifact path once and caches the deserialized dictionary", async () => {
    const fetch = vi.fn(async () => new Response(ARTIFACT, { status: 200 }));

    const first = await loadSoloDictionary(fetch);
    const second = await loadSoloDictionary(fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(DAWG_PATH, { cache: "no-cache" });
    expect(first).toBe(second);
    expect(first.isValid("haus")).toBe(true);
    expect(first.isValid("fehlt")).toBe(false);
  });

  it("shares one in-flight load and surfaces a missing artifact as an error", async () => {
    const fetch = vi.fn(async () => new Response("not found", { status: 404 }));
    await expect(loadSoloDictionary(fetch)).rejects.toThrow(/Wörterbuch/);

    // A corrupt artifact is a normal load failure too.
    const corrupt = vi.fn(async () => new Response("kein artefakt", { status: 200 }));
    await expect(loadSoloDictionary(corrupt)).rejects.toThrow(/corrupt/i);
  });
});
