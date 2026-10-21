# Glossary

Shared vocabulary for the German multiplayer Wordament clone. Terms are defined once
here; code, docs, tickets and tests use them as written.

## Board enumeration

Walking a fixed 4×4 board to find **every** valid word placeable on it, honouring
8-way adjacency, using each tile at most once per word, and a minimum length of 3.
Enumeration returns distinct words (a word reachable by several tile paths counts
once). It is used by board generation (to check a board is good enough) and by the
end-of-round reveal. Also surfaced as `Dictionary.findWords(board)`. See
[ADR-0001](docs/adr/0001-word-list-source-and-packaging.md).

## Board rotation

A player-local, client-only view transform that turns the shared board in 90°
steps (0° → 90° → 180° → 270° → 0°). The sixteen tiles are permuted over the
grid; each tile stays upright with its point value in the corner, while the
server board data, tile paths, valid words, scoring and wire protocol are
unchanged. The choice lives in client memory for one board: it survives
re-renders within that round, shows on that round's **Intermission**, and
resets when the next board starts or the app is reloaded. It is never a
room-wide or host setting. See
[ADR-0002](docs/adr/0002-game-screen-layout-and-skins.md).

## Board variety

The acceptance rules that keep a generated board from looking like a rendering
accident: at most three copies of any single-letter tile, exactly one **special
tile**, and no two identical tiles 8-way adjacent. Letters contributed by a
special do not count toward the single-letter cap, so an `e` cell next to an `er`
cell is allowed. See [ADR-0003](docs/adr/0003-board-generation-and-tile-inventory.md).

## Close outcome

The single client-seam event that ends a room connection: `kicked`, `room-ended`
(with its reason) or `connection-lost`. The connection derives it from the
server's end frame or from an orderly transport close that carried no frame and
emits it once, after the frame reached the store. It replaces the earlier
`closed` status followed by a separate frame, so the screen shown cannot depend
on callback order. See
[ADR-0014](docs/adr/0014-connection-seam-and-field-validation.md).

## Cumulative score

A player's running total across a session — the sum of their per-round scores. The
session's winner is the highest cumulative score when the host closes or the room
expires. Contrast a per-round score, which is shown in the round breakdown.

## Deadline

The server-owned absolute end time (epoch ms) of the current round — the 2-minute
round clock, and the only clock in a room. Clients render their countdown by
interpolating against it, but the deadline is authoritative and the client's local
zero is cosmetic. A pause has no deadline. See Tick.

## Deep link

The absolute join URL for a room: `location.origin` + `/r/` + the uppercased
**Room code**. The lobby shows it as text and encodes the same string as a QR
code, so a phone camera can join. Both render from one value, so they never
disagree. See [ADR-0008](docs/adr/0008-lobby-qr-invite.md).

## Display

The uppercase presentation of tiles and words, independent of the stored data.
Exactly one letter is special-cased: `ß` renders as capital `ẞ` (U+1E9E), so
it stays one glyph and never expands to `SS`, and a `ß` word stays visually
distinct from an `ss` word. Submission, matching and scoring keep the canonical
lowercase `ß`. See [ADR-0002](docs/adr/0002-game-screen-layout-and-skins.md).

## Exclusion list

The reviewed set of normalized entries subtracted from the vendored word list
at ingestion: non-German-language forms, proper nouns/toponyms and
abbreviations, but not German loanwords Duden accepts. It is committed beside
the server package, applied by the single raw-lines-to-words seam shared by the
DAWG build and the dev fallback, and validated so every entry must exist in the
raw list. See [ADR-0001](docs/adr/0001-word-list-source-and-packaging.md).

## Gesture

One continuous board drag from press to release, independent of the event
streams the browser reports it through: a pointer stream and a touch stream may
both describe the same finger. A gesture builds exactly one trace, and a real
release (`pointerup` / `touchend`) or `touchcancel` ends it; a touch
`pointercancel` does not end it while its touch stream continues. Exactly one
`submit-word` crosses the wire per gesture.

## Greeting

The first client→server message on a connection: `create-room` or `join`
(`GreetingMsg`), sent once with the connection's first `reqId`. The room code
travels inside a join greeting's first frame, never in the WebSocket URL. See
[ADR-0014](docs/adr/0014-connection-seam-and-field-validation.md).

## Host

The player who controls the room. The **creator** of a room is its first host; if the
host disconnects, host transfers to the longest-connected remaining connected player.
Host powers: start every round, kick a connected player, close the room, and
transfer host.

## Intermission

The host-paced pause between rounds. It has no clock and never advances on its
own: it shows the finished board, the reveal and the session standings for as
long as the host holds it open, and ends only when the host starts the next
round. A lone host may start that round. See
[ADR-0016](docs/adr/0016-host-paced-intermission.md).

## Live region

A part of a rendered screen that a **Play-time delta** refreshes **in place**
instead of rebuilding the screen: the countdown, the scoreboard/standings and
the private found-word chips. Each screen declares its own live regions beside
its template, and the in-place updater walks those declarations. See
[ADR-0009](docs/adr/0009-play-time-deltas-in-place.md) and
[ADR-0013](docs/adr/0013-live-regions-beside-templates.md).

## Notification layer

The app-owned floating surface at the bottom centre of the viewport that shows
connection status and the current error outside the screen markup, so a rebuild
cannot remove it. It has two slots — a polite connection-status slot
(`role="status"`) above an assertive error slot (`role="alert"`) — replaces an
error in place, never blocks pointer input, keeps no timer or history, and
clears an error on a fresh action or a phase change. Outcome screens remain
full screens. See
[ADR-0018](docs/adr/0018-floating-notification-layer.md).

## Lobby

The pre-round phase of a room, before the host starts round one. Players join, take a
nickname and a seat, and wait; the host starts the first round, and a lone host is
enough.

## Play-time delta

A server delta that changes only live, already-rendered game state — the
countdown, the scoreboard and the private found-word chips — so the client
must update those regions **in place** without rebuilding the screen, keeping
the running ring timer's identity. The once-per-second **Tick**, a round score
change (`score-update`) and an accepted word (`word-accepted`) are play-time
deltas. Every other message is a structural change (Round start, Intermission,
roster join/leave/disconnect, host change, screen change, Room end) that still
rebuilds the whole screen. See
[ADR-0009](docs/adr/0009-play-time-deltas-in-place.md).

## Room

A single private game session, identified by a room code, holding at most 8 players
and an unbounded sequence of rounds. Rooms are in-memory only and lives end on host
close, on a hostless pause with someone still present (`no-players`), or on expiry
(60 s empty, 30 min idle).

## Room code

The short (~5-character) ambiguity-free code that identifies a room and forms the
shareable deep link `wortschatz.phanthom.cc/r/<code>`.

## Round

One timed 2-minute period of simultaneous play on a shared board, followed by the
intermission. Rounds roll endlessly until the room ends.

## Round score

A player's points in one round alone (per spec #15 story 10, ticket #20): shown live
on the game screen's scoreboard, ordered by round score with ties sharing one place
and the display order inside a tie settled by join order. Contrast the cumulative
score.

## Seat

A player's slot in a room, holding their nickname and cumulative score. A seat is
reserved while a disconnected holder may still return, and auto-releases once its
holder has missed a full round plus intermission; a voluntary leave releases it at once.

## Server authority

The property that the single server process owns the game: it generates the board,
owns the clock and computes all scores, while clients only render and send input. There
is no client-side clock, score, or word-trust.

## Session token

The opaque, server-issued token persisted client-side that reclaims a player's seat
and score without an account. A lost token means a brand-new player.

## Skin

A user-facing visual design of the whole app: one CSS custom-property token block
(palette, surface, border, glow, radius — plus a per-skin `--ping` low-time colour)
consumed by every component, plus one registry entry. Standard (light) is the
default; Arcade (dark neon) is the second. The choice renders as `data-skin` on the
root, can be switched from the home screen, applies app-wide instantly, and
persists in localStorage. No component style branches on a skin beyond tokens, and
adding one cannot break layout. See [ADR-0002](docs/adr/0002-game-screen-layout-and-skins.md).

## Screenshot baseline

A committed full-page PNG of one curated scenario, skin and viewport in
`e2e/__screenshots__/`, compared pixel-for-pixel by the Playwright suite. It is
updated only through `npm run test:visual:update` inside the pinned Playwright
container, and a changed baseline is reviewed in the pull request like code. See
[ADR-0020](docs/adr/0020-browser-visual-regression-seam.md).

## Snapshot

The complete authoritative room-and-player state (`room`, `self`, `players`, the
live `round` when playing, or the finished round when in intermission) that the
server sends on join, on every
reconnect, on `resync`, and — without being asked — to every seat promoted from
spectator to player at round start. The client never reconstructs state from
deltas; everything else is a delta.

## Spectator

A player admitted to a room mid-round who watches the current round and plays from the
next one. A joiner with no valid session token is a spectator.

## Tick

The once-per-second server→client `tick` carrying the remaining round time and
the round deadline, used to re-anchor a client's local interpolation between
bounds. It exists only while `playing`; a pause sends no tick. See Deadline.
(Renamed from the earlier `round-tick` when the real-time architecture landed.)

## Tile coverage

The number of distinct **Valid words** in the round's enumerated list in which a
cell can take part along at least one valid 8-way path; a word reachable by
several paths still counts once for that cell. Every cell, including the special,
must be usable in at least three words. Board generation computes it from the
already-enumerated, formability-filtered list. See
[ADR-0003](docs/adr/0003-board-generation-and-tile-inventory.md).

## Tile value

The points a single tile is worth: the plain sum of the German Scrabble values
of the letters it spells. Digrams, prefixes and suffixes show one total (`sch`
→ 7, `an-` → 2, `-ung` → 4). An **either/or** tile has one value per spelling
in declared letter order; the board shows both joined by `/` when they differ
(`e/ä` → 1/6, `o/u` → 2/1) and a single number when they are equal (`i/e` → 1).
A tile value reads the same table as the **word score** — the sum for a whole
submitted word — so the corner number can never disagree with the scoreboard,
but it is not itself a word score. See
[ADR-0002](docs/adr/0002-game-screen-layout-and-skins.md).

## Valid word

A word the game accepts: a sequence of 3 or more letters formable by an 8-way
connected path over the board with each tile used at most once, that is present in the
word list. Matching is case-insensitive and NFC-normalized; `ä/ö/ü/ß` are matched as
real characters (no `ae/oe/ue/ss` aliasing). Validity is **strict list membership** —
there is no algorithmic compound validation.

## Visual regression seam

The real-browser layer beside the happy-dom mount tests: Playwright renders the
production client build, replays deterministic **Wire protocol** fixtures
through the existing WebSocket boundary, and compares full-page screenshots
against committed **Screenshot baselines**, with a few ARIA snapshots and wire
flows for semantics and behavior. It never runs inside `npm test`, the Docker
build or the issue agent. See
[ADR-0020](docs/adr/0020-browser-visual-regression-seam.md).

## Wire protocol

The WebSocket message contract: one JSON text frame per message, discriminated by a
`type`, with an optional `reqId` echoed by the server for request/response correlation
and a typed `error` reply for every rejected action. See Snapshot.

## Word list

The game's dictionary of accepted words: `enz/german-wordlist` (CC0-1.0), pinned per
[ADR-0001](docs/adr/0001-word-list-source-and-packaging.md), lowercased and NFC-normalized
at load, trimmed to a minimum length of 3, and held server-side in a DAWG that answers
both membership and board enumeration. The browser never holds the word list.
