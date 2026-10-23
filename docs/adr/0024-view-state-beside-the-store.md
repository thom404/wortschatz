# ADR-0024: View state has a home beside the store

- Status: Accepted
- Date: 2026-10-23
- Ticket: [#196](https://github.com/thom404/wortschatz/issues/196), the
  specification for [#160](https://github.com/thom404/wortschatz/issues/160)
  (deepening)

## Context

The client store is the single reducer for server-derived state, but the
client-only view state had no comparable home. The intermission reveal order,
the player-local Board rotation and the live Gesture lived as three fields on
the app controller, and their reset rules were spread through its message
handler. The most delicate rule read the store _before_ the store applied a
snapshot, comparing the old board's identity with the new one. A change to one
view-state lifetime therefore touched both the render code and the message
handler, and only the mount tests could see the result.

The separation was also misleading: the reducer boundary was clean while the
view-state boundary was not. A future message or a new piece of client-only
state had no obvious home, so the app controller kept growing. Players saw the
effect at the boundaries: a rotation surviving into the wrong board, a reveal
order that did not reset on a reconnect, or a drag surviving into a screen
where it did not belong. In particular, rotation was the only action that
ended a Gesture, so a drag held across the intermission could outlive its
Round.

## Decision

1. **One module beside the store.** `packages/client/src/view-state.ts` exports
   a `ViewState` class holding the reveal order (`length` | `points` |
   `alphabet`), the Board rotation (`0 | 90 | 180 | 270`) and the live Gesture
   or `null`, plus the identity key of the last board it saw. It has no DOM,
   timer, store handle or wire access.
2. **Three mutation paths.** `apply(msg)` handles server messages, `reset()`
   returns every value to its default, and `rotate()` advances one quarter turn
   and ends any live Gesture. Choosing a reveal order is a plain assignment;
   the Gesture wiring writes the Gesture field.
3. **One reset table.** Defaults are the grouped reveal order, 0° rotation, no
   Gesture and an empty board key. `reset()` is called once per Room visit,
   from `startRoom`. A Snapshot always resets the reveal order; it computes the
   key from its live Round or finished Round (empty when it carries neither)
   and resets the rotation and Gesture only when that key differs from the
   stored one. A Round start resets the rotation and Gesture and stores the new
   key. A Round end ends the Gesture and keeps the rotation, reveal order and
   board key. Every other message changes nothing.
4. **The module runs before the store.** The message handler calls
   `viewState.apply(msg)` before `store.apply(msg)`, because the store notifies
   its subscribers synchronously and that notification renders the screen.
   View state must already be current when the structural render runs.
5. **The app still paints.** The controller holds one `ViewState`; screens read
   it. The rotation control calls `rotate()` and repaints only the board; the
   reveal sort sets the order and repaints only the reveal. The module never
   writes markup and never decides a repaint.
6. **The board identity keeps one owner.** The module reuses
   `boardIdentityKey` from the Board rotation module rather than rebuilding the
   `roundNumber:board` comparison. The render path and the reset rule cannot
   disagree about what "the same board" means.
7. **Live regions stay with the screens.** They are per-render declarations
   carrying update functions for the current template; no server message resets
   them. `clearHitMargin` likewise stays in the app, measured from the rendered
   board after a render.

The only observable behaviour change is that a Gesture now ends at the Round
boundary and never crosses a board boundary. Screens, copy, German labels,
tooltips, pressed states, timing, scores and the wire protocol are unchanged.
View state stays in memory; a reload starts fresh and nothing goes to
`localStorage`.

## Consequences

- Every client-only lifetime reads from one table, so a change touches one
  module and is pinned by pure unit tests without a DOM.
- The message handler stops reading the store to decide a view reset, so the
  reducer boundary and the view-state boundary are separate.
- A rotation cannot survive into a different board, a reveal order resets on a
  Snapshot and a Gesture cannot outlive its Round or cross an arrangement.
- The existing reveal-sort and board-rotation mount tests remain the
  end-to-end seam and prove the lifetimes through rendered screens.

## Suppressed alternatives

- **Keep the three fields on the app controller.** Rejected: it leaves the
  lifecycle split across the render code and the message handler, and gives a
  future client-only value no home.
- **Give the module a store handle and let it read `store.round`.** Rejected:
  the module would take on server state and its reset rule would again depend
  on reducer timing; the message already names the board.
- **Let the module write markup or trigger repaints.** Rejected: painting and
  screen declarations stay in the controller; the module only holds data and
  decides when it resets.
- **Move the live regions into view state.** Rejected: they are per-render
  template declarations, not values with a lifetime across messages.
- **Persist view state across reloads.** Rejected: out of scope; the choice is
  local to one browser session and must not surprise a returning player.
- **Add a wire message for view state.** Rejected: it is player-local and must
  leave the Room and the other players unaffected.
