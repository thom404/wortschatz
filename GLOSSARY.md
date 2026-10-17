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

## Cumulative score

A player's running total across a session — the sum of their per-round scores. The
session's winner is the highest cumulative score when the host closes or the room
expires. Contrast a per-round score, which is shown in the round breakdown.

## Deadline

The server-owned absolute end time (epoch ms) of the current room phase — the
2-minute round or the intermission. Clients render their countdown by interpolating
against it, but the deadline is authoritative and the client's local zero is cosmetic.
See Tick.

## Deep link

The absolute join URL for a room: `location.origin` + `/r/` + the uppercased
**Room code**. The lobby shows it as text and encodes the same string as a QR
code, so a phone camera can join. Both render from one value, so they never
disagree. See [ADR-0008](docs/adr/0008-lobby-qr-invite.md).

## Host

The player who controls the room. The **creator** of a room is its first host; if the
host disconnects, host transfers to the longest-connected remaining connected player.
Host powers: start the first round, skip the intermission, kick a connected player,
close the room, and transfer host.

## Intermission

The short (~20 s, host-skippable) pause between rounds that shows the round result
before play auto-advances to the next round.

## Lobby

The pre-round phase of a room, before the host starts round one. Players join, take a
nickname and a seat, and wait; the first round starts when at least 2 players are
present.

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
close or expiry (60 s empty, 30 min idle).

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

## Snapshot

The complete authoritative room-and-player state (`room`, `self`, `players`, and the
live `round` when playing) that the server sends on join, on every reconnect, on
`resync`, and — without being asked — to every seat promoted from spectator to
player at round start. The client never reconstructs state from deltas; everything
else is a delta.

## Spectator

A player admitted to a room mid-round who watches the current round and plays from the
next one. A joiner with no valid session token is a spectator.

## Tick

The once-per-second server→client `tick` carrying the phase, the remaining time
and the deadline, used to re-anchor a client's local interpolation between
bounds. One message type covers both the round countdown and the intermission
countdown. See Deadline. (Renamed from the earlier `round-tick` when the
real-time architecture landed.)

## Valid word

A word the game accepts: a sequence of 3 or more letters formable by an 8-way
connected path over the board with each tile used at most once, that is present in the
word list. Matching is case-insensitive and NFC-normalized; `ä/ö/ü/ß` are matched as
real characters (no `ae/oe/ue/ss` aliasing). Validity is **strict list membership** —
there is no algorithmic compound validation.

## Wire protocol

The WebSocket message contract: one JSON text frame per message, discriminated by a
`type`, with an optional `reqId` echoed by the server for request/response correlation
and a typed `error` reply for every rejected action. See Snapshot.

## Word list

The game's dictionary of accepted words: `enz/german-wordlist` (CC0-1.0), pinned per
[ADR-0001](docs/adr/0001-word-list-source-and-packaging.md), lowercased and NFC-normalized
at load, trimmed to a minimum length of 3, and held server-side in a DAWG that answers
both membership and board enumeration. The browser never holds the word list.
