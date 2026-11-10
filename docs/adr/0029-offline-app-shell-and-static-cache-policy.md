# ADR-0029: The offline app shell and its static cache policy

- Status: Accepted
- Date: 2026-11-10
- Ticket: [#256](https://github.com/thom404/wortschatz/issues/256), part of the
  installable app shell spec [#254](https://github.com/thom404/wortschatz/issues/254)
- Related: [ADR-0018](0018-floating-notification-layer.md) (the one status
  slot), [ADR-0020](0020-browser-visual-regression-seam.md) (the browser seam),
  [ADR-0021](0021-create-and-join-screens.md) (Home and **Deep link**)
- Amends: [ADR-0018](0018-floating-notification-layer.md) — its idle start
  screen now shows the offline line when the browser reports no network.
- Numbering note: `0021` is duplicated on disk. This is the next free number
  after [ADR-0028](0028-room-command-verdicts.md).

## Context

Wortschatz has **Server authority**: the server owns the board, the clock, the
word list and every score. No **Round** can work offline. The **Home** screen is
different — it needs no server data, only the client shell. Before this change a
player who lost the network received the browser's error page, even though the
app could have shown Home and explained the state.

The static server also masked the app's own files: any missing path answered
with the Home document and status 200, so a broken worker, manifest or icon
looked like a working page. It sent no cache headers, so a new deploy could
leave a browser on a stale shell.

## Decision

1. **One production service worker, built with Workbox `injectManifest`.**
   `vite-plugin-pwa` runs the `injectManifest` strategy over the repo's own
   worker entry; Workbox injects the hashed precache list. The cache policy is
   the repo's code, not a library default, and the Vite dev server registers no
   worker.
2. **The precache set is exact.** It holds the Home document, every hashed
   script and style asset from the build, the web app manifest and the four
   icons. It holds nothing else: not the worker itself, not the vector icon
   source and no game data.
3. **Navigations are network-first with a short timeout.** A page navigation
   waits at most three seconds for the network, then falls back to the stored
   Home document. Hashed assets are cache-first. A successful navigation
   response is never stored.
4. **Only the shell is ever stored.** The worker handles same-origin GET
   navigations and same-origin `/assets/` reads. Non-GET requests, `/healthz`
   and the **Wire protocol** socket never enter the cache path, so no health
   response, wire frame or mutation response can be replayed from a cache.
5. **The cache is versioned and cleaned on activation.** The cache name is
   `wortschatz-shell-<app version>`. Activation deletes every other cache, so a
   deploy cannot keep serving an older generation beside the new one.
6. **The static server stops masking app files.** A missing `/sw.js`, manifest
   or icon answers 404. The root and **Deep link** paths keep the Home-document
   fallback. The Home document, worker and manifest answer `no-cache`; hashed
   assets answer `public, max-age=31536000, immutable`; icons answer
   `public, max-age=604800`. The content security policy is unchanged.
7. **One offline line in the existing Notification layer.** When the browser
   reports no network, the polite status slot returns `Du bist offline.` ahead
   of the connecting and retrying texts. The `online` and `offline` events
   refresh that same layer. There is no second offline surface and no separate
   offline document.
8. **The offline promise stays narrow.** After one successful online visit the
   installed app opens and shows Home with `Du bist offline.`. A first visit
   with no network still ends in the browser error page. Gameplay remains
   online, always.
9. **An update never reloads a running Round.** This slice makes a new build
   arrive through `no-cache` entry points and a fresh versioned cache; it never
   calls `skipWaiting` or reloads the page. The update notice that waits for a
   safe phase owns the user-facing reload in its own slice.
10. **A documented server flag is the worker kill switch.** With
    `WORTSCHATZ_SERVICE_WORKER_KILL_SWITCH=1` (or `true`), the worker path
    answers with a replacement worker that takes over, deletes every cache and
    unregisters itself; with the flag unset or false the real build worker is
    served byte for byte. This is the one deliberate exception to §9's no-
    `skipWaiting` rule: an operator explicitly neutralises a bad worker with no
    browser change, and the worker still never reloads the page. Every other
    static response is unchanged.

## Consequences

- The installed app has an honest offline state instead of the browser error
  page, and the status story remains the one **Notification layer**.
- A broken worker, manifest or icon is visible at once as a 404 instead of a
  Home document with status 200.
- A deploy can replace the shell without a stale page hiding it, while every
  game message still requires the server.
- The browser regression seam keeps blocking service workers so screenshot
  baselines stay deterministic; the offline behavior is covered at the client
  and static seams, and the built artifact is checked for its exact precache
  set.
- A bad worker can be neutralised by an operator setting one environment flag,
  without a browser or container change; players fall back to the online site
  after that worker has cleaned itself up.

## Suppressed alternatives

- **Cache game data for offline play:** rejected — it contradicts **Server
  authority** and the spec deliberately keeps gameplay online.
- **A separate offline document:** rejected — it would be unreachable after the
  first visit and would drift from the real Home screen.
- **`generateSW`:** rejected — the update rule is a product rule, so the worker
  logic must be the repo's own.
- **Mask every missing path with Home:** rejected — it hides exactly the broken
  deploy the worker, manifest and icons would reveal.
- **Skip waiting and reload immediately:** rejected — a reload would destroy an
  active **Round**.
- **Long-lived cache headers on the Home document and worker:** rejected — they
  would let one deploy hide the next.

## Amendment (#258, 2026-11-10): the update notice owns the one reload

Decision 9 deferred the user-facing update step to its own slice. This
amendment lands it without changing the shell, cache or offline rules.

1. **The install-state module gains the update half.** It watches the
   production registration for a waiting worker, exposes whether an update is
   available, notifies subscribers when that changes, and offers one
   `applyUpdate()` command. Screens do not touch service-worker APIs.
2. **One app-owned notice beside the Notification layer.** The notice sits
   outside the screen markup, next to the **Notification layer** in the same
   bottom-centre stack, and carries `Neue Version verfügbar.` with exactly one
   action, `Neu laden`. It is not a third notification slot and not a second
   status surface.
3. **It waits for a safe phase.** A waiting worker is announced on **Home**
   and every non-playing screen, but suppressed while the room phase is
   `playing`. A round ending, returning home or a join that lands in the
   **Intermission** reveals it. The app never reloads on its own.
4. **One command, one reload.** `Neu laden` sends the worker the
   `SKIP_WAITING` message once, hides the notice immediately, and reloads only
   after the new worker's `controllerchange`. The command is idempotent, so a
   second press cannot reload again or raise a second prompt. The worker still
   never calls `skipWaiting` without that message, so decision 9's default is
   unchanged.
5. **Storage is untouched.** The reload keeps the stored **Skin** and
   **Session token**, so the player's **Seat** survives the update; no client
   key is cleared.
6. **Tests stay at the existing seams.** Mount tests drive the waiting worker,
   the playing-phase suppression, the single reload command and the German
   copy through the rendered DOM; the worker command is covered beside the
   app-shell tests.
