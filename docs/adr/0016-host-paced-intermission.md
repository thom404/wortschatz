# ADR-0016: The intermission is host-paced and has no clock

- Status: Accepted
- Date: 2026-10-20
- Ticket: [#138](https://github.com/thom404/wortschatz/issues/138), part of
  [#131](https://github.com/thom404/wortschatz/issues/131) (host-paced
  intermission map)

> Numbered 0016 because 0010 already records the client-store decision. The
> ticket originally reserved the 0010 slot before the architecture-review ADRs
> landed.

## Context

The pause between rounds ran on its own clock. The server armed an intermission
deadline, sent intermission ticks, and auto-advanced when it expired; the host's
_Nächste Runde starten_ button only pulled that deadline forward. Players were
pulled into the next round whether the group was ready or not. The pause also
gated round starts on two connected players, so a solo host could not play, and
a pause that lost its host could sit with no way forward.

The round clock, the reveal and scoring were not part of the problem. The
contract that needed changing was only how a pause ends.

## Decision

1. **The intermission has no timer.** Ending a round clears the room deadline to
   zero, stops the round tick loop, arms no phase timer and broadcasts no
   intermission tick. The server never advances a pause on its own.
2. **The host starts every round.** `start-round` is the one start path, in the
   lobby and in the pause alike. The pause ends only on that message.
3. **One connected player is enough.** Round starts no longer gate on a player
   count, so a solo host is never stuck. The `need-players` error code and the
   `skip` client message are retired from the wire.
4. **A tick means only the round clock.** `tick` loses its `phase` field and is
   sent only while `playing`.
5. **A hostless non-playing room with someone present ends cleanly.** At the
   point the state can arise — after a disconnect, after a leave or seat
   release, and on entering the pause — the room ends with reason `no-players`
   (close code 1001). During `playing` the round finishes first. A fully empty
   room keeps its existing 60-second grace.
6. **Host self-heal.** A room with no host adopts the next connecting player as
   host and announces `host-changed`, so a hostless room can recover instead of
   dead-ending.
7. **The client mirrors the contract.** The pause renders no ring timer or
   countdown; the host button sends `start-round`; non-hosts see _Der Gastgeber
   startet die nächste Runde._ The round timer still interpolates only while
   playing.

## Consequences

- The pause lasts exactly as long as the host wants; there is no countdown to
  race and no automatic transition.
- The `skip` path, the auto-advance helpers, the intermission deadline branch,
  the intermission-length protocol constant and its config override are gone.
  There is exactly one way to start a round.
- A room cannot hang in a hostless pause: it either has a host, is empty within
  its grace, or ends with `no-players`.
- Host transfer on a disconnect during play is unchanged: duties still move to
  the longest-connected remaining player.
- The round clock, reveal, scoring and server authority are untouched. See
  [ADR-0009](0009-play-time-deltas-in-place.md) for the round countdown's
  play-time deltas.

## Suppressed alternatives

- **Keep an intermission timer with a long safety net.** Rejected: any clock
  reintroduces the automatic start the room must not have.
- **Let a spectator become host when a pause has no connected player.**
  Rejected: a pause nobody can advance should end, not appoint a spectator who
  cannot yet play.
- **Keep `skip` as a second start path alongside `start-round`.** Rejected: two
  messages for one decision invites drift; `start-round` already means the same
  thing in both phases.
- **Keep the two-player start gate.** Rejected: it blocks solo play and has no
  bearing on whether the group is ready.
