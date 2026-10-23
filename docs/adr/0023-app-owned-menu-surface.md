# ADR-0023: App-owned menu surface (the Menü)

- Status: Accepted
- Date: 2026-10-23
- Tickets: [#181](https://github.com/thom404/wortschatz/issues/181) (version source), [#182](https://github.com/thom404/wortschatz/issues/182) (the surface); queued entries: [#183](https://github.com/thom404/wortschatz/issues/183), [#184](https://github.com/thom404/wortschatz/issues/184), [#185](https://github.com/thom404/wortschatz/issues/185)
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
