# ADR-0023: App-owned menu surface (the Menü)

- Status: Accepted
- Date: 2026-10-23
- Tickets: spec [#187](https://github.com/thom404/wortschatz/issues/187), [#181](https://github.com/thom404/wortschatz/issues/181) (version source), [#182](https://github.com/thom404/wortschatz/issues/182) (the surface); entries: [#159](https://github.com/thom404/wortschatz/issues/159) (changelog), [#183](https://github.com/thom404/wortschatz/issues/183) (Spielanleitung), [#184](https://github.com/thom404/wortschatz/issues/184) (Quellen), [#185](https://github.com/thom404/wortschatz/issues/185) (Problem melden), under spec [#194](https://github.com/thom404/wortschatz/issues/194)
- Related: [ADR-0018](0018-floating-notification-layer.md) (the app-owned-surface precedent), [ADR-0021](0021-create-and-join-screens.md) (Home, amended below), [ADR-0022](0022-icon-only-controls-and-tooltips.md) (icon-only controls), [ADR-0002](0002-game-screen-layout-and-skins.md) (token uniformity), [ADR-0007](0007-german-ui-copy-voice.md)

## Context

App-global things had no home. The skin switcher sat only on Home (ADR-0021), so
a player inside a room could not reach it; version info had nowhere to live at
all (#181 decide its source). Screens render wholesale into `app.root`, so
anything app-owned must live outside that markup to survive rebuilds — the
floating notification layer (ADR-0018) already established the pattern for an
app-owned surface. A desktop-window "menubar" fits neither mobile (a labelled
bar is cramped) nor this app's vocabulary, whose secondary controls are
icon-only (ADR-0022).

## Decision

1. **The app owns one persistent Menü surface, outside the screen markup.**
   Like the notification layer, it is not screen markup: no screen rebuild can
   remove it, and it is visible on every screen (Home, Create, Join, Wait room,
   Play, Intermission, Outcome). It is one icon-only trigger (`Menü`, ADR-0022
   rules, fixed top-right, safe-area aware) plus an anchored panel, and it
   intercepts no pointer input while closed.
2. **The panel is the app's first overlay dialog.** It closes on Esc, on an
   outside click and on a screen change; focus moves into the panel on open and
   back to the trigger on close. Opening it never pauses a running round: the
   board, timer and gestures keep working underneath.
3. **Menu entries are app-global only.** Screen- and room-phase-scoped actions
   stay on the screens that own them. Exactly two entries in v1: the version
   row (`Version <APP_VERSION>`, the source decided in #181) and the skin
   switcher, moved in from Home — the Home panel is deleted, so Home keeps the
   app name, the tagline and exactly two actions (ADR-0021 amended below).
4. **Queued, never assumed.** Spielanleitung (#183), Quellen/attribution (#184)
   and a link to the GitHub issues (#185) are queued follow-up entries; they do
   not block the v1 surface.

## Suppressed alternatives

- **A screen-level "Einstellungen" screen.** Rejected — leaving Play to reach
  the Skin selects against the in-room use case, and the surface must survive
  screen rebuilds by construction.
- **Keeping the skin switcher on Home _and_ the menu.** Rejected — one home of
  the control; two switchers drift.
- **A horizontal menubar with labelled items.** Rejected — cramped on mobile,
  and secondary controls are icon-only per ADR-0022; labels and primary text
  actions stay on the screens.
- **Language-switching UI in the menu.** Never — the app is German by decision
  (ADR-0007); connection status belongs to ADR-0018, not duplicated here.

## Consequences

- A persistent surface appears in **every** screenshot: the visual matrix's 66
  rows all change, and the ARIA snapshots gain the Menü open/closed. The
  baseline update is a deliberate, reviewed step inside the pinned container
  (ADR-0020), never a drive-by.
- `GLOSSARY.md` gains **Menu**; the **Home** and **Skin** entries change, and
  ADR-0021 records the handover of the skin switcher.
- Adding a menu entry later is a registry-style edit in `menu.ts`, bounded by
  decision 3's app-global-only rule.

## Amendment (#194, 2026-10-23): the queued entries land

Decision 4 queued the Spielanleitung, Quellen and the issues link; #159 added the
changelog as the version row's behaviour. All four are now landed entries in the
same app-owned panel. Decisions 1–3 are untouched: entries remain app-global,
register as Menü rows, and no screen markup owns them.

1. **One disclosure pattern.** Every text entry is a native button toggling its
   panel in place, keyboard-operable and announced by `aria-expanded` /
   `aria-controls`. Disclosures coexist, the panel scrolls, and there is no
   second panel state and no nested dialog. The four close paths (Esc, outside
   click, screen change, trigger) still close the whole Menü.
2. **The version row is the changelog toggle.** It keeps rendering exactly
   `Version <APP_VERSION>`, is a toggle rather than a link, and expands the
   hand-written German changelog beneath it. Entries are one inline
   version-keyed list, newest first, each a version heading plus short
   player-facing notes; no markdown, i18n or fetch (ADR-0007). The block whose
   version equals `APP_VERSION` carries the quiet `aktuell` tag. Exactly one
   retroactive `0.1.0` entry ships with the feature.
3. **Release coupling.** A root-manifest version bump and its changelog entry
   land in the same pull request: no bump without an entry, no entry without a
   bump. The version field remains an ordinary edit per #181.
4. **Quellen and Problem melden.** Quellen names the word-list source
   (`enz/german-wordlist`, CC0-1.0) with one outbound anchor to its upstream
   repository, the reviewed exclusion list (ADR-0001 amendment) and the reveal's
   Wiktionary policy (ADR-0017). Problem melden is a plain link to this
   repository's issues list; it is not a disclosure and adds no in-app form.
   Every outbound link opens in a new tab with `noopener noreferrer` (ADR-0017).
   The deploy gate is met because the app is publicly reachable (ADR-0005).
5. **Documentation and visual seam.** Every entry's copy is hardcoded German
   inline in the client `menu.ts` (ADR-0007). The open-Menü ARIA baseline
   is the one deliberate visual change; the closed-panel screenshot rows stay
   unchanged. Baseline updates happen only through
   `npm run test:visual:update` inside the pinned Playwright container
   (ADR-0020).
