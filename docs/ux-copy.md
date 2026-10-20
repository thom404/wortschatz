# German UI copy guide

The app is German-only and every user-facing string is hardcoded inline in the
client — there is no i18n layer. This guide records the voice agreed in
[#50](https://github.com/thom404/wortschatz/issues/50) and the words that voice
prefers, so the copy slices and all future strings share one reference. The
decision itself is [ADR-0007](adr/0007-german-ui-copy-voice.md).

It governs **user-facing copy only**. Code, tests, docs and tickets keep using
the vocabulary in [`GLOSSARY.md`](../GLOSSARY.md).

## Voice

- **Informal _du_.** Address the player as _du_ and conjugate accordingly
  (`Du schaust zu.`, `Deine Wörter`). Never _Sie_.
- **Warm but dry and understated.** The game has a little personality; it does
  not perform enthusiasm.
- **No exclamation marks.**
- **No marketing taglines.** Describe the game; do not sell it.
- **No em-dash taglines.** An em-dash may still separate a `document.title`
  (`Wortschatz — Pause`).
- **Anglicism-free, with one deliberate exception: _Skin_.**
- **Natural German over glossary vocabulary.** UI copy is not bound by
  `GLOSSARY.md`; keep a glossary term only where it is already the natural word
  (`Raum`, `Runde`, `Punkte`, `Gastgeber`, `Zuschauer`).
- **Errors are normal requests.** Phrase validation messages the way a person
  would (`Bitte gib einen Namen ein.`), not as robotic status codes.
- **In-jokes, sparingly.** Example names are allowed to be small deliberate
  Easter eggs, and nothing else is.

## Preferred and avoided terms

| Prefer         | Avoid                          | Why                                                        |
| -------------- | ------------------------------ | ---------------------------------------------------------- |
| `Name`         | `Spitzname`                    | People say _Name_.                                         |
| `Pause`        | `Zwischenspiel`                | The word people actually use for the break.                |
| `Spielfeld`    | `Spielbrett`                   | Natural German for the board.                              |
| `Deine Wörter` | `Deine Funde`                  | Plain label for the words a player found.                  |
| `Wische`       | `Ziehe`                        | The interaction reads as a swipe on a touch device.        |
| `Skin`         | `Erscheinungsbild`, `Farbwelt` | The one deliberate anglicism; the common word for a theme. |

`Skin` is the single sanctioned anglicism in the whole UI.

## Worked examples

The binding strings from the #50 copy pass, as a sample of the voice:

| String                    | Copy                                                     |
| ------------------------- | -------------------------------------------------------- |
| Home tagline              | `Ein Mehrspieler-Wörterspiel.`                           |
| Create button             | `Raum erstellen`                                         |
| Player count              | `N von 8 verbunden`                                      |
| Trace hint                | `Wische über die Felder, um ein Wort zu bilden.`         |
| Spectator note            | `Du schaust zu. Ab der nächsten Runde bist du dabei.`    |
| Intermission scoring note | `Es zählt das Gesamtergebnis der Sitzung.`               |
| Pause hint                | `Der Gastgeber startet die nächste Runde.`               |
| Duplicate-word error      | `Das Wort hast du schon.`                                |
| Taken-name error          | `Dieser Name ist bereits vergeben. Wähle einen anderen.` |

## Related

- [ADR-0007 — German UI copy voice](adr/0007-german-ui-copy-voice.md)
- [`GLOSSARY.md`](../GLOSSARY.md)
