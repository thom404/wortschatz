import { APP_VERSION } from "./version.js";
import { serveAppShell, type PrecacheEntry, type ServiceWorkerScopeLike } from "./app-shell.js";

/**
 * The production-only service worker (ADR-0029). The build's Workbox
 * `injectManifest` step replaces the placeholder with the hashed precache
 * list; the cache rules live in `app-shell.ts`.
 */
declare const __WORT_SCHATZ_PRECACHE__: PrecacheEntry[];

serveAppShell(self as unknown as ServiceWorkerScopeLike, {
  version: APP_VERSION,
  manifest: __WORT_SCHATZ_PRECACHE__,
});
