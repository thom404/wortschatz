# ADR-0012: Room phase and roster logic take an injected clock and broadcast

- Status: Accepted
- Date: 2026-10-19
- Ticket: [#121](https://github.com/thom404/wortschatz/issues/121), part of
  [#117](https://github.com/thom404/wortschatz/issues/117) (architecture review)

## Context

The `Rooms` class held the socket lifecycle, greeting, message dispatch, the
phase machine and the roster rules in one file. The phase and roster rules
(deadlines, ticks, auto-advance, host transfer, seat release, room expiry)
therefore needed a real WebSocket server and real timers to exercise, and the
same fan-out loop was repeated for room broadcasts, seat sends and single-socket
sends.

## Decision

1. **A `RoomLogic` module.** `packages/server/src/room-logic.ts` owns the phase
   machine and roster rules: round start/end, skip, auto-advance, the tick
   loop, host succession, seat release and auto-release, empty grace and idle
   expiry.
2. **Two injected seams.** `RoomLogic` receives a `Clock` (`now`, `setTimeout`,
   `clearTimeout`, `setInterval`, `clearInterval`) and a broadcast function.
   Production passes `systemClock` and the room's socket fan-out; tests pass a
   manual clock and a captured message array, so no real timer or socket is
   involved.
3. **The room class keeps the wire.** `Rooms` owns sockets, the greeting,
   message dispatch, snapshots and the fan-out. It creates a `RoomLogic` with
   its own broadcast and expiry callbacks and delegates every phase and roster
   decision to it.
4. **One fan-out primitive.** Room broadcast, seat send and single-socket send
   all route through `fanOut`, which serializes once and swallows a send on a
   socket that is already gone.

## Consequences

- Phase and roster rules are unit-tested with a controllable clock and a
  captured broadcast: deadline arithmetic, tick payloads, auto-advance gating,
  host succession order, seat auto-release and room expiry.
- The wire-level lifecycle, reconnect, reveal and clock tests remain the
  integration coverage and are unchanged.
- Leave, kick and auto-release keep the single emission point established by
  the host broadcast fix: successor `host-changed` first, then `player-left`.
- The module is still server-internal; the highest server seam for behaviour
  remains the real WebSocket wire.

## Suppressed alternatives

- **Pass `Date.now` and timer functions as separate callbacks.** Rejected: one
  clock object keeps the time source and its timers from drifting apart and
  makes the test double a single value.
- **Have `RoomLogic` own socket fan-out.** Rejected: that would put sockets
  back into the phase rules and recreate the coupling this split removes.
