import { describe, expect, it, vi } from "vitest";
import {
  APP_SHELL_CACHE_PREFIX,
  NAVIGATION_TIMEOUT_MS,
  SKIP_WAITING_MESSAGE,
  appShellCacheName,
  deleteOtherCaches,
  isAppShellRequest,
  precacheAppShell,
  respondTo,
  serveAppShell,
  type AppShellEnvironment,
  type PrecacheEntry,
  type ServiceWorkerScopeLike,
} from "../src/app-shell.js";

const ORIGIN = "https://wortschatz.test";
const VERSION = "0.1.2";

const MANIFEST: PrecacheEntry[] = [
  { url: "index.html", revision: "home" },
  { url: "assets/index-abc.js", revision: null },
  { url: "assets/index-def.css", revision: null },
  { url: "manifest.webmanifest", revision: "manifest" },
  { url: "icons/icon-192.png", revision: "icon" },
];

/** A minimal in-memory Cache Storage: enough of the API for one worker. */
class MemoryCache {
  private readonly entries = new Map<string, Response>();

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(urlOf(request), response.clone());
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(urlOf(request))?.clone();
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => ({ url }) as Request);
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(urlOf(request));
  }
}

class MemoryCaches {
  private readonly caches = new Map<string, MemoryCache>();

  async open(name: string): Promise<MemoryCache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new MemoryCache();
      this.caches.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  get(name: string): MemoryCache | undefined {
    return this.caches.get(name);
  }
}

function urlOf(request: RequestInfo | URL): string {
  if (typeof request === "string") return request;
  if (request instanceof URL) return request.href;
  return request.url;
}

function environments(
  overrides: {
    fetch?: AppShellEnvironment["fetch"];
    manifest?: readonly PrecacheEntry[];
    navigationTimeoutMs?: number;
  } = {}
): { caches: MemoryCaches; env: AppShellEnvironment } {
  const caches = new MemoryCaches();
  return {
    caches,
    env: {
      caches: caches as unknown as CacheStorage,
      fetch: overrides.fetch ?? (async () => new Response("network")),
      origin: ORIGIN,
      version: VERSION,
      manifest: overrides.manifest ?? MANIFEST,
      ...(overrides.navigationTimeoutMs !== undefined
        ? { navigationTimeoutMs: overrides.navigationTimeoutMs }
        : {}),
    },
  };
}

/** A request object shaped like a browser navigation (Node's Request refuses
 *  to construct `mode: "navigate"`). */
function navigationRequest(path = "/"): Request {
  return { url: `${ORIGIN}${path}`, method: "GET", mode: "navigate" } as Request;
}

function assetRequest(path: string): Request {
  return new Request(`${ORIGIN}${path}`);
}

describe("app shell service worker", () => {
  it("names its one cache after the app version", () => {
    expect(appShellCacheName(VERSION)).toBe(`${APP_SHELL_CACHE_PREFIX}${VERSION}`);
    expect(appShellCacheName("9.9.9")).toContain("9.9.9");
  });

  it("precaches exactly the injected shell entries into the versioned cache", async () => {
    const fetch = vi.fn(
      async (url: RequestInfo | URL, _init?: RequestInit) => new Response(`body:${String(url)}`)
    );
    const { caches, env } = environments({ fetch });

    await precacheAppShell(env);

    const cache = caches.get(appShellCacheName(VERSION))!;
    const stored = await cache.keys();
    expect(stored.map((request) => request.url).sort()).toEqual([
      `${ORIGIN}/assets/index-abc.js`,
      `${ORIGIN}/assets/index-def.css`,
      `${ORIGIN}/icons/icon-192.png`,
      `${ORIGIN}/index.html`,
      `${ORIGIN}/manifest.webmanifest`,
    ]);
    expect(fetch).toHaveBeenCalledTimes(MANIFEST.length);
    for (const [, init] of fetch.mock.calls) expect(init).toEqual({ cache: "reload" });
  });

  it("replaces stale entries in its own cache on install", async () => {
    const { caches, env } = environments();
    const cache = await caches.open(appShellCacheName(VERSION));
    await cache.put(`${ORIGIN}/old-entry.js`, new Response("old"));

    await precacheAppShell(env);

    const stored = await cache.keys();
    expect(stored.map((request) => request.url)).not.toContain(`${ORIGIN}/old-entry.js`);
    expect(stored).toHaveLength(MANIFEST.length);
  });

  it("serves a navigation network-first and leaves the response unstored", async () => {
    const fetch = vi.fn(async () => new Response("network home"));
    const { env } = environments({ fetch });

    const response = await respondTo(navigationRequest("/r/ABC12"), env);

    expect(await response!.text()).toBe("network home");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to the stored Home document when the navigation fails", async () => {
    const { caches, env } = environments({
      fetch: async () => {
        throw new Error("offline");
      },
    });
    const cache = await caches.open(appShellCacheName(VERSION));
    await cache.put(`${ORIGIN}/index.html`, new Response("stored home"));

    const response = await respondTo(navigationRequest("/r/ABC12"), env);

    expect(response!.status).toBe(200);
    expect(await response!.text()).toBe("stored home");
  });

  it("uses the stored Home document after the short navigation timeout", async () => {
    const { caches, env } = environments({
      fetch: () => new Promise<Response>(() => {}),
      navigationTimeoutMs: 5,
    });
    const cache = await caches.open(appShellCacheName(VERSION));
    await cache.put(`${ORIGIN}/index.html`, new Response("stored home"));

    const started = Date.now();
    const response = await respondTo(navigationRequest("/"), env);
    expect(Date.now() - started).toBeLessThan(NAVIGATION_TIMEOUT_MS);
    expect(await response!.text()).toBe("stored home");
  });

  it("serves a hashed asset cache-first without touching the network", async () => {
    const fetch = vi.fn(async () => new Response("network asset"));
    const { caches, env } = environments({ fetch });
    const cache = await caches.open(appShellCacheName(VERSION));
    await cache.put(`${ORIGIN}/assets/index-abc.js`, new Response("cached asset"));

    const response = await respondTo(assetRequest("/assets/index-abc.js"), env);

    expect(await response!.text()).toBe("cached asset");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stores a hashed asset on its first cache-first miss", async () => {
    const fetch = vi.fn(async () => new Response("network asset"));
    const { caches, env } = environments({ fetch });

    const response = await respondTo(assetRequest("/assets/index-abc.js"), env);

    expect(await response!.text()).toBe("network asset");
    const cache = caches.get(appShellCacheName(VERSION))!;
    const stored = await cache.match(`${ORIGIN}/assets/index-abc.js`);
    expect(await stored!.text()).toBe("network asset");
  });

  it("never handles a non-GET request, the health endpoint or a foreign origin", async () => {
    const fetch = vi.fn(async () => new Response("should not happen"));
    const { env } = environments({ fetch });

    expect(isAppShellRequest(new Request(`${ORIGIN}/assets/app.js`), ORIGIN)).toBe(true);
    expect(isAppShellRequest(new Request(`${ORIGIN}/assets/app.js`, { method: "POST" }), ORIGIN)).toBe(false);
    expect(isAppShellRequest(new Request(`${ORIGIN}/healthz`), ORIGIN)).toBe(false);
    expect(isAppShellRequest(new Request(`${ORIGIN}/ws`), ORIGIN)).toBe(false);
    expect(isAppShellRequest(new Request("https://other.test/assets/app.js"), ORIGIN)).toBe(false);

    expect(await respondTo(new Request(`${ORIGIN}/healthz`), env)).toBeUndefined();
    expect(await respondTo(new Request(`${ORIGIN}/assets/app.js`, { method: "POST" }), env)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not store a network response to a navigation", async () => {
    const { caches, env } = environments({ fetch: async () => new Response("network home") });
    const cache = await caches.open(appShellCacheName(VERSION));

    await respondTo(navigationRequest("/"), env);

    expect(await cache.keys()).toEqual([]);
  });

  it("deletes every cache except the current versioned one on activation", async () => {
    const { caches, env } = environments();
    await caches.open(appShellCacheName("0.1.1"));
    await caches.open(appShellCacheName(VERSION));
    await caches.open("some-other-cache");

    await deleteOtherCaches(env);

    expect(await caches.keys()).toEqual([appShellCacheName(VERSION)]);
  });

  it("takes over only when the update notice sends the one command", async () => {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    const skipWaiting = vi.fn(async () => {});
    const scope: ServiceWorkerScopeLike = {
      location: { origin: ORIGIN },
      skipWaiting,
      addEventListener(type: string, listener: (event: never) => void) {
        const set = listeners.get(type) ?? new Set();
        set.add(listener as (event: unknown) => void);
        listeners.set(type, set);
      },
    };
    const { env } = environments();
    serveAppShell(scope, {
      version: env.version,
      manifest: env.manifest,
      caches: env.caches,
      fetch: env.fetch,
    });

    const dispatch = (data: unknown) => {
      const event = { data, waitUntil: vi.fn() };
      for (const listener of listeners.get("message") ?? []) listener(event);
      return event;
    };

    const ignored = dispatch({ type: "something-else" });
    expect(ignored.waitUntil).not.toHaveBeenCalled();
    expect(skipWaiting).not.toHaveBeenCalled();

    const command = dispatch({ type: SKIP_WAITING_MESSAGE });
    expect(command.waitUntil).toHaveBeenCalledTimes(1);
    await command.waitUntil.mock.calls[0]![0];
    expect(skipWaiting).toHaveBeenCalledTimes(1);
  });
});
