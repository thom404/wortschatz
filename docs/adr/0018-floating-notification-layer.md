# ADR-0018: Floating notification layer for status and errors

- Status: Accepted
- Date: 2026-10-20
- Ticket: [#146](https://github.com/thom404/wortschatz/issues/146)
  (floating UI notifications)
- Related: [ADR-0002](0002-game-screen-layout-and-skins.md) (tokens and
  uniformity), [ADR-0007](0007-german-ui-copy-voice.md) (reused German copy)

## Context

Every message lived in the normal page flow of whichever screen rendered it:
home validation and rejected greetings in an empty `#home-errors` paragraph,
the lobby's start rejection in `#start-hint`, in-game verdicts in an `#error`
paragraph above the dashboard, and connection status in a dim paragraph on the
lobby, game and intermission screens only. An appearing message therefore moved
the board and buttons, the message lived in a different place on every screen,
and the duplicate-word verdict could sit in the game screen until the next
snapshot. The start screen — the first place a player waits for a connection —
had no status at all, and no message was announced to assistive technology.

## Decision

1. **One layer, owned by the app shell.** `mount` builds a shell containing a
   screen container and one notification container. Screens render into the
   screen container; the notification container is created once and is never
   inside markup a screen rebuild replaces. The layer survives re-renders and
   screen transitions, and unmounting the app removes it.
2. **Two slots, not a queue.** One connection-status slot above one error slot.
   A new error replaces the previous error in place. The text is only written
   when it changes, so an identical repeat neither re-announces nor restarts the
   entry animation. No history and no dismissal affordance.
3. **Placement.** Fixed to the viewport at the bottom centre, above the
   safe-area inset, with its content width capped at the sheet width. One
   position and one arrangement at every breakpoint (ADR-0002's uniformity
   rule).
4. **Pointer transparency.** The container is transparent to pointer and touch
   input, so the board, a button or a drag that starts under it is never
   blocked.
5. **Lifetime.** There is no timer. An error stays until a fresh action that
   addresses it (retry, new submit, new start attempt) or until the phase
   changes; a phase change never carries an error into the next screen. It also
   clears on an outcome screen and on returning home. Connection status exists
   only while an attempt is live (`connecting` / `retrying`): the idle start
   screen shows nothing, and an open connection or a torn-down connection shows
   nothing.
6. **Accessibility.** The status slot is a polite live region (`role="status"`,
   `aria-live="polite"`); the error slot is assertive (`role="alert"`,
   `aria-live="assertive"`). Messages are text, never focusable elements.
7. **Motion.** A short fade plus upward slide on entry. Under
   `prefers-reduced-motion: reduce` the change is immediate, with no animation
   or transform.
8. **Tokens only.** Z-index, inset/spacing, radius, surface, border and shadow
   values live in both skin token blocks. The component styles consume tokens
   and never branch on a skin (ADR-0002).
9. **Reused copy.** No new user-facing string. Server errors keep coming from
   the shared German catalogue; local validation strings stay inline in the
   client. Positive verdicts stay in the found-word chips, informational notes
   stay where they are, and outcome screens (room not found, kicked, room
   ended, connection lost) remain full screens with an action.

## Rejected alternatives

- **Auto-dismiss timer.** A player can lose a rejection before finishing it, and
  the timer would compete with the server-driven lifetime.
- **Dismiss button or swipe-to-dismiss.** It adds a focus stop and an affordance
  to every message for a case the next action already resolves; it also makes
  the layer non-transparent to pointer input.
- **A body-level sibling host created outside `mount`.** It escapes the app's
  ownership and unmount path, and needs a second lifecycle to clean up. The
  shell inside the existing mount root gives the same persistence without a new
  seam.

## Consequences

- The board and buttons no longer move when a message appears or disappears.
- Each screen no longer owns an error surface; the inline paragraph/span and
  their CSS rules are removed, so there is one path to maintain.
- Tests keep asserting the German copy, now in the floating layer, through the
  existing mount harness and scripted connection. Layout, motion and
  `prefers-reduced-motion` are stylesheet and ADR concerns, not DOM assertions.
- The client bundle and the server/protocol/deployment are unchanged.
