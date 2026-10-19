# ADR-0010: The client store is the single reducer for server messages

- Status: Accepted
- Date: 2026-10-19
- Ticket: [#119](https://github.com/thom404/wortschatz/issues/119), part of
  [#117](https://github.com/thom404/wortschatz/issues/117) (architecture review)

## Context

Client state transitions were split: the store held state and some mutators,
while a separate delta module switched over every server message and wrote
store fields directly. Both files had to change whenever a message's effect
changed, and the play-time versus structural classification lived apart from
the state it described. The split also made the transitions hard to test
without mounting the DOM.

## Decision

1. **One reducer.** `GameStore.apply(msg)` applies every server message to
   client state, notifies subscribers, and returns the message's
   `DeltaKind` (`play-time` or `structural`). Nothing outside the store
   writes state fields on a message's behalf.
2. **Classification lives with the reducer.** `deltaKind(msg)` is a pure
   function beside the store, so the render consequence and the state change
   cannot drift apart.
3. **Clock helpers live beside the timer.** `remainingOf`, `fmt` and
   `LOW_TIME_MS` sit next to the timer markup in `app.ts`, where they are
   used, rather than in a message-handling module.
4. **The snapshot carries the intermission deadline.** `FinishedRoundInfo`
   gains an absolute `deadline`, and the server fills it from the room clock.
   A client that reconnects during the intermission therefore renders the
   correct remaining time on its first frame, without waiting for a Tick.

## Consequences

- Store transitions are testable without the DOM: feed messages, assert state
  and the returned classification.
- ADR-0009 is unchanged in substance: play-time deltas still update in place;
  the store now decides the classification at the same point that applies the
  delta.
- The snapshot gains one field; every other wire message keeps its shape.
- The reconnect path no longer needs a follow-up tick to show a non-zero
  intermission countdown.

## Suppressed alternatives

- **Keep a separate delta module that mutates the store.** Rejected: it keeps
  two places responsible for one transition.
- **Derive the intermission remaining time from the last tick.** Rejected: a
  reconnecting client has received no tick for the current phase, so its first
  render would show 0:00 until the next one.
