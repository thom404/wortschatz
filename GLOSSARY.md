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

## Room

A single private game session, identified by a room code, holding at most 8 players
and an unbounded sequence of rounds. Rooms are in-memory only and lives end on host
close or expiry (60 s empty, 30 min idle).

## Room code

The short (~5-character) ambiguity-free code that identifies a room and forms the
shareable deep link `wordament.phanthom.cc/r/<code>`.

## Round

One timed 2-minute period of simultaneous play on a shared board, followed by the
intermission. Rounds roll endlessly until the room ends.

## Seat

A player's slot in a room, holding their nickname and cumulative score. A seat is
reserved while a disconnected holder may still return, and auto-releases once its
holder has missed a full round plus intermission; a voluntary leave releases it at once.

## Session token

The opaque, server-issued token persisted client-side that reclaims a player's seat
and score without an account. A lost token means a brand-new player.

## Spectator

A player admitted to a room mid-round who watches the current round and plays from the
next one. A joiner with no valid session token is a spectator.

## Valid word

A word the game accepts: a sequence of 3 or more letters formable by an 8-way
connected path over the board with each tile used at most once, that is present in the
word list. Matching is case-insensitive and NFC-normalized; `ä/ö/ü/ß` are matched as
real characters (no `ae/oe/ue/ss` aliasing). Validity is **strict list membership** —
there is no algorithmic compound validation.

## Word list

The game's dictionary of accepted words: `enz/german-wordlist` (CC0-1.0), pinned per
[ADR-0001](docs/adr/0001-word-list-source-and-packaging.md), lowercased and NFC-normalized
at load, trimmed to a minimum length of 3, and held server-side in a DAWG that answers
both membership and board enumeration. The browser never holds the word list.
