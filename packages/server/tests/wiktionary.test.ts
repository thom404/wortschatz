import { describe, expect, test } from "vitest";
import {
  createWiktionaryLookup,
  type WikiRequest,
  type WikiResponse,
  type WiktionaryLookupOptions,
} from "../src/wiktionary.js";

function response(
  body: unknown,
  init: { status?: number; ok?: boolean; retryAfter?: string } = {}
): WikiResponse {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: {
      get: (name) => (name.toLowerCase() === "retry-after" ? (init.retryAfter ?? null) : null),
    },
    json: async () => body,
  };
}

function titlesOf(url: string): string[] {
  return (new URL(url).searchParams.get("titles") ?? "").split("|").filter(Boolean);
}

/** A MediaWiki answer that treats every requested title as a real entry. */
function pagesFor(url: string): unknown {
  const titles = titlesOf(url);
  return { query: { pages: titles.map((title) => ({ title })) } };
}

function lookupWith(request: WikiRequest, overrides: Partial<WiktionaryLookupOptions> = {}) {
  return createWiktionaryLookup({ request, batchDelayMs: 0, ...overrides });
}

describe("Wiktionary lookup", () => {
  test("uppercases the first character and URL-encodes the exact form", async () => {
    const urls: string[] = [];
    const lookup = lookupWith(async (url) => {
      urls.push(url);
      return response({
        query: { pages: [{ title: "Aufdecktest" }, { title: "Über" }] },
      });
    });

    const links = await lookup(["aufdecktest", "über"]);

    expect(urls).toHaveLength(1);
    expect(titlesOf(urls[0]!)).toEqual(["Aufdecktest", "Über"]);
    expect(links.get("aufdecktest")).toBe("https://de.wiktionary.org/wiki/Aufdecktest");
    expect(links.get("über")).toBe("https://de.wiktionary.org/wiki/%C3%9Cber");
  });

  test("requests at most 50 titles per call and nothing for an empty input", async () => {
    const sizes: number[] = [];
    const lookup = lookupWith(async (url) => {
      sizes.push(titlesOf(url).length);
      return response(pagesFor(url));
    });

    const empty = await lookup([]);
    expect(empty.size).toBe(0);
    expect(sizes).toEqual([]);

    const words = Array.from({ length: 120 }, (_, i) => `wort${i}`);
    const links = await lookup(words);
    expect(sizes).toEqual([50, 50, 20]);
    expect(links.size).toBe(120);
  });

  test("deduplicates words within one lookup and across identical lookups via the cache", async () => {
    let calls = 0;
    const requested: string[][] = [];
    const lookup = lookupWith(async (url) => {
      calls += 1;
      requested.push(titlesOf(url));
      return response(pagesFor(url));
    });

    const first = await lookup(["test", "test", "wort", "Test"]);
    expect(calls).toBe(1);
    expect(requested[0]).toEqual(["Test", "Wort"]);
    expect(first.size).toBe(3);

    const second = await lookup(["test", "wort"]);
    expect(calls).toBe(1);
    expect(second.get("test")).toBe(first.get("test"));
  });

  test("caches a missing word for its negative window, then retries it", async () => {
    let now = 1_000;
    let calls = 0;
    const lookup = lookupWith(
      async (url) => {
        calls += 1;
        return response(
          calls === 1 ? { query: { pages: [{ title: "Fehlt", missing: true }] } } : pagesFor(url)
        );
      },
      { now: () => now }
    );

    expect(await lookup(["fehlt"])).toEqual(new Map());
    expect(calls).toBe(1);

    now += 59_000;
    expect(await lookup(["fehlt"])).toEqual(new Map());
    expect(calls).toBe(1);

    now += 2_000;
    const retried = await lookup(["fehlt"]);
    expect(calls).toBe(2);
    expect(retried.get("fehlt")).toBe("https://de.wiktionary.org/wiki/Fehlt");
  });

  test("a timeout resolves to an empty map", async () => {
    const lookup = createWiktionaryLookup({
      request: () => new Promise<WikiResponse>(() => {}),
      budgetMs: 20,
      batchDelayMs: 0,
    });
    await expect(lookup(["test"])).resolves.toEqual(new Map());
  });

  test("a 429 resolves to an empty map and honors Retry-After before the next lookup", async () => {
    let calls = 0;
    const lookup = lookupWith(async () => {
      calls += 1;
      return response({}, { status: 429, ok: false, retryAfter: "30" });
    });

    expect(await lookup(["test"])).toEqual(new Map());
    expect(calls).toBe(1);

    expect(await lookup(["wort"])).toEqual(new Map());
    expect(calls).toBe(1);
  });

  test("a malformed body resolves to an empty map", async () => {
    const lookup = lookupWith(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new Error("not json");
      },
    }));
    await expect(lookup(["test"])).resolves.toEqual(new Map());

    const wrongShape = lookupWith(async () => response({ nothing: true }));
    await expect(wrongShape(["wort"])).resolves.toEqual(new Map());
  });

  test("follows redirects and excludes missing and disambiguation pages", async () => {
    const lookup = lookupWith(async () =>
      response({
        query: {
          redirects: [{ from: "Umleiten", to: "Ziel" }],
          pages: [
            { title: "Ziel" },
            { title: "Begriff", pageprops: { disambiguation: "" } },
            { title: "Fehlt", missing: true },
            { title: "Da" },
          ],
        },
      })
    );

    const links = await lookup(["umleiten", "begriff", "fehlt", "da"]);
    expect([...links.keys()]).toEqual(["umleiten", "da"]);
    expect(links.get("umleiten")).toBe("https://de.wiktionary.org/wiki/Ziel");
    expect(links.get("da")).toBe("https://de.wiktionary.org/wiki/Da");
  });

  test("names the project in a descriptive User-Agent", async () => {
    let agent = "";
    const lookup = lookupWith(async (_url, init) => {
      agent = init.headers["user-agent"] ?? "";
      return response({ query: { pages: [{ title: "Test" }] } });
    });
    await lookup(["test"]);
    expect(agent).toContain("wortschatz");
    expect(agent).not.toBe("node");
  });
});
