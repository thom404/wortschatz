# ADR-0011: The board drag is a pure Gesture module

- Status: Accepted
- Date: 2026-10-19
- Ticket: [#120](https://github.com/thom404/wortschatz/issues/120), part of
  [#117](https://github.com/thom404/wortschatz/issues/117) (architecture review)

## Context

The drag word-input rules — one gesture per press, cross-stream joining, the
touch-pointer cancel deferral, the clear-hit margin, stair-step bridging,
backtracking and the once-per-tile rule — lived inside the client's event
handlers in `app.ts`. The only way to exercise them was to mount the app into a
DOM and stub browser geometry, so four recent commits' worth of rules were
easy to regress and hard to read.

## Decision

1. **A pure `Gesture` module.** `packages/client/src/gesture.ts` owns the
   rules as an `applyGestureSample(state, sample)` reducer. It has no DOM and
   no timers, so a plain sample sequence exercises every rule.
2. **A normalized sample is the input.** The wiring resolves the browser event
   to `{ phase, stream, id, point, tile, clear, pointerType }` — the stream's
   identifier, the point, the tile index it resolved to, and whether the
   sample is clearly inside that tile. The rules are geometry-free.
3. **Trace and submit are the output.** The reducer returns the next
   `GestureState`, whether the visible trace changed (paint it), whether the
   sample was claimed (a touch handler `preventDefault`s), and the traced
   tiles a real release submits. The wiring turns those tiles into the
   submitted word from the server-owned board.
4. **The client keeps binding and painting.** `app.ts` still binds the pointer
   and touch listeners, runs the point→tile hit-test and paints the trace;
   only the rules move.

## Consequences

- Gesture rules are covered by sample-sequence unit tests without a browser
  geometry stub. The existing DOM drag tests remain and now act as wiring
  tests for the hit-test, painting and event binding.
- The rule set has one home; a change to bridging, backtracking or the
  cross-stream handshake touches one module.
- Behaviour, visual design and copy are unchanged.

## Suppressed alternatives

- **Keep the rules in the event handlers and test through the DOM stub.**
  Rejected: it is exactly the coupling that made the rules hard to change
  safely.
- **Let the module resolve points to tiles.** Rejected: resolution is a DOM
  hit-test, which would drag geometry back into the rules.
- **Have the module build the submitted word.** Rejected: the word comes from
  the server-owned board, and the module holds no board.
