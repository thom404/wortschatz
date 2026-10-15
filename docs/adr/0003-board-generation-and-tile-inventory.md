# ADR-0003: Board generation, tile inventory & solvability

- Status: Accepted
- Date: 2026-10-15
- Ticket: [#7](https://github.com/thom404/wordament-clone-german/issues/7) (board
  generation, tile inventory & solvability)
- Research: [`docs/research/wordament-rules.md`](../research/wordament-rules.md)
  (issue #3), [`docs/research/german-word-list.md`](../research/german-word-list.md)
  (issue #2)
- Dictionary: [ADR-0001](0001-word-list-source-and-packaging.md)

## Context

The server generates a fresh 4×4 multi-letter board at every round start
(server-authoritative, ADR/issue #13): the tile inventory, the draw algorithm, the
"good enough" gate and the seeding scheme were all open. The word list is fixed
(ADR-0001: `enz/german-wordlist`, DAWG, `findWords` enumerates valid words). The
original Wordament's tile bag and letter frequencies are not publicly documented
(#3), so the inventory is a design decision, not a reproduction.

Empirical basis (measured against the pinned list, 676,142 unique lowercase NFC
types): letter containment runs from `e 92% · r 65% · n 64% · s 62% · t 60% …`
down to runts `y 1.8% · ß 1.8% · x 1.2% · j 1.2% · q 0.7%`; top digrams
`er 40% · en 37% · te 29% · ch 25% · st 21% · sch 14% · ei 13% · qu 0.66%`.
A draft bag built by strict sqrt-frequency proportions scored **median 39 words**
per simulated board (vowel mass only ~22%) — playable, thin. A rebalanced bag
vastly improved it (**median 56**, verified by 200-board simulation against the
real list, pruned DFS cross-checked against brute force).

## Decision

1. **Ownership.** #7 owns the tile inventory (without scoring values), generation
   (fresh board every round), the solvability gate, the seed, word-on-board
   _formation checking_, and the enumerated word list. Per-letter point values,
   length multipliers and the end-of-round reveal belong to #6; tile rendering
   belongs to #8.
2. **Canonical tile form.** Tiles are lowercase NFC strings; notation is
   `st`-style digrams as plain concatenation, either/or as `a/e`, prefixes as
   `un-`, suffixes as `-ung` (the eqrion-solver convention from #3). Display is
   independent of data (ADR-0002). Length counts letters, not tiles: a `sch`
   tile contributes three.
3. **Alphabet.** Full standard German: 26 letters plus `ä ö ü ß`. The single
   tile `q` does not exist — `q` is only produced by the `qu` digram. Runts
   (`x j y`) get exactly one tile each.
4. **Tile bag.** One committed `TILE_BAG` constant (tile → count), frequency
   data used as _structure only_, hand-rebalanced for playability. **96 tiles,
   30/96 (31.25%) vowel mass:**

   | Tiles            | Counts                                           |
   | ---------------- | ------------------------------------------------ |
   | Singles — vowels | `e×10 a×6 i×6 o×4 u×4` (+ `ä×2 ö×1 ü×1`)         |
   | Singles — core   | `t r n ×4 · s×3 · d×2 · h×2 l×3 g×2 c×2 m×2 b×2` |
   | Singles — rest   | `f p k w v z ×1 · x j y ×1 · ß×2`                |
   | Multi (21)       | `er×3 en×3 te×3 ch×2 sch×3 st×3 ei×2 qu×2`       |

5. **Draw model.** Scrabble-style: 16 tiles drawn without replacement from a
   shuffled copy of the bag (i.i.d. per-cell assignment rejected: unbounded
   duplicates; Boggle-style letter cubes rejected: curation cost without
   measured gain).
6. **Special-tile types — all four, Germanized** (per #3's confirmed mechanics):
   digram (`st`), either/or (`a/e` — counts as either letter, word valid if
   _either variant_ is on the list), prefix (`an-`/`un-`/`ge-`/`ab-`, word-start
   only), suffix (`-ung`/`-en`/`-er`/`-s`, word-end only). Per-board
   composition: 0–1 either/or (weighted to usually appear; pair menu
   `e/ä i/e a/e o/u`), 0–2 prefixes, 0–2 suffixes, digrams fill the ~5
   special/multi slots; never two adjacent multi-letter tiles.
7. **Solvability gate.** Rejection loop: draw → enumerate via the DAWG →
   reject until the board passes **≥ 40 distinct words**, **≥ 14 words of ≥ 5
   letters**, **≥ 2 words of ≥ 7 letters**. Cap ~200 attempts; fallback ranks
   boards by ≥5-letter word count, tiebreak total words. (≥7 ≥ 2 is a deliberate
   raise over the simulation's fragile p25 of 1; costs ~25–30% extra 0.7 ms
   draws. No other dead-board heuristics.)
8. **Surface rule.** A submitted word is accepted only if it is on the list
   _and formable on the live board_; `isFormable` lives in the #7 board module
   (the mirror of enumeration) and is consumed by the submit pipeline.
9. **Retention.** The enumerated distinct-word list is stored in the round's
   in-memory state at generation; the reveal reuses it (one enumeration per
   round, no drift between generation and reveal).
10. **Seeding.** One 64-bit seed from `crypto` randomness per room per round,
    stored in room in-memory state and logged at board creation; never derived
    from room code/round number, never persisted. All players get the same
    board by server broadcast, not by seed sharing. RNG is injectable; tests use
    golden boards.
11. **Module placement.** `packages/shared/src/tiles.ts`: notation predicates,
    `tileLetters(t) → string[]`, curated menus, `TILE_BAG`. Server-only
    `boardgen` module on the server side: bag, seeded RNG, generator and gate.
    The browser never builds a board.
12. **Budget.** Enumeration ≤ ~10 ms per board (measured: median 0.72 ms);
    generation runs synchronously at round start, no prefetch.

## Consequences

- Every released board is playable: ≥ 40 words, ≥ 14 medium words, ≥ 2 long
  words — and both the bag and the gate numbers are simulation-backed, not
  guessed.
- Fidelity to the original within confirmed mechanics only: no letter point
  tables reproduced (that was never achievable); scoring stays a #6 decision on
  a #7-shaped Tile model.
- The 96-tile bag is committed as one constant — tuning is a data-table edit
  plus one verification simulation, not an algorithm change.
- The gate's thresholds are sharp enough that the fallback path (best-of-200)
  should be rare; if it ever fires on real data, the bag has drifted and the
  simulation script should be re-run.
- **Feasibility cap discovered at implementation:** with 8-way adjacency the
  4×4 king graph hosts at most **4** mutually non-adjacent multi-letter tiles,
  so the "~5 special/multi slots" resolve to at most 4 on any real board.
  Drawn multi-tiles beyond the cap are traded back to singles from the unused
  bag tail (preserving the draw's letter distribution), and the composition
  always budgets specials into the remaining slots.
- `q`-only-words are impossible except via `qu`, matching German orthography.

## Suppressed alternatives

- **Strict sqrt-frequency bag** (draft): rejected — median 39 words/board,
  vowel-poor and thin.
- **i.i.d. weighted draws** per cell: rejected — unbounded letter duplication
  skews the letter distribution.
- **Boggle-style letter cubes**: rejected — high curation cost, no measured
  benefit over the bag.
- **Drop runts (`x j y`) and/or `ß` from the bag entirely**: rejected — shrinks
  the word space for marginal board prettiness.
- **Extra dead-board heuristics** (distinct starting letters, vowel grids):
  rejected — the threshold gate alone captures board quality.
- **Thresholds at p10 or "no thresholds"**: rejected — p25 balances measured
  quality against rejection-rate cost; unthrottled boards could be trivial.
- **Seed derivation from room code / persisted seeds**: rejected — rooms are
  memory-only (#4/#13), and same-room fairness comes from broadcast, not seed
  reuse.
