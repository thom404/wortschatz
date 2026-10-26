# ADR-0027: One position-free special and a submittable either/or reveal

- Status: Accepted
- Date: 2026-10-26
- Ticket: [#225](https://github.com/thom404/wortschatz/issues/225)
- Amends: [ADR-0003](0003-board-generation-and-tile-inventory.md)
- Measurement: [`docs/research/either-or-pair-calibration.md`](../research/either-or-pair-calibration.md)
- Numbering note: the ticket called for ADR-0026, but that number is already
  the connection-core decision ([ADR-0026](0026-connection-core-beside-adapters.md));
  this is the next free number.

## Context

Every board carries exactly one special tile. Prefix and suffix tiles force the
word to start or end on that cell, so a board that draws one loses findable
words and the generator rejects more candidates before it finds an acceptable
board. On either/or boards the reveal lists both spellings of the tile, but the
client's drag has always submitted the first spelling only. Any revealed word
that needs the second spelling is unreachable — measured at **18.1 %** of the
revealed words on those boards. The pause therefore promises words the game
refuses.

The old either/or menu was four hand-picked vowel pairs. A pair such as `e/a`
unlocks almost no extra word, so the tile decorated a board more than it
changed it. Per-board pair search is affordable for a calibration run (about
1.5 s per board) but not at round start, where a board costs about 10 ms per
candidate reading.

## Decision

1. **One position-free special.** The single special cell is drawn only from
   digrams and either/or tiles. Prefix and suffix tiles leave the draw and their
   notation, positioning checks and menus are deleted, not left dead.
2. **Draw weights.** The freed prefix/suffix share moves to the either/or tile:
   digram **9/15**, either/or **6/15**. Digrams remain the most common special.
3. **Measured pair menu.** `EITHER_OR_MENU` is the top eight pairs from the
   committed calibration, ordered by total added words:
   `r/s, s/t, g/s, n/s, l/s, a/s, b/s, k/s`. It is still the existing either/or
   tile — no new notation, wire type or scoring rule.
4. **Both readings cross the wire.** `submit-word` gains one optional
   `alternate` field. The client sends the reading it sends today (first
   spelling on the path) plus the second spelling of the choice tile, when the
   path crosses one.
5. **Deterministic resolution.** The server normalizes and dedupes both
   readings, keeps the list words that are formable on the board, and accepts
   the best by **points, then length, then alphabetical word**. A path always
   resolves the same way; the client never decides the winner.
6. **Duplicate identity is the resolved word.** Reaching the same accepted word
   by another reading or path is still one find.
7. **Density is measured, not guessed.** The 200-board run records median
   findable words **136** inside `DENSITY_BAND` 100–140 and choice boards at
   48 %, inside `CHOICE_TILE_FREQUENCY` 0.35–0.55. The solvability gate itself
   is unchanged.
8. **Everything else stays.** Board size, round length, gate thresholds, the
   scoring table, reveal grouping, the dictionary and the room lifecycle are
   untouched.

## Consequences

- No board is handicapped by a word-position rule, and the generator has two
  position-free special families to draw from.
- Every revealed word has a path reading the engine can accept; the reveal and
  the game use the same validity rule.
- A choice tile is now worth routing a path through, because its pairs add real
  words rather than only alternative vowels.
- A drag still submits once, with no mid-drag choice: the wire carries both
  readings and the engine picks the best. The returned word may differ from the
  primary spelling, and the client shows the returned word.
- The pair menu can be retuned only by re-running the committed calibration and
  reviewing the density and frequency bands.

## Suppressed alternatives

- **Keep prefix/suffix tiles with a lower weight:** rejected — the position
  rule itself is the handicap, not the frequency.
- **Add a new "choice" tile kind or wire type:** rejected — the either/or tile
  already models two spellings; a second kind would duplicate notation,
  scoring and rendering.
- **Let the client pick the reading with a second tap:** rejected — the round
  has no extra input step and the gesture must stay one drag.
- **Prefer the client's primary reading on ties:** rejected — resolution would
  then depend on the client and two readings of the same path could disagree.
- **Search pairs per board at round start:** rejected — about 1.5 s per board
  against a 15 ms generation budget.
- **Keep the vowel-only menu:** rejected — measured to add ~8 words per board
  versus 82–92 for the chosen pairs.
- **Filter unreachable words out of the reveal instead of sending an
  alternate:** rejected — it would hide words the player can reach with the
  second spelling and would make the reveal narrower than the board.
