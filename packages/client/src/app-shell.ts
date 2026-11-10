/**
 * The offline App shell (ADR-0029): the production service worker's cache
 * policy, kept apart from the worker entry so the rules are exercised in the
 * ordinary DOM test environment.
 *
 * The worker stores exactly the build's shell — the Home document, hashed
 * scripts and styles, the manifest and the four icons — and never game data.
 * A navigation is network-first with a short timeout and falls back to the
 * stored Home document; hashed assets are cache-first. A non-GET request, the
 * health endpoint and the Wire protocol socket are never handled or stored.
 */

/** One Workbox `injectManifest` entry injected by the build. */
export interface PrecacheEntry {
  readonly url: string;
  readonly revision?: string | null;
}

/** The part of `fetch` the worker needs; injectable for the tests. */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Everything one cache decision reads. */
export interface AppShellEnvironment {
  readonly caches: CacheStorage;
  readonly fetch: FetchLike;
  readonly origin: string;
  readonly version: string;
  readonly manifest: readonly PrecacheEntry[];
  readonly navigationTimeoutMs?: number;
}

/** The prefix shared by every generation of the shell cache. */
export const APP_SHELL_CACHE_PREFIX = "wortschatz-shell-";

/** The Home document the navigation fallback serves when the network fails. */
export const HOME_DOCUMENT_PATH = "/index.html";

/** How long a navigation waits for the network before using the stored shell. */
export const NAVIGATION_TIMEOUT_MS = 3000;

/** The one client→worker message that lets a waiting update take over. The
 *  update notice sends it only after the player pressed `Neu laden`; the
 *  worker itself never calls `skipWaiting` on its own (ADR-0029). */
export const SKIP_WAITING_MESSAGE = "SKIP_WAITING";

/** The one versioned cache name; a deploy cannot reuse an older generation. */
export function appShellCacheName(version: string): string {
  return `${APP_SHELL_CACHE_PREFIX}${version}`;
}

/** The absolute cache keys of the injected manifest, without duplicates. */
export function precacheUrls(env: Pick<AppShellEnvironment, "origin" | "manifest">): string[] {
  return [...new Set(env.manifest.map((entry) => new URL(entry.url, env.origin).href))];
}

/**
 * Whether the worker answers this request: same-origin GET navigations and
 * same-origin `/assets/` reads. Everything else — non-GET, `/healthz`, the
 * WebSocket upgrade — stays outside the worker and is never stored.
 */
export function isAppShellRequest(request: Request, origin: string): boolean {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== origin) return false;
  if (request.mode === "navigate") return true;
  return url.pathname.startsWith("/assets/");
}

/** Store exactly the injected shell entries in this version's cache. */
export async function precacheAppShell(env: AppShellEnvironment): Promise<void> {
  const cache = await env.caches.open(appShellCacheName(env.version));
  const stale = await cache.keys();
  await Promise.all(stale.map((request) => cache.delete(request)));
  await Promise.all(
    precacheUrls(env).map(async (url) => {
      const response = await env.fetch(url, { cache: "reload" });
      if (!response.ok) throw new Error(`The app shell could not cache ${url}.`);
      await cache.put(url, response);
    })
  );
}

/** Activation deletes every cache except this version's shell cache. */
export async function deleteOtherCaches(env: AppShellEnvironment): Promise<void> {
  const current = appShellCacheName(env.version);
  const keys = await env.caches.keys();
  await Promise.all(keys.filter((key) => key !== current).map((key) => env.caches.delete(key)));
}

async function storedHome(env: AppShellEnvironment): Promise<Response | undefined> {
  const cache = await env.caches.open(appShellCacheName(env.version));
  return (
    (await cache.match(new URL(HOME_DOCUMENT_PATH, env.origin).href)) ??
    (await cache.match(new URL("/", env.origin).href))
  );
}

async function navigationResponse(request: Request, env: AppShellEnvironment): Promise<Response> {
  try {
    return await withTimeout(env.fetch(request), env.navigationTimeoutMs ?? NAVIGATION_TIMEOUT_MS);
  } catch {
    return (await storedHome(env)) ?? Response.error();
  }
}

async function cacheFirst(request: Request, env: AppShellEnvironment): Promise<Response> {
  const cache = await env.caches.open(appShellCacheName(env.version));
  const stored = await cache.match(request);
  if (stored) return stored;
  const response = await env.fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/**
 * Answers one app-shell request. `undefined` means the request never enters
 * the worker's cache path, so the browser fetches it normally.
 */
export async function respondTo(request: Request, env: AppShellEnvironment): Promise<Response | undefined> {
  if (!isAppShellRequest(request, env.origin)) return undefined;
  if (request.mode === "navigate") return navigationResponse(request, env);
  return cacheFirst(request, env);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The network took too long.")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** The minimal slice of a service worker's global scope this module binds to. */
export interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}

export interface MessageEventLike extends ExtendableEventLike {
  readonly data: unknown;
}

export interface ServiceWorkerScopeLike {
  readonly location: { readonly origin: string };
  addEventListener(type: "install", listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: "activate", listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEventLike) => void): void;
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  skipWaiting?(): Promise<void>;
}

/** Whether a message is the update notice's one command to take over. */
function isSkipWaitingMessage(data: unknown): boolean {
  return (
    typeof data === "object" && data !== null && (data as { type?: unknown }).type === SKIP_WAITING_MESSAGE
  );
}

/** Bind the app-shell policy to one service worker scope. */
export function serveAppShell(
  scope: ServiceWorkerScopeLike,
  options: {
    version: string;
    manifest: readonly PrecacheEntry[];
    navigationTimeoutMs?: number;
    caches?: CacheStorage;
    fetch?: FetchLike;
  }
): void {
  const env: AppShellEnvironment = {
    caches: options.caches ?? caches,
    fetch: options.fetch ?? fetch,
    origin: scope.location.origin,
    version: options.version,
    manifest: options.manifest,
    ...(options.navigationTimeoutMs !== undefined
      ? { navigationTimeoutMs: options.navigationTimeoutMs }
      : {}),
  };
  scope.addEventListener("install", (event) => {
    event.waitUntil(precacheAppShell(env));
  });
  scope.addEventListener("activate", (event) => {
    event.waitUntil(deleteOtherCaches(env));
  });
  scope.addEventListener("fetch", (event) => {
    if (!isAppShellRequest(event.request, env.origin)) return;
    event.respondWith(respondTo(event.request, env).then((response) => response ?? Response.error()));
  });
  scope.addEventListener("message", (event) => {
    if (!isSkipWaitingMessage(event.data)) return;
    event.waitUntil(scope.skipWaiting?.() ?? Promise.resolve());
  });
}
