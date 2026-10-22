# ADR-0002: Game-screen layout, shared components and token-driven skins

- Status: Accepted
- Date: 2026-10-14
- Ticket: [#8](https://github.com/thom404/wortschatz/issues/8) (game screen look & feel, prototype)
- Prototype: branch `prototype/game-screen` (throwaway; not in main)

## Context

No application code existed when the look & feel question was raised, so the
decision body came from an interactive throwaway prototype (single static HTML
file: 4×4 grid with multi-letter tiles, pointer drag across 8-way neighbours,
2-minute timer, live score, end-of-round reveal with found/missed words and a
scoreboard). Three structural variants ("Kachel" mobile stack, "Tafel" desktop
dashboard, "Neon" arcade) were reviewed by reacting in the browser.

## Decision

1. **Layout is responsive, not a user choice.** Desktop (≥ 860 px) renders the
   two-column dashboard; mobile renders the stacked, chipped column. The
   breakpoint changes **arrangement only** — the DOM and the component styles
   do not differ per breakpoint.
2. **One shared component vocabulary.** Both arrangements render the same
   components: panels, player chips, found-word chips, ring timer with score,
   the 4×4 tile grid (multi-letter tiles rendered legibly via font sizing on
   the grid container, not per-tile `em`), the current-word trace, and the
   word list. Timer: conic-gradient ring over a solid inner disc (digits sit
   on skin-local surface colour for contrast), with a per-skin `--ping`
   low-time colour (≤ 20 s) shared by digits and ring.
3. **Skins are the user-facing choice, with exactly one default.** A skin is a
   CSS custom-property token set (palette, surface, border, glow, radius)
   consumed by every component, plus at most a few token-driven flourishes.
   Validated start set: **Standard** (light blue/slate — the default) and
   **Arcade** (dark neon). Adding a skin is a token block plus one registry
   entry.
4. **Uniformity rule.** A design that only differs between breakpoints fails
   review; anything per-breakpoint must be expressible as arrangement or
   tokens. Verified against the prototype's four combinations (2 layouts × 2
   skins).
5. **More alternative skins** are deferred to their own ticket.
6. The prototype itself is **not** merged; it is preserved on the throwaway
   branch above as the primary source for the visual language.

## Consequences

- A skin reads as one design on desktop and mobile by construction — no
  per-breakpoint style drift is possible.
- New skins are cheap (pure tokens); they cannot break component layout.
- Implementation brief for the real app: grid-area arrangement for desktop /
  flex order for mobile off one DOM; `:root`/`body[data-skin]` token blocks;
  low-time state handled by a `low` class, not per-skin code paths.
- Revealed prototype bug class worth carrying into the real code: `em`-based
  per-tile sizing resolves against the **parent** inherited font size, not the
  tile's own — size tiles via a clamp on the grid container.

## Suppressed alternatives

- **Per-breakpoint component styles** (cards/table on desktop, chips on
  mobile): rejected — exactly the semantic drift the uniformity rule bans.
- **Layout as a user setting**: rejected — viewport decides arrangement.
- **Big-number timer instead of the ring**: rejected — the ring is one
  component in both arrangements and its inner disc solves contrast.

## Amendment (#142, 2026-10-20): tile values in the index corner

The board's top-left corner used to carry a 0–15 tile index. It now carries the
tile's **value**, in the same footprint and with the same position tokens
(renamed from index wording to point wording). This records the display rule;
scoring, word input and the wire protocol are unchanged.

7. **One shared table.** The German Scrabble letter table, its floor value, the
   per-character lookup and the word-score sum live on the shared package's
   scoring surface. The server's scoring module keeps the injectable
   `ScoreFn` and re-exports the moved names, and the client derives every tile
   value from the same table, so the corner number cannot drift from the
   scoreboard.
8. **Value rule.** `tileValues(tile)` is a pure function returning one value for
   single, digram, prefix and suffix tiles, and one per variant for either/or
   tiles in declared letter order. It composes the tile-spelling helpers with
   the word-score function.
9. **Pair, collapse and order.** Differing either/or variants render joined by
   `/` with no spaces in letter order (`e/ä` → `1/6`, `o/u` → `2/1`); equal
   variants collapse to one number (`i/e` → `1`). Every other tile shows one
   number.
10. **Selection and parity.** The selected-tile accent fill recolours the value
    to `--accent-ink`. The game and intermission boards render through one tile
    path, so the pause shows the same values; spectators see them too, and no
    component style branches on a skin.
11. **Accessible copy.** The tile's label is its displayed letters, a comma and
    its German points phrase (`sch, 7 Punkte`, `e/ä, 1 oder 6 Punkte`); the
    visible number is hidden from assistive technology, and the whole tile
    carries the same points phrase as its hover title. Indices disappear from
    the product.

## Amendment (#150, 2026-10-21): ß displays as capital ẞ

The tiles and words keep their uppercase look, but `ß` is the one exception
to the browser's Unicode full case mapping. CSS `text-transform: uppercase`
would expand it to two glyphs, `SS`, so a `ß` tile reads like a double `s`
and the distinct words `straße` and `strasse` render identically. A pure
display helper maps `ß` to capital `ẞ` (U+1E9E) and changes nothing else;
`ẞ` is one glyph and is unaffected by the uppercase transform.

12. **One display mapping.** `displayWord(word)` substitutes `ß` → `ẞ` and
    passes every other character through. `displayTile(tile)` extends it with
    the notation rules (prefix/suffix markers drop off, either/or variants
    stay), so tiles, the drag trace, the private found-word chips and the
    reveal words all render through the same mapping.
13. **Display only.** Submission, matching, scoring and the tile inventory
    keep the canonical lowercase `ß`; no `ss` tile is added and `straße` stays
    distinct from `strasse`. The accessible tile label follows the displayed
    letters (`ẞ, 2 Punkte`), so the visible glyph and the label agree.

## Amendment (#151, 2026-10-21): player-local board rotation

A player may turn the board in 90° steps to see the same letters in another
arrangement. The board stays server-owned and shared; rotation is a view
choice, not data.

14. **Presentation, not data.** Rotation is a client-only arrangement. The
    server, wire protocol, board generation, word list, scoring, deadline and
    reveal are untouched, and no message crosses the wire when the view turns.
15. **Arrangement rotates, glyphs do not.** The sixteen tiles are permuted
    over the grid; each tile keeps its upright letters and its point value in
    the corner. A rigid rotation of the whole board is not the mechanism,
    because it would turn the letters with it.
16. **Quarter turns, index-based selection.** The state is one of 0/90/180/270,
    so cells map cell-to-cell and the pointer→tile hit-test and clear-hit
    margin stay exact. A trace stores grid cells and maps each back to its
    server board index before reading the tile, so the submitted word is
    exactly what the tiles under the finger spell.
17. **Lifetime and control.** The step is an in-memory client field, default 0,
    reset when a new board starts (a reload also starts at 0°). It survives
    re-renders within its board and is shown on that round's intermission. A
    labelled control group beside the board on the game and intermission
    screens carries the active step in `aria-pressed`, follows the reveal-sort
    control pattern, and is available to spectators too. Turning the board
    ends any in-progress drag.

## Suppressed alternatives (#151)

- **Rigid board rotation:** rejected — the letters would turn and become
  unreadable.
- **Mirroring/flipping or free angles:** rejected — they break the fixed cell
  geometry the drag hit-test relies on.
- **Persisting the step or syncing it room-wide:** rejected — the choice is
  per player and per board, never a hidden preference or shared state.

## Amendment (#172, 2026-10-22): desktop sheet and board scale

At ≥ 860 px the two-column dashboard was real but small: `--sheet-width` capped
the whole app at 640 px, so the desktop "dashboard" was a 640 px column holding a
`320px`-wide board — roughly 77 px cells with a 6 px gap, tight for a mouse drag
on a 4×4 grid.

18. **Three tokens, one breakpoint.** Inside the existing `@media (min-width:
860px)` block, `--sheet-width` steps to 1040 px, the board's `max-width` to
    460 px and `--board-gap` to 10 px. There is no second breakpoint and no
    per-breakpoint component style: only token values change, so the uniformity
    rule of §4 still holds. At 1280×800 this yields a ~620 px board column with
    ~107 px cells; the `.dashboard` 1.4fr/1fr ratio, the intermission
    arrangement and the 72 px ring timer are unchanged.
19. **The board gap is its own token.** It stops aliasing `--gap-xs`, so chip and
    panel rhythm can never drag the grid around.
20. **One source for the drag margin.** The clear-hit margin the gesture wiring
    uses is read from the board's computed gap when the board renders, instead
    of being a second literal copy of the same number, so the CSS token is
    authoritative.

## Amendment (#174, 2026-10-22): the rotation control is one cycling button

§17 described "a labelled control group beside the board" carrying the active
step in `aria-pressed`. It is now a single button under the board: each press
turns the board 90° clockwise, wrapping `0 → 90 → 180 → 270 → 0`.

21. **One target, one stable name.** The `role="group"`, the four pressed buttons
    and the visible `Spielfeld drehen` label are gone. The button's accessible
    name and its tooltip are one stable German string (`Spielfeld um 90°
drehen`) that never includes the current angle: with one button the numeral
    has no fixed original to be read against, and the board itself shows the
    result. The live angle stays machine-readable as `data-rotation` on
    `#board`, which is what the drag path reads. Availability to spectators,
    lifetime across re-renders, the reset on the next board, and the
    gesture-ending behaviour of §17 are all unchanged. The accessible-name and
    tooltip policy is [ADR-0022](0022-icon-only-controls-and-tooltips.md).
