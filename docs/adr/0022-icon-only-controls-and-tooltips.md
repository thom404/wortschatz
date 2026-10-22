# ADR-0022: Icon-only secondary controls and their tooltips

- Status: Accepted
- Date: 2026-10-22
- Ticket: [#174](https://github.com/thom404/wortschatz/issues/174) (icon-only
  secondary controls, part of
  [#166](https://github.com/thom404/wortschatz/issues/166) improve front end)
- Related: [ADR-0002](0002-game-screen-layout-and-skins.md) (layout, skins, the
  rotation control),
  [ADR-0007](0007-german-ui-copy-voice.md) (German copy voice),
  [ADR-0020](0020-browser-visual-regression-seam.md) (the network guard that
  rules out an icon CDN), [ADR-0021](0021-create-and-join-screens.md) (the
  screens these controls live on)

## Context

[#166](https://github.com/thom404/wortschatz/issues/166) asks to "simplify, use
icone where possible, instead of text, text can be visible on hover for
additional infos". Applied literally that unlabels `Raum erstellen`,
`Beitreten` and `Runde starten` — the three actions a newcomer needs — and makes
the meaning of every control depend on hover, which touch devices do not have.

The client had no icon vocabulary at all: the only symbol was the `↗` text arrow
on a revealed word's Wiktionary link, and the only tooltips were native `title`
attributes on tiles and that link. Native `title` never appears on keyboard
focus, appears late, cannot be styled and does not exist on touch.

## Decision

1. **Icon-only is for secondary controls.** Rotation, the reveal-sort selection
   and leaving the room. Primary actions keep visible text: `Raum erstellen`,
   `Beitreten`, `Runde starten`. The outcome screens' `Zur Startseite` keeps an
   icon **and** text: it is the only action on its screen, and a lone icon there
   is worse than a word.
2. **Icons are hand-authored inline SVG** in `packages/client/src/icons.ts`:
   24×24 viewBox, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`,
   `aria-hidden="true"`. No icon dependency, so the production bundle stays as
   it is and the visual suite's network guard (ADR-0020 §8) stays satisfied.
3. **One value per control.** An icon-only control's accessible name and its
   tooltip are the same German string, taken from one place in the code — never
   two copies that can drift.
4. **Tooltips are CSS-only.** A `data-tip` attribute plus an `::after` element:
   visible on `:hover` and `:focus-visible` after roughly 300 ms
   (`transition-delay`), styled from skin tokens, `pointer-events: none`. No
   JavaScript, no floating layer, no repositioning logic — so the tooltip is
   deterministic for the screenshot suite.
5. **No `aria-describedby`.** The name and the description would be the same
   string, so describing the control would make a screen reader announce it
   twice. The tooltip stays out of the accessibility tree; the `aria-label`
   carries the meaning.
6. **Touch targets are at least 44×44 px.** A 24 px glyph never shrinks its
   target, and the focus ring must not be clipped by a neighbour.
7. **The rotation control is one cycling button** — one press turns the board
   90° clockwise, wrapping `0 → 90 → 180 → 270 → 0`. This amends ADR-0002 §17.
8. **The skin switcher stays a native `<select>`.** It is not a button, and an
   invented toggle or menu would carry worse semantics for no visible gain.
9. **The two existing native `title` tooltips stay for now.** Tiles and the
   Wiktionary link are not controls; unifying them onto the tooltip of item 4 is
   a follow-up, not part of this decision.

## Rejected alternatives

- **An icon library (lucide, heroicons, an icon font).** Rejected — a build or
  runtime dependency, an unbounded icon surface to police, and a bundle the
  network guard and the Docker build would have to carry, for a dozen paths.
- **Icon + label on desktop, icon-only on mobile.** Rejected — that is exactly
  the per-breakpoint component difference ADR-0002 §4 bans, and it puts hover
  text on the one device class that has hover, while touch gets neither.
- **The `title` attribute as the tooltip.** Rejected — no keyboard focus, a
  browser-dependent delay, no styling, nothing on touch.
- **`aria-label` plus `aria-describedby` pointing at the tooltip.** Rejected —
  a duplicate announcement of the identical string.
- **A `<select>` or menu for rotation instead of a cycling button.** Rejected —
  a cycling button removes three targets without introducing an interaction
  model the app does not otherwise have.

## Consequences

- A sighted touch user meets an icon-only control with no label until they learn
  the icon; the accessible name carries the meaning for assistive technology
  regardless, which is why the number of such controls is deliberately small and
  why the primary actions are excluded.
- Adding a secondary control now means adding an icon plus one German string used
  as both name and tooltip — a small, checkable convention.
- The rotation control's accessibility tree shrinks from a group of four pressed
  buttons to a single button; the live angle remains readable as `data-rotation`
  on `#board`, which is what the drag path reads.
- The game and intermission ARIA snapshots change shape, and the tooltip adds one
  targeted screenshot row per skin.
