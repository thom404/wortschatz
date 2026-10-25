# ADR-0025: Room rules own join and submission; `Rooms` is the wire adapter

- Status: Accepted
- Date: 2026-10-25
- Ticket: [#205](https://github.com/thom404/wortschatz/issues/205), implementing
  the specification [#200](https://github.com/thom404/wortschatz/issues/200) for
  the candidate [#162](https://github.com/thom404/wortschatz/issues/162)
  (deepening)

## Context

`RoomLogic` already owned the phase machine and the roster, driven by an injected
clock and a captured broadcast ([ADR-0012](0012-room-logic-injected-clock-and-broadcast.md)).
Join and submission were the remaining room decisions read and applied by the
socket-facing `Rooms` class. The adapter claimed to be the wire half, yet it
decided token reclaim, nickname collisions, lobby capacity, spectator seating,
word validity and a word's points. A change to one of those rules touched the
adapter, and only a real WebSocket could prove the result.

The same rules also had copies that could drift. Nickname validation was written
for join but read separately by create, error envelopes were built inline rather
than through the one builder ([ADR-0014](0014-connection-seam-and-field-validation.md)),
and two `normalizeWord` functions disagreed about surrounding whitespace. A
player saw the effect at the boundaries: a nickname spelling accepted on one
path and refused on another, or a word whose acceptance depended on which
normalizer ran.

## Decision

1. **One rules module owns both verdicts.** `RoomLogic` gains `join(room,
request)`, `submitWord(room, seat, rawWord)` and `announceScores(room)`. The
   rules receive raw input and normalize inside; they never see a `reqId`, a
   socket or a snapshot. This continues
   [ADR-0015](0015-architecture-review-one-home-per-rule.md)'s one home per rule
   at the join and submission seam.
2. **A result is a verdict, not a frame.** A refusal carries an `ErrorCode` from
   the shared vocabulary plus an optional verbatim detail; an acceptance carries
   what the adapter needs to reply. `join` returns `reconnected`, `joined` or
   `rejected`; `submitWord` returns `accepted` or `rejected`. A join verdict's
   `announceScores` flag is the rule's answer to whether the room-wide
   scoreboard must follow: always after a reconnect, after a new join only in
   the Intermission.
3. **The rule tables have one precedence.** A join reclaims a seat by exact
   token first, then validates the normalized nickname, then refuses a
   case-folded duplicate across every seat (reserved absent seats included),
   then refuses a full lobby when the room is not playing, then creates the
   seat — a Spectator mid-Round — and announces it. A submission refuses
   round-over, then not-playing, then a word shorter than three, then a
   duplicate for this seat and Round, then a word not placeable on the Board,
   then a word the Dictionary does not know. The first refusal wins, so the
   error a player sees is the first thing they can fix.
4. **Announcements split by correlation.** `RoomLogic` owns every room-wide
   frame, as it already did for host changes, departures, round start and round
   end: a new join's `player-joined` is announced inside the rule, and
   `announceScores` broadcasts the moved `score-update` projection. `Rooms` owns
   every `reqId`-bearing reply, the full snapshot and the token, because those
   are correlation and wire concerns.
5. **The adapter keeps the wire.** `Rooms` resolves and normalizes the room
   code, refuses an unknown or closed room, mints the token, binds and unbinds
   sockets, sends snapshots, logs, and translates a verdict through
   `errorReply`. It does not build join or submission error frames inline, so
   ADR-0014 has no exception. The server-wide room-count cap stays with the
   adapter because it reads the server's room map, not a room; Create keeps its
   shape but reads the shared nickname helpers.
6. **Presence has one owner.** The socket binding no longer writes a seat's
   presence; only the rules mark a seat present, so a binding cannot clear an
   absence behind the rule's back.
7. **One projection and one normalization home.** The seat-to-player projection
   used by `player-joined` and by snapshots lives beside the room and seat
   types, so the delta and the snapshot cannot disagree. A text module owns the
   nickname normalizer, the case fold, the nickname validity check, the word
   normalizer and the room-code normalizer; the Dictionary's loader and lookup
   import the same word normalizer. This is the one intentional correction: the
   canonical word normalizer trims surrounding whitespace, matching what
   submission already did.

Order is preserved throughout: for a submission the accepted reply precedes the
scoreboard; for a new join `player-joined`, then the snapshot, then the
Intermission scoreboard; for a reconnect the silent seat work, then the
snapshot, then the scoreboard. Screens, copy, timing, scores, the wire protocol,
the room lifecycle and deployment are untouched.

## Consequences

- Join and submission are unit-tested as rule tables with the manual clock and a
  captured broadcast: reclaim, stale-token degradation, refusal precedence,
  capacity, spectator seating, scoring and the scoreboard projection need no
  socket.
- The wire suites — greeting, reconnect, lifecycle, promotion, submit-word and
  scoring — remain the integration seam and pass unmodified, which is the proof
  that a player sees the same outcomes in the same order.
- `Rooms` no longer contains a branch that decides a nickname, a lobby capacity,
  a word's validity or its points on the join and submission paths; a change to
  one of those rules touches `RoomLogic`.
- Nickname validity and word normalization have one implementation, so Create
  and Join cannot disagree and the load-and-lookup path trims like submission.
- The module stays server-internal; the highest server seam for behaviour is
  still the real WebSocket wire.

## Suppressed alternatives

- **Let the rules emit frames themselves.** Rejected: a rule would need the
  `reqId` and the socket, so the wire would move back into the rule and the pure
  test harness would need a fake client rather than a captured broadcast.
- **Let a refusal throw and have the adapter map the exception.** Rejected:
  refusals are ordinary outcomes and their precedence is part of the rule;
  exceptions would hide that table in a `try`/`catch` and invite an adapter-side
  fallback code. A verdict keeps the code and detail at their source.
- **Put join and submission in a second rules module.** Rejected: it would split
  one room lifecycle across two files that share seats, phase, clock and
  broadcast, and a maintainer would have to read two tables to know who may
  enter or score.
- **Leave the rules in the adapter.** Rejected: it is the diagnosis this change
  answers — the adapter would keep deciding room state, and only a real
  WebSocket could prove a rule.
- **Move create, kick, transfer-host, start-round, close and leave at the same
  time.** Rejected: out of scope here; this change is a move at two entry
  points, easy to review and revert, and the same verdict seam can take the
  others later.
