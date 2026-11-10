# ADR-0030: One module per screen behind one shell

- Status: Accepted
- Date: 2026-11-10
- Ticket: [#263](https://github.com/thom404/wortschatz/issues/263) (candidate 1
  of the 10 November 2026 architecture review)
- Related: [ADR-0009](0009-play-time-deltas-in-place.md) (play-time deltas
  update in place), [ADR-0013](0013-live-regions-beside-templates.md) (screens
  declare live regions), [ADR-0021](0021-create-and-join-screens.md) (entry
  routing and history), [ADR-0023](0023-app-owned-menu-surface.md) (the
  app-owned Menü), [ADR-0024](0024-view-state-beside-the-store.md) (view
  state), [ADR-0026](0026-connection-core-beside-adapters.md) (the
  connection seam)

## Context

The client's screen layer was one 1,603-line module with 80 top-level
functions and a single export, `mount`. Seven screens — Home, Create, Join,
Lobby (Wait room), Game, Intermission and Outcome — were free functions over
one mutable app record. Every screen repeated the same preamble, three copied
the same start/leave wiring, and every screen received the whole record:
connection, timers, notices, history, Menu and room code, whether it needed
them or not.

Changing one screen therefore meant editing a 1,600-line file and proving the
change through the whole 2,200-line mount suite. "Where is the Lobby
rendered?", "which helpers may this screen use?" and "what does this screen
need?" had no answer short of grepping the monolith. The ordering that keeps
the ring timer from flashing, measures the board gap, rehydrates a live drag
and keeps the Menu identity stable lived in call order and comments rather
than in a boundary. Dead `shell` and `screen` fields suggested a screen
boundary that did not exist.

## Decision

1. **One thin shell.** `packages/client/src/app.ts` keeps mount/unmount, the
   mount-root markup (`#screen`, the Menu, the notification layer), the
   connection and its message handling, greeting rejection, the render
   shortcuts, entry routing and browser history, the notification state, the
   250 ms timer interval and the drag lifecycle. It exports `mount` only.
2. **Seven screen modules.** `packages/client/src/screens/` holds Home, Create,
   Join, Lobby, Game, Intermission and Outcome. Home, Create, Join, Lobby, Game
   and Intermission export `paint(ctx)`; Outcome exports `paint(ctx, outcome)`
   because its content is chosen by the close reason. Each owns its template,
   ids, live regions, event wiring, document title and Menu key, plus the
   helpers only that screen uses.
3. **A declarative screen contract.** A `ScreenPaint` carries `title`,
   `menuKey`, `html`, `liveRegions`, `wire(root, ctx)` and optional `tick`,
   `lateLinks` and `dispose`. A `LiveRegion` is a selector plus an in-place
   updater taking the same context. The declaration model of ADR-0013 is
   unchanged; only the updater's context changes from the app record to the
   screen context.
4. **One install path.** Installing a paint disposes the previous paint, sets
   the Menu key and `document.title`, replaces only `#screen`'s contents,
   retains the paint, calls `wire`, then refreshes the notification layer. The
   shell never writes a screen's markup and a screen never writes outside
   `#screen`.
5. **A narrow screen context.** A screen receives the `#screen` container, the
   store, view state, the room code, the drag handle, the Home-only install
   state, the two notice commands and the navigation/room actions it may call.
   The connection, timer handle, store subscription, history state, Menu
   surface and `inRoom` are not reachable from a screen.
6. **One home per shared presentation.** `presentation/board.ts` owns tile and
   board HTML, point display, gap measurement (returning the margin), the
   rotation control, rotation wiring and the in-place board repaint.
   `presentation/scoreboard.ts` owns the player chips, the phase's one mode
   decision, the in-place scoreboard update and its live region.
   `presentation/controls.ts` owns the icon button, the leave button and the
   form-field reader. Game and Intermission, Lobby/Game/Intermission and
   Create/Join import these respectively.
7. **Game drag is its own app-lifetime module.** `game-drag.ts` is created
   once per mount, not per Game render. It owns the pointer/touch listeners,
   the hit margin, trace painting, the two readings of a trace and the submit
   decision, and exposes `setHitMargin`, `paint` and `stop`. The Gesture rules
   stay in the pure Gesture module and the arrangement mapping in the Board
   rotation module.
8. **The shell keeps the render and tick rules.** A play-time delta refreshes
   the installed paint's declared live regions in place; a `reveal-links` delta
   runs the paint's optional `lateLinks`; a structural delta applies the room
   URL rule and dispatches on the phase. The 250 ms interval stays in the shell
   and calls the installed paint's optional `tick` (Game supplies it). The
   dispatch ends in a `never` assertion, so a missing screen is a compile
   error rather than a blank page.
9. **Identity stays observable.** Menu keys are Home/Create/Join constants,
   `lobby:<code>`, `game:<round>`, `intermission:<round>` and a stable Outcome
   kind (`kicked`, `room-ended`, `room-not-found`, `connection-lost`). A
   rebuild with the same key keeps an open panel; a different key closes it.
10. **Dead state disappears.** `app.shell` and `app.screen` are deleted, the
    Lobby copy timer moves into the Lobby paint and is disposed with it, the
    drag hit margin moves into the Game drag module, and the standalone
    live-region field is replaced by the installed paint.

The DOM, ids, German copy, render ordering, URLs, Menu behaviour, timer
identity, board rotation, drag semantics and every screenshot are unchanged.

## Consequences

- A screen change touches one file and its surrounding module tests; the
  mount suite remains the one behavioural seam and proves all seven screens,
  the shared presentation and the drag subsystem through `mount`.
- A screen cannot reach the connection, timers, history internals or Menu by
  accident, and a new screen cannot forget the title, Menu key or live-region
  reset because the install path owns them.
- Game and Intermission cannot render or measure the board differently, and
  Lobby, Game and Intermission share one ranking view and one in-place update.
- Drag listeners bind once per mount, so a Game re-render cannot double-submit
  a Gesture; the Lobby copy timer is disposed on leaving, so an async copy
  result cannot write onto the next screen.
- Adding a screen is mechanical: write its `paint`, add its case to the
  exhaustive dispatch, and the compiler proves the contract.
- No visual baseline changed; the unchanged mount and visual suites are the
  evidence that the move is invisible.
- The app record now describes only state that is read: the connection,
  timers, notices, Menu, install state, room code and the `screenFromHome`
  routing flag.

## Suppressed alternatives

- **Keep one app controller and extract helpers only.** Rejected: the helpers
  would still receive the whole record and the screen preamble would still be
  copied; the boundary would remain a convention.
- **Keep `app.screen` as the current screen.** Rejected: the installed paint
  already names the screen and its live regions, so the field is dead state.
- **Create drag listeners per Game render.** Rejected: a rebuild mid-gesture
  would double-bind the document listeners and could submit twice.
- **Move the tick into the Game module.** Rejected: the interval is one shell
  lifetime; only its use is screen-owned, through the optional `tick`.
- **Use the Outcome title HTML as its Menu key.** Rejected: markup is not
  identity; a stable kind closes the panel when the outcome changes without
  making a title string fragile.
- **Add a per-screen rendering harness.** Rejected: it would create a second
  behavioural seam beside `mount`; the existing mount and visual suites stay
  the proof.
