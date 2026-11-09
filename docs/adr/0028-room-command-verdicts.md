# ADR-0028: Room commands are verdicts; the adapter keeps the wire

- Status: Accepted
- Date: 2026-11-09
- Ticket: [#249](https://github.com/thom404/wortschatz/issues/249), continuing
  [ADR-0025](0025-room-rules-own-join-and-submission.md) (join and submission)
- Related: [ADR-0014](0014-connection-seam-and-field-validation.md) (one error
  builder), [ADR-0015](0015-architecture-review-one-home-per-rule.md) (one home
  per rule)

## Context

ADR-0025 moved join and submission behind the verdict seam but deferred the
other room commands. Create, start-round, kick, transfer-host, close-room and
leave were still decided by the socket-facing `Rooms` adapter, so a change to
who may kick, start, transfer or close touched the adapter and only a real
WebSocket could prove the result. Create also validated its nickname separately
from join, exactly the drift ADR-0025 set out to remove. Refusals such as
kicking the host, kicking a missing or auto-released seat, transferring to an
absent or spectating player, transferring to the current host and creating with
an invalid nickname had no test at all. Error frames were rebuilt inline in
several adapter branches instead of going through the one `errorReply` builder,
and activity was recorded sometimes by the adapter and sometimes by the rules.

## Decision

1. **The verdict seam takes every room command.** `RoomLogic` gains
   `createSeat`, `startRound`, `kick`, `transferHost`, `close` and `leave`,
   alongside `join` and `submitWord`. Each receives raw input and has its own
   precedence table; there is no dispatcher and no wire message type in the
   rules.
2. **One refusal shape, per-command acceptance shapes.** Every refusal is
   `{ kind: "rejected"; code: ErrorCode; detail?: string }`. An acceptance is
   `{ kind: "ok" }`, `{ kind: "created"; seat }` or `{ kind: "released"; seat }`.
   Create returns the creator's Seat; kick and leave return the released Seat so
   the adapter knows whose sockets to close; start, transfer and close return
   `ok`. No verdict sees a `reqId`, a socket or a token.
3. **Create is split at the server boundary.** The adapter keeps server-wide
   capacity, room-code minting, Room creation, map insertion, token minting,
   idle-check scheduling and socket binding. The rule owns nickname
   normalization, nickname validity, Seat creation, silent host assignment and
   activity. A refusal leaves the adapter to discard the unbound Room. This is
   the one nickname rule for both entry points.
4. **Start is split into command and mechanism.** The phase transition becomes
   `beginRound(room)`; the command `startRound(room, seat)` checks host, then
   phase, touches the room and calls `beginRound`. Rule tests that drive phases
   directly call `beginRound`; the wire suites are untouched.
5. **Precedence is preserved exactly.** Kick checks host, then "cannot kick the
   host", then target existence and auto-release. Transfer checks host, then
   "target exists, is present, is a player", then "already host". Close checks
   host first. The first refusal wins, so the wire copy is unchanged.
6. **The adapter keeps the wire.** `Rooms` resolves and normalizes the room
   code, refuses an unknown or closed room, mints tokens, binds and unbinds
   sockets, sends snapshots, logs wire-arrival events and translates a refusal
   through `errorReply`. Every inline error frame and `requireHost` is deleted,
   so ADR-0014 has no exception. `endRoom` stays in the adapter: it sets the
   closing flag, sends `room-ended` with its reason, closes sockets with the
   existing code, unbinds connections and removes the Room from the map.
7. **Activity belongs to the accepting rule.** Create, start, transfer, join and
   submission touch the Room inside the rule. Kick and leave still do not count
   as activity, matching the previous behaviour; unifying that semantics is a
   separate decision.
8. **Logging follows the current chronology.** `kick`, `leave` and
   `room-closed` move into the rules and are emitted before the roster change,
   preserving `kick` → `player-left`. Wire-arrival events (`room-created`,
   `join`, `reconnect`, `join-rejected`) stay in the adapter, so each layer
   reports what it knows.

## Consequences

- Every room refusal is a rule-table case with a manual clock and a captured
  broadcast; no socket is needed to prove who may start, kick, transfer, close
  or leave.
- Create and Join share one nickname normalizer and validity rule, so the two
  entry points cannot disagree again.
- `Rooms` no longer contains a branch that decides a room command; a change to
  one of those rules touches `RoomLogic`.
- The wire suites — greeting, reconnect, lifecycle, promotion, clock,
  submit-word, scoring, logs and hardening — pass unmodified, which is the
  proof that frames, ordering, German copy and close codes are unchanged.
- The module stays server-internal. No client, wire-protocol, Snapshot schema,
  German copy, screenshot, ARIA baseline or glossary change is involved.

## Suppressed alternatives

- **Let one dispatcher own every command.** Rejected: each command has its own
  inputs and its own precedence table, and a dispatcher would drag the wire
  message type into the rules.
- **Have a rule send frames or close sockets.** Rejected: a rule would need a
  `reqId` or a socket, so the wire would move back into the rule and the pure
  rule suite would need a fake client rather than a captured broadcast.
- **Move server-wide capacity or room-code minting into the rules.** Rejected:
  those read the server's room map, not a room, so they belong to the adapter.
- **Merge the activity semantics at the same time.** Rejected: whether kick or
  leave extend a Room's idle life is a separate product decision; this change
  preserves today's behaviour exactly.
