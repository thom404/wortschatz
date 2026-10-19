# ADR-0013: Screens declare their live regions beside their templates

- Status: Accepted
- Date: 2026-10-19
- Ticket: [#122](https://github.com/thom404/wortschatz/issues/122), part of
  [#117](https://github.com/thom404/wortschatz/issues/117) (architecture review)

## Context

ADR-0009 keeps play-time deltas from rebuilding the screen: the countdown, the
scoreboard/standings and the private found-word chips are refreshed **in
place**. The in-place updater, however, called one hardcoded helper per region
(`updateTimer`, `updateScoreboard`, `updateFound`), while each screen's
template hardcoded its own element ids and its own scoreboard mode
(`"ranked"` in the game, `"session"` in the intermission). Template and updater
agreed only by convention: a screen could render a region the updater did not
know about, and the scoreboard's first paint could use a different mode from
the in-place refresh.

## Decision

1. **A live region is a declaration.** A `LiveRegion` is the selector of the
   element that anchors the region plus the in-place rewrite that refreshes it
   from the store.
2. **Each screen declares its regions once, beside its template.** The game
   screen declares the ring timer, the ranked scoreboard and the found-word
   chips; the intermission declares the countdown and the session standings;
   the lobby declares its roster; the home and outcome screens declare none.
   The render path installs the current screen's declarations on the app.
3. **The updater iterates the declarations.** The play-time path walks the
   current screen's `LiveRegion`s and skips any whose element the screen does
   not render (a spectator's found-word chips), so the `#timer` identity
   survives.
4. **The scoreboard's mode follows the phase in one place.** `scoreboardMode`
   is the single decision; the first paint and the in-place update both read
   `scoreboardHtml`, so the ranked and session modes cannot disagree.

## Consequences

- Adding or changing a live region is one declaration beside the template it
  belongs to; the template and the updater can no longer drift.
- ADR-0009 is unchanged in substance: play-time deltas still update in place
  and structural changes still rebuild. ADR-0002's components and tokens are
  untouched.
- Rendered output and copy are unchanged; the DOM the screens produce is the
  same as before.
- The scoreboard mode reads the store's phase, so a screen's in-place refresh
  always matches its first paint.

## Suppressed alternatives

- **Keep one hardcoded helper call per region.** Rejected: exactly the
  convention-only coupling between template and updater this removes.
- **Derive the region set from the phase in the updater.** Rejected: the
  screen owns its template; a declaration beside that template is the honest
  source, and a region can be present on a screen the phase alone cannot name.
- **Pass the scoreboard mode as a literal from each screen.** Rejected: it
  lets each screen's first paint disagree with the in-place refresh.
