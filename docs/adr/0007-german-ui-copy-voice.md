# ADR-0007: German UI copy voice

- Status: Accepted
- Date: 2026-10-17
- Ticket: [#52](https://github.com/thom404/wortschatz/issues/52) (record the
  German UI copy voice), spec
  [#50](https://github.com/thom404/wortschatz/issues/50) (rewrite German UI copy
  to a human voice)
- Guide: [`docs/ux-copy.md`](../ux-copy.md)

> Numbering note: the ticket named this decision ADR-0006, but that number is
> already used by [ADR-0006](0006-autonomous-issue-agent.md) (autonomous issue
> agent). This decision therefore takes the next free number, ADR-0007.

## Context

Every user-facing string is hardcoded German inline in the client — there is no
i18n layer, and this decision does not add one. The first pass at the copy read
as machine-translated German: a marketing tagline carrying the anglicism
_real-time_ (`Gemeinsam deutsche Wörter finden — real-time, privat, ohne
Konto.`), and stiff, bureaucratic terms (`Zwischenspiel`,
`Erscheinungsbild`). The result felt unpolished and slightly untrustworthy,
against the goal of a small, human-made German word game.

There was no recorded voice, so every new string risked re-introducing the same
drift. The domain vocabulary in `GLOSSARY.md` is precise for code and docs, but
it is deliberately **not** binding on UI copy: the glossary term is sometimes
the unnatural word for the screen (`Zwischenspiel`), while the natural word is
what a player expects (`Pause`).

Spec #50 settled the voice and performed the copy pass. This ADR records that
decision so future strings stay consistent.

## Decision

1. **Voice.** Informal _du_; warm but dry and understated; no exclamation
   marks; no marketing taglines; no em-dash taglines, though an em-dash may
   still separate a `document.title` (`Wortschatz — Pause`).
2. **Anglicism-free, with one deliberate exception: _Skin_.** _Skin_ is the one
   sanctioned anglicism, because it is the common app word for a visual theme.
3. **Natural German over glossary vocabulary.** UI copy prefers the natural
   German word even when it differs from a `GLOSSARY.md` term, keeping a
   glossary term only where it is already the natural word (`Raum`, `Runde`,
   `Punkte`, `Gastgeber`, `Zuschauer`).
4. **The preferred/avoided terms live in
   [`docs/ux-copy.md`](../ux-copy.md)** — `Name` not `Spitzname`, `Pause` not
   `Zwischenspiel`, `Spielfeld` not `Spielbrett`, `Deine Wörter` not
   `Deine Funde`, `Skin` not `Erscheinungsbild`/`Farbwelt`, `Wische` not
   `Ziehe` — together with the voice rules and worked examples.
5. **The German-only, inline-string policy is unchanged.** No i18n layer, no
   translation files, no copy-catalog abstraction.

## Consequences

- Future UI strings have one reference for both the voice and the word choices,
  so copy does not drift back toward translated-product German.
- UI copy and `GLOSSARY.md` now deliberately diverge: the glossary keeps the
  precise domain term (`Zwischenspiel` is defined there as the game concept)
  while the screen shows the natural word (`Pause`). Both readers are served.
- The policy stays a copy pass, not an infrastructure project; i18n and a copy
  catalog remain a separate, explicitly tracked concern.
- Because the strings are inline, consistency still depends on authors reading
  this guide; the guide and this ADR are linked from `AGENTS.md` so they are
  found.

## Suppressed alternatives

- **Bind UI copy to `GLOSSARY.md`.** Rejected: glossary terms are precise but
  sometimes stiff on screen (`Zwischenspiel`, `Erscheinungsbild`, `Spielbrett`);
  the glossary is for code and docs, not players.
- **Introduce an i18n layer or copy catalog now.** Rejected as out of scope:
  the app is German-only and the strings stay inline; a catalog would be a
  separate decision.
- **Keep `Erscheinungsbild` and ban every anglicism.** Rejected: `Skin` is
  already the common app word, so it is the one deliberate exception.
- **Keep the `real-time … privat, ohne Konto.` tagline.** Rejected: it is a
  marketing fragment with an anglicism; the home screen describes the game
  instead (`Ein Mehrspieler-Wörterspiel.`).
