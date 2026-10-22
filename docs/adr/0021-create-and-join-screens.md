# ADR-0021: Create and join screens, and the entry routing

- Status: Accepted
- Date: 2026-10-22
- Ticket: [#173](https://github.com/thom404/wortschatz/issues/173) (split the
  entry into create and join screens, part of
  [#166](https://github.com/thom404/wortschatz/issues/166) improve front end)
- Related: [ADR-0007](0007-german-ui-copy-voice.md) (German copy voice),
  [ADR-0008](0008-lobby-qr-invite.md) (lobby QR invite),
  [ADR-0018](0018-floating-notification-layer.md) (the error slot a rejected
  greeting lands in), [ADR-0020](0020-browser-visual-regression-seam.md) (the
  matrix whose entry helper this changes)

## Context

The home screen rendered both intents as two side-by-side panels — `Raum
erstellen` and `Raum beitreten` — each with its own name field, plus a skin
panel. Two forms about two different intents competed for one screen, and the
first thing a newcomer had to do was work out which half applied to them.

The vocabulary was ambiguous too. `GLOSSARY.md` defined **Lobby** as the
pre-round phase _inside_ a room, and the entry screen had no name at all, so
[#166](https://github.com/thom404/wortschatz/issues/166)'s "separate the Views
for the lobby, one for game creation, and one for game joining" named neither
the phase nor the screens precisely.

## Decision

1. **Three entry screens, one job each.** **Home** is the landing: the app name,
   the tagline, exactly two actions (`Raum erstellen`, `Raum beitreten`) and the
   skin switcher — no form. **Create screen** holds the name field and creates.
   **Join screen** holds the room code and name and joins.
2. **In-memory screens, not URLs.** No router appears. Create and Join are app
   state, rendered by the same shell that renders every other screen.
3. **History, not routes.** Entering Create or Join pushes one history entry, so
   Back returns to Home and Forward returns to the screen. `popstate` renders
   the screen its entry names and stays ignored while a room connection is live.
   The address bar keeps its existing rule: it claims `/r/<code>` only once a
   snapshot has named the room.
4. **A deep link lands on Join.** `/r/<code>` renders the Join screen directly,
   with the code pre-filled and read-only and the invite note
   `Du wurdest in Raum <code> eingeladen.` It does not push a history entry, so
   Back still leaves the app rather than bouncing to a form.
5. **Rejections keep their screen.** A rejected greeting returns to the screen
   the attempt was made from, with the typed values intact and the German copy
   in the floating error slot (ADR-0018). Local validation copy is unchanged
   (`Bitte gib einen Namen ein.`, `Bitte gib einen Raumcode ein.`).
6. **The wait room gains an obvious exit.** The in-room pre-round screen keeps
   its content and becomes the **Wait room**; its bottom control reads
   `Raum verlassen` and sends `leave`, the same action as on the game and
   intermission screens, instead of `Zurück zur Startseite`.
7. **Vocabulary.** `GLOSSARY.md` gains **Home**, **Create screen**, **Join
   screen** and **Wait room**. **Lobby** keeps its phase meaning and names the
   Wait room as its screen, so "the lobby" can no longer mean the entry.

## Rejected alternatives

- **Tabs or a stepper inside one screen.** Rejected — the point was to stop two
  intents competing for one screen; tabs keep both on the screen and add a
  second interaction model beside the two forms.
- **A route per screen (`/create`, `/join`).** Rejected — nobody deep-links a
  create screen, and the only deep link with a product meaning is a room, which
  already has its URL. A router would add a surface and a browser-history
  contract for no user-facing gain.
- **Auto-reclaiming a stored session on Home.** Rejected — silently re-entering
  an old room is worse than one deliberate click, and it would make Home do
  something other than route.
- **Icon-only Create/Join actions.** Rejected — they are the app's primary
  actions (ADR-0022).

## Consequences

- Joining without a deep link costs one extra click, in exchange for a landing
  that says what the app is before it says anything else.
- Every wire scenario in the visual suite is entered through `enterRoom()` in
  `e2e/support.ts`, so the new entry path is encoded in exactly one helper — and
  all 46 in-room baselines depend on it.
- The create and join screens become canonical matrix rows: +12 PNGs and +2 ARIA
  snapshots at the current three viewports.
- Home is the only screen carrying the skin switcher, which is unchanged.
