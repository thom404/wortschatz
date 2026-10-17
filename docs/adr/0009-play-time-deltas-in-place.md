# ADR-0009: Play-time deltas update the running timer in place

- Status: Accepted
- Date: 2026-10-17
- Ticket: [#86](https://github.com/thom404/wortschatz/issues/86) (a Tick updates
  the ring timer in place), part of [#85](https://github.com/thom404/wortschatz/issues/85)
  (timer indicator is glitchy within an open game)

## Context

The client rebuilt the whole game screen on every server message. A once-per-
second **Tick** therefore replaced the ring timer (`#timer`) and its digits,
and the freshly inserted ring briefly painted its full-circle default before
the correct remaining-time value landed — a visible flash every second. The
throwaway prototype (ADR-0002) kept one ring and rewrote it in place, so this
was a regression in the real client.

## Decision

The client render path distinguishes two kinds of server delta:

1. **Play-time delta** — changes only the live countdown. It re-anchors the
   countdown and ring **in place** and must not rebuild the screen. Tick is the
   first play-time delta.
2. **Structural change** — Round start, Intermission, roster join/leave/
   disconnect, host change, screen change, Room end. It still rebuilds the
   whole screen.

The store's notification carries the kind (`DeltaKind`: `play-time` /
`structural`); `deltas.ts` classifies each message and `app.ts` renders
accordingly. The shared low-time look (one `low` class through the `--ping`
token) is unchanged.

## Consequences

- The `#timer` element and its digits keep their identity across Ticks, so the
  ring never flashes its full-circle default.
- The ring shows remaining time as a circle fragment; between phase changes it
  only shrinks or holds at zero.
- Future countdown-only messages (a Round score change, an accepted word) can
  join the play-time path without another render-model change.

## Suppressed alternatives

- **Add a CSS transition to hide the flash.** Rejected: masks the rebuild
  instead of removing it.
- **Rebuild only the timer subtree.** Rejected: broader than the countdown
  needs and still replaces the ring, defeating identity.
- **Update every delta in place.** Rejected: structural changes genuinely
  rearrange the DOM (board, roster, reveal), so they keep rebuilding.
