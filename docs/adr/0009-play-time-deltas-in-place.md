# ADR-0009: Play-time deltas update the running timer in place

- Status: Accepted
- Date: 2026-10-17
- Ticket: [#86](https://github.com/thom404/wortschatz/issues/86) (a Tick updates
  the ring timer in place) and [#87](https://github.com/thom404/wortschatz/issues/87)
  (round-score changes and accepted words update in place), part of
  [#85](https://github.com/thom404/wortschatz/issues/85) (timer indicator is
  glitchy within an open game)

## Context

The client rebuilt the whole game screen on every server message. A once-per-
second **Tick** therefore replaced the ring timer (`#timer`) and its digits,
and the freshly inserted ring briefly painted its full-circle default before
the correct remaining-time value landed — a visible flash every second. The
throwaway prototype (ADR-0002) kept one ring and rewrote it in place, so this
was a regression in the real client.

## Decision

The client render path distinguishes two kinds of server delta:

1. **Play-time delta** — changes only live, already-rendered game state (the
   countdown, the scoreboard/standings and the private found-word chips). It
   refreshes those regions **in place** and must not rebuild the screen. Tick,
   `score-update` and `word-accepted` are play-time deltas.
2. **Structural change** — Round start, Intermission, roster join/leave/
   disconnect, host change, screen change, Room end. It still rebuilds the
   whole screen.

The store's notification carries the kind (`DeltaKind`: `play-time` /
`structural`); the store reducer classifies each message (ADR-0010) and
`app.ts` renders accordingly. The shared low-time look (one `low` class through the `--ping`
token) is unchanged.

## Consequences

- The `#timer` element and its digits keep their identity across Ticks, round
  score changes and accepted words, so the ring never flashes its full-circle
  default when points change.
- The ring shows remaining time as a circle fragment; between phase changes it
  only shrinks or holds at zero.
- The live scoreboard and the private found-word chips refresh in place through
  the same play-time path.

## Suppressed alternatives

- **Add a CSS transition to hide the flash.** Rejected: masks the rebuild
  instead of removing it.
- **Rebuild only the timer subtree.** Rejected: broader than the countdown
  needs and still replaces the ring, defeating identity.
- **Update every delta in place.** Rejected: structural changes genuinely
  rearrange the DOM (board, roster, reveal), so they keep rebuilding.
