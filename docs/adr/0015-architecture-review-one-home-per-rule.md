# ADR-0015: One home per rule at each seam

- Status: Accepted
- Date: 2026-10-19
- Ticket: [#117](https://github.com/thom404/wortschatz/issues/117) (architecture
  review), split into [#118](https://github.com/thom404/wortschatz/issues/118),
  [#119](https://github.com/thom404/wortschatz/issues/119),
  [#120](https://github.com/thom404/wortschatz/issues/120),
  [#121](https://github.com/thom404/wortschatz/issues/121),
  [#122](https://github.com/thom404/wortschatz/issues/122) and
  [#123](https://github.com/thom404/wortschatz/issues/123).

## Context

A read-only architecture walk found friction concentrated in the areas that
change most, plus two observable defects. Drag rules were reachable only through
a DOM geometry stub; the `Rooms` class mixed sockets with phase and roster
rules; client state transitions were split between the store and a delta module
that wrote store fields; screen templates and in-place updaters agreed on
element ids only by convention; the connection seam reported an orderly end
twice; and server validation repeated its error envelope. As a result a host
leaving produced two identical `host-changed` messages that the lifecycle test
could not see, and a reconnect during the intermission could render a stale
`0:00` until the next tick.

## Decision

1. **Fix the defect first, on its own.** All host and roster change
   announcements route through one emission point, so each change is announced
   exactly once and leave, kick and auto-release share one order
   ([#118](https://github.com/thom404/wortschatz/issues/118)).
2. **Gesture rules become a pure module** whose input is a normalized sample and
   whose output is trace actions and a submit decision, leaving event binding and
   painting in the client. See
   [ADR-0011](0011-gesture-pure-module.md).
3. **The client store is the single reducer** for server messages and returns the
   play-time versus structural classification; the snapshot gains the
   intermission deadline. See [ADR-0010](0010-client-store-single-reducer.md).
4. **Room phase and roster logic take an injected clock and broadcast**, while
   `Rooms` keeps sockets, greeting and dispatch. See
   [ADR-0012](0012-room-logic-injected-clock-and-broadcast.md).
5. **Each screen declares its live regions beside its template**, and the
   scoreboard mode is derived from the phase in one place. See
   [ADR-0013](0013-live-regions-beside-templates.md).
6. **One greeting and one close outcome at the client seam**, and server message
   validation as field specifications with one error-reply builder. See
   [ADR-0014](0014-connection-seam-and-field-validation.md).

The only wire change is the intermission deadline added to the snapshot; every
other message keeps its shape. Behaviour, visual design, copy and scoring are
unchanged.

## Consequences

- Each rule has one home at one seam, so a change to timing, gesture geometry,
  roster announcements, live regions or the connection handshake touches one
  module and is covered by tests that need no sockets, real timers or a browser
  geometry stub.
- The duplicate `host-changed` and the stale intermission countdown are gone;
  the existing wire-level lifecycle, reconnect, reveal and clock tests remain the
  integration coverage, and the client mount tests remain the highest
  client-side seam.
- [ADR-0002](0002-game-screen-layout-and-skins.md) and
  [ADR-0009](0009-play-time-deltas-in-place.md) still hold: play-time deltas
  update in place, structural changes rebuild, and no component style branches on
  a skin beyond tokens.

## Suppressed alternatives

- **One big-bang refactor across all seams.** Rejected: the defect fix had to
  ship independently of the refactors, and smaller changes are easier to review
  and revert.
- **Change the wire beyond the snapshot deadline.** Rejected: the only
  observable gap was the missing intermission deadline; other message shapes are
  stable contracts for both packages.
