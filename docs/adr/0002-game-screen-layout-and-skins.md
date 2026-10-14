# ADR-0002: Game-screen layout, shared components and token-driven skins

- Status: Accepted
- Date: 2026-10-14
- Ticket: [#8](https://github.com/thom404/wordament-clone-german/issues/8) (game screen look & feel, prototype)
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
