# ADR-0031: Offline solo mode and its local game authority

- Status: Accepted
- Date: 2026-11-10
- Ticket: [#284](https://github.com/thom404/wortschatz/issues/284)
- Related: [ADR-0001](0001-word-list-source-and-packaging.md) (word list and
  DAWG), [ADR-0003](0003-board-generation-and-tile-inventory.md) (board
  generation), [ADR-0021](0021-create-and-join-screens.md) (Home),
  [ADR-0027](0027-position-free-specials-and-submittable-either-or.md) (the
  either/or submission), [ADR-0028](0028-room-command-verdicts.md) (the room
  rule seam), [ADR-0029](0029-offline-app-shell-and-static-cache-policy.md)
  (the shell and cache policy), [ADR-0030](0030-one-module-per-screen-behind-one-shell.md)
  (the screen boundary)
- Amends: ADR-0029's "only the shell is ever stored" and "cache game data for
  offline play: rejected" decisions, for solo mode only; ADR-0021's Home with
  exactly two actions; ADR-0001's "server-only word list" wording.
- Supersedes no multiplayer decision. **Server authority** remains the rule
  for every room, socket, replay and score.

## Context

After one successful online visit the installed app opens offline, but it
shows **Home** and `Du bist offline.` and cannot play: the server owns the
board, the clock, the word list and every score. A player on a train or a
flaky connection can open the app but not use it.

The game rules were already pure enough to run in the browser, but they lived
inside `packages/server`, whose dictionary loader uses `node:fs` and whose
board generator was declared server-only. ADR-0029 deliberately rejected
caching game data because gameplay always needed the server. Solo mode is a
different product promise, so it needs an explicit, narrow local exception
rather than a hidden second code path.

## Decision

1. **One pure game-rules package.** `@wortschatz/engine` owns word
   normalization, board generation and its seeded RNG, the DAWG (build,
   serialization, deserialization, membership and board enumeration),
   formability, the one submission verdict and the reveal builder. It imports
   nothing from Node. `@wortschatz/shared` stays the wire-and-identity package
   (message types, protocol constants, board geometry, tile inventory and the
   scoring table); the engine may import shared, never the reverse. The server
   keeps rooms, seats, sockets, the authoritative room clock and the room
   lifecycle.
2. **One rule table for server and solo.** The server's `submitWord` and the
   local authority call the engine's submission verdict. It normalizes both
   readings, rejects short words, resolves an either/or alternate, requires
   formability and membership, uses the resolved word as duplicate identity
   and prices the accepted word. The server passes the seat id to its scoring
   seam; solo passes its own player id. The round-end reveal is the same
   engine computation on both sides.
3. **Solo is a local authority, not a second multiplayer mode.** A
   `SoloConnection` satisfies the existing client connection port. It starts,
   accepts requests, stops and emits the existing **Wire protocol** message
   shapes (`snapshot`, `round-start`, `tick`, `score-update`, `word-accepted`,
   `round-end`) to the existing store and screens. No new multiplayer message
   is added. It owns an absolute local **Deadline**, the once-per-second tick,
   the playing → intermission transition, the round number, board, words,
   accepted words, round score and cumulative score. It never opens a
   WebSocket and has no room code, lobby, invite, deep link, session token,
   roster or host.
4. **One mount seam.** `mount` gains an optional solo connection factory.
   Production supplies the local engine after lazily loading the dictionary;
   the client test harness supplies a scripted one. There is no second app
   boot path. Home keeps itself on screen while the dictionary loads, guards
   against a double start and shows the existing German loading and error
   slots.
5. **The dictionary artifact is a build product.** One DAWG is generated from
   the pinned word list and reviewed exclusions at build time. It is never
   committed, feeds the server's artifact-first loader and is served by the
   client at the stable same-origin path `/data/dawg.bin`. The browser fetches
   it lazily on the first solo entry, deserializes it once and keeps it for the
   app's lifetime; it never reads the raw list. A missing or corrupt artifact
   is a normal German load failure, not a blank screen or a fallback into
   multiplayer.
6. **The one deliberate cache exception.** The service worker precaches the
   artifact beside the shell, raises its per-file cap above the current 2 MiB
   default and serves `/data/` cache-first. Navigations stay network-first with
   the stored Home fallback; non-GET requests, `/healthz` and the WebSocket
   path are still never stored. The cache stays versioned by app version and
   activation still deletes every other cache, so a deploy cannot mix an old
   dictionary with a new shell.
7. **A solo session is disposable.** It exists only in memory. Leaving,
   reloading or closing the app ends it. There is no resume, saved board or
   high-score record. The update notice stays suppressed during a solo round
   and appears in the pause and on Home; accepting it reloads the app and ends
   the session.
8. **The offline promise is now complete for one player.** After one
   successful online visit the installed app can play solo with the network
   completely off. A first-ever launch with no network still ends in the
   browser's error page. Multiplayer remains fully server-authoritative and
   online.

## Consequences

- Home has three actions, and its tagline covers both ways to play.
- The installed app can be used for its actual purpose offline without
  inventing bots, local rooms or a stored game result.
- The engine becomes the testable parity point between the server and solo;
  neither can change word acceptance or reveal grouping alone.
- The dictionary artifact is the dominant new payload (~2.6 MB serialized,
  ~963 KB gzip, ~810 KB brotli). Lazy loading and a visible loading state are
  part of the decision.
- The browser now holds dictionary data, but only as the generated artifact,
  not the raw list and not multiplayer state.
- A missing `/data/dawg.bin` is visible as a 404 instead of a Home document;
  the artifact is served as an explicit binary type with `no-cache`.
- A later Web Worker can wrap the same engine without changing the store or
  screens; this slice deliberately does not add one.

## Suppressed alternatives

- **A second client game loop that reimplements the rules:** rejected — it
  would drift from the server and create two sources of truth.
- **Caching the full word list or game state for offline multiplayer:**
  rejected — multiplayer still has exactly one authority, the server.
- **A fake `/r/` room, lobby or session token for solo:** rejected — solo is
  not a room, and a fake deep link would lie about what the app is doing.
- **A pre-generated board pack or finite solo supply:** rejected — solo uses
  the same seeded board generator as multiplayer and stays varied.
- **Bundling the dictionary into the hashed app bundle:** rejected — it would
  make every shell load pay for a dictionary only solo needs.
