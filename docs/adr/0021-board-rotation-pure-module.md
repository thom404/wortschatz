# ADR-0021: Board rotation is a pure module

- Status: Accepted
- Date: 2026-10-22
- Ticket: [#167](https://github.com/thom404/wortschatz/issues/167), part of
  [#161](https://github.com/thom404/wortschatz/issues/161) (deepening)

## Context

Board rotation's permutation had no single home: the forward arrangement and
the inverse used by drag submission were two consumers of one precomputed table
inside the client's app module, the rotation type and guard sat beside it, and
the "same board" identity key was rebuilt from store state in two helpers.
Nothing forced the forward and inverse mappings to stay consistent, so a future
change could silently submit a different word than the tiles under the finger
spell.

## Decision

1. **One pure module.** `packages/client/src/board-rotation.ts` owns the
   `BoardRotation` type (`0 | 90 | 180 | 270`), the four valid values in cycle
   order, the guard that narrows a number to that type, the forward
   permutation, the inverse permutation, and the board-identity key.
2. **Forward and inverse defined together.** The inverse maps a rendered cell
   and rotation to the server board index it shows; the forward permutation
   renders a board by asking the inverse for every cell. A unit test pins that
   forward ∘ inverse round-trips for all four rotations and all sixteen cells.
3. **The identity key travels with the rotation.** It is a pure function of a
   round number and a board, producing the `roundNumber:board.join("/")`
   string. The app's reset rule compares that one value.
4. **The module is presentation-only.** It changes no wire message, score,
   board data or copy. The rotation state, its reset rules, the German labels,
   the templates and the wiring stay in the app for now; migrating them is
   [#168](https://github.com/thom404/wortschatz/issues/168). Until then the app
   keeps its inline copy, and the module is exercised by its own unit tests.

## Consequences

- The rotation invariant is testable without a browser or a DOM geometry stub.
- A change to how tiles are arranged touches one module, and the submitted
  word and the rendered word cannot drift apart.
- The gesture module and trace stay unchanged: the trace still holds rendered
  cells, and the submit boundary calls the inverse permutation.
- No observable behaviour changes; the existing board-rotation mount test
  remains the end-to-end seam.

## Suppressed alternatives

- **Keep the table in `app.ts` and test it through the DOM.** Rejected: it is
  the coupling that let the forward and inverse mappings drift.
- **Put the module in the shared package.** Rejected: rotation is a client-only
  view transform; the server never sees it.
- **Move the rotation state and reset rules out of the app at the same time.**
  Rejected: that is a separate deepening with its own seam; this ticket owns
  only the pure permutation.
- **Change the trace to hold server board indices.** Rejected: the gesture
  module's cell-space contract stays as it is; the inverse is applied at the
  submit boundary.
