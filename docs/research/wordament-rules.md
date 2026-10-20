# Research: Original Wordament rules, tiles & scoring

Ticket: issue #3 (`wayfinder:research`). Purpose: pin down the mechanics of the
**original** Microsoft Wordament so we can decide what a German clone should
reproduce. Every claim below is tagged with a confidence level and a source.

Legend: **Confirmed** = stated identically by two or more independent sources,
including at least one primary/official one. **Likely** = one credible source
or several weak ones. **Unconfirmed** = no trustworthy source found.

## Summary

| Mechanic                       | Finding                                                 | Confidence                                     |
| ------------------------------ | ------------------------------------------------------- | ---------------------------------------------- |
| Board                          | 4×4 grid, 16 tiles                                      | Confirmed                                      |
| Round length                   | 2 minutes                                               | Confirmed                                      |
| Simultaneous play              | All players share one board, real time                  | Confirmed                                      |
| Adjacency                      | 8-directional (orthogonal + diagonal)                   | Confirmed                                      |
| Tile reuse                     | A tile may be used once per word                        | Confirmed                                      |
| Min word length                | 3 letters                                               | Confirmed                                      |
| Word validity                  | No abbreviations, no proper nouns                       | Confirmed                                      |
| Special tiles                  | Digrams, Either/Or, Prefix, Suffix                      | Confirmed                                      |
| Letter point values            | Range 1–10, assigned per letter                         | Confirmed (range); value table **Unconfirmed** |
| Word score formula             | Sum of letter values; exact multipliers **Unconfirmed** | Unconfirmed                                    |
| Tile bag / letter distribution | Not documented                                          | Unconfirmed                                    |
| "Found all words" bonus        | Not documented                                          | Unconfirmed                                    |

## Board, tiles and timing

- Board is **16 tiles arranged 4×4**. Each tile is a single letter (e.g. `A`)
  or a multi-letter tile (e.g. `Qu`). Each letter has a point value from
  **1 to 10**.
  - Source (official game description, reproduced verbatim by several portals):
    [kingofgames.net](https://kingofgames.net/game/microsoft-wordament),
    [dordle.io](https://dordle.io/microsoft-wordament),
    [toogame.com](https://microsoft-wordament.toogame.com/),
    [allfavoritegames.com](https://allfavoritegames.com/play/microsoft-wordament).
  - Corroborated: [Microsoft Casual Games](https://www.microsoftcasualgames.com/wordament)
    ("24-7 tournament", "players compete on the same board with everyone at once").
- A round lasts **two minutes**; the highest score when the timer expires wins.
  - Sources: [archived scrabblewordfinders.net (2013)](https://web.archive.org/web/20131113183310/http://scrabblewordfinders.net/wordament/)
    (cited by Wikipedia); [brilliantwords.com](https://brilliantwords.com/wordament-solver)
    ("compete globally on the same board ... within a two-minute window").
- The game is a real-time tournament: **everyone plays the same board at the
  same time** and is rank-ordered by score.
  - Sources: archived scrabblewordfinders.net; Microsoft Casual Games; Wikipedia
    ([Microsoft Ultimate Word Games](https://en.wikipedia.org/wiki/Microsoft_Ultimate_Word_Games)).

## Building words

- A word is any **connected sequence of tiles**; the next tile may be
  **above, below, left, right, or diagonal** to the previous one (8 directions).
  - Sources: [Wikipedia](https://en.wikipedia.org/wiki/Microsoft_Ultimate_Word_Games)
    ("adjacent or diagonal"); [trueachievements.com walkthrough](https://www.trueachievements.com/game/Microsoft-Ultimate-Word-Games/walkthrough/2)
    ("below it, above it, to the side of it, or diagonal from it").
- **Minimum length 3 letters**; abbreviations and proper nouns are not allowed.
  - Sources: Wikipedia; trueachievements.com.
- **Each tile may be used only once per word.**
  - Sources: Wikipedia; trueachievements.com; kingofgames.net.

## Special tiles (Confirmed)

Confirmed by [Wikipedia](https://en.wikipedia.org/wiki/Microsoft_Ultimate_Word_Games),
[trueachievements.com](https://www.trueachievements.com/game/Microsoft-Ultimate-Word-Games/walkthrough/2),
and the [eqrion/wordament solver](https://github.com/eqrion/wordament) source.

- **Digram** — a tile carrying two consecutive letters (e.g. `AT`). Both letters
  are used; the tile contributes both letters to the word length and score.
  (Example: `AT` + `B` → `BAT`.)
- **Either/Or** — two letters separated by a slash (e.g. `A/E`). The tile counts
  as _either_ letter; the word is checked both ways and scores if either is valid.
- **Prefix** — marked by a trailing hyphen (e.g. `UN-`). May only be used at the
  **start** of a word.
- **Suffix** — marked by a leading hyphen (e.g. `-ING`). May only be used at the
  **end** of a word.

Note on notation: Wikipedia describes the hyphen position by where the dash
sits relative to the letters; some solver input formats describe it by word
position. The word-position rule (prefix→word start, suffix→word end) is what
matters. The eqrion solver's `Tile::parse` confirms the encoding: a leading `-`
is a prefix, a trailing `-` is a suffix, `/` is either/or, anything else is a
normal or multi-letter tile.

## Scoring — CONFLICTING, NOT RESOLVED

There is **no authoritative source** for the exact scoring formula, and the
available sources disagree. Recorded here so we can make a deliberate choice.

1. **"Sum of Scrabble letter values" model.**
   [brilliantwords.com](https://brilliantwords.com/wordament-solver) says words
   "are scored by summing up the values of each constituent letter" using
   "standard Scrabble point rules" (C=3, A=1, T=1 → CAT=5), with "special
   multiplier tiles ... present in some game rounds". Its own worked example is
   plain summation. This is consistent with the official "point value 1–10"
   description (Scrabble Q/Z = 10).

2. **Length-multiplier model (unreliable).**
   The archived [scrabblewordfinders.net (2013)](https://web.archive.org/web/20131113183310/http://scrabblewordfinders.net/wordament/)
   page (the source Wikipedia's article cites) claims:
   - letter values **1–12** (E=1, I=1, A=2, O=2, U=5, W=6, Z=8, Q=10);
   - double-letter tiles `Ed`, `Er`, `Qu`, `Ra`; triple-letter tile `MIS` = 12;
   - either/or tile `I/V` = 20 points;
   - **length multipliers: 4–5 letters ×1.5, 6–7 letters ×2, 8+ letters ×3.**
     This page contradicts the official "1–10" range and the Scrabble-values
     model, and reads like low-quality affiliate content. Treat as unreliable.

3. **Custom solver table (not authoritative).**
   The eqrion solver hard-codes its own scheme with no length multiplier:
   `a,e,s=1; i,o,u=2; b,c,d,f,g,h,l,m,n,t=3; j,k,r=4; p,q,v,w=5; x,y,z=6`.
   This is an approximation by the author, not a spec.

4. **Observed data points do not fit any model.**
   [wilsonjord](https://wilsonjord.github.io/blog/wordament-solver) quotes two
   real in-game scores: `precesses` = **45** points and `asperses` = **40**
   points. Neither equals the plain Scrabble sum (`precesses`=13, `asperses`=10),
   the eqrion table (`precesses`=18, `asperses`=15), nor the archived ×3 length
   multiplier applied to either (`39` / `30`). The numbers in that blog are
   presented humorously and may be approximate.

**Conclusion:** the letter-value table and whether/how word length affects score
are **Unconfirmed**. The safest reading is that Wordament sums per-letter values
in the 1–10 range, but the exact table and any length bonus must be treated as a
design decision for our clone, not as reproduced fact.

## Unconfirmed / not found

- **Tile bag composition and per-letter frequency** (how many of each letter the
  generator draws, and the digraph set with frequencies). Not publicly
  documented; the game does not expose its bag. The eqrion solver had to supply
  its own external dictionary and does not model a bag.
- **Exact letter→point table.**
- **Exact special/multiplier tile effects** on total word score (e.g. what a
  double-letter or triple-word tile does, if such tiles exist beyond the
  multi-letter tiles).
- **End-of-round behaviour**: whether the full word list is revealed, and whether
  there is a "found all words" bonus.
- **Dictionary used** by the original game (affects which words are valid).

## Implications for a German clone (decisions to make)

1. Pick a scoring model explicitly. Recommended default: per-letter values
   (German Scrabble table is a reasonable, well-documented basis) summed, with
   **no** length multiplier, unless we decide to add one.
2. Decide whether to include 4 special-tile types or a subset.
3. Decide the tile bag / letter-frequency table for German digraphs and letters
   (`Ä`, `Ö`, `Ü`, `ß`, and digraphs like `CH`, `SCH`).
4. Decide round length (2 minutes matches the original) and whether rounds are
   globally synchronised or per-player.

## Sources

- Microsoft official game description (via portals): kingofgames.net,
  dordle.io, toogame.com, allfavoritegames.com.
- Microsoft Casual Games — <https://www.microsoftcasualgames.com/wordament>.
- Wikipedia — <https://en.wikipedia.org/wiki/Microsoft_Ultimate_Word_Games>.
- TrueAchievements walkthrough —
  <https://www.trueachievements.com/game/Microsoft-Ultimate-Word-Games/walkthrough/2>.
- Archived Scrabble Word Finders (2013) —
  <https://web.archive.org/web/20131113183310/http://scrabblewordfinders.net/wordament/>
  (reliability low).
- Brilliant Words solver — <https://brilliantwords.com/wordament-solver>.
- Jordan Wilson, "A Wordament Solver" —
  <https://wilsonjord.github.io/blog/wordament-solver>.
- eqrion/wordament (Rust solver, incl. special-tile parsing) —
  <https://github.com/eqrion/wordament>.

## 2026-10-20 update (#148): board composition and coverage

Revisited while implementing **board variety**, **one special tile** and
**per-cell coverage** (issue #148, ADR-0003 amendment). This update does not
change the scoring findings above; it records what the sources say about how
boards are built and what makes a tile usable.

| Finding                                                                            | Confidence  | Basis                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boards are generated from a pool, checked against a rule set, rejected or deployed | Confirmed   | Patent US 2013/0260887 A1 claims 1, 10 and 17–20; 2012 Q&A ("made by machine … about 25 rules")                                                             |
| The pool is weighted by letter/digram frequency                                    | Likely      | Patent FIG. 11 lists letters/digrams with commonness scores and frequencies; the claims describe a pool, not the weights                                    |
| A candidate carries one polygram (special) tile                                    | Confirmed   | 2012 Microsoft Devices Blog ("special rounds, where one tile will have two letters upon it"); 2012 Q&A ("digram puzzles with the special two-letter tiles") |
| Every tile must be usable in at least three words                                  | Confirmed   | 2012 Q&A ("every board must use every tile at least 3 times"); patent claim 12 ("at least three words")                                                     |
| No two polygram tiles may be adjacent, and Q–U have a fixed relationship           | Likely      | Patent describes both as example intra-game rules, not as universal claims                                                                                  |
| There is a published duplicate-letter cap                                          | Unconfirmed | No rule found in the developer blog, the 2012 Q&A, the 2014 developer story or the patent                                                                   |
| Official boards peak at three copies of a common letter                            | Likely      | Five official boards inspected for #148: 3× E / 3× S; duplicates only common letters, never Q, Z, J or X                                                    |
| Every special board carries exactly one special tile                               | Confirmed   | Same 2012 Devices Blog and Q&A statements; our five-board sample agrees                                                                                     |

### What the sources actually say

- **Generation and deployment.** The patent describes loading a candidate
  interface from a pool, comparing it with an **intra-game rule set**, rejecting
  violations, and deploying an approved interface over the network (claims 1,
  10, 17 and 20). This is the same draw → reject → deploy loop our generator
  uses; the 2012 Q&A confirms the real game works that way ("they're made by
  machine with a heavy duty set of rules — about 25 at this point. This is all
  patented").
- **Weighted pool.** The patent's FIG. 11 is a list of letters and digrams with
  an example commonness score and frequency; the claims talk about removing
  game-objects from a pool. Treat the _weighted_ pool as Likely rather than
  Confirmed: the sources show frequencies exist, not that the shipped draw uses
  them directly.
- **One special.** The 2012 Microsoft Devices Blog describes special rounds as
  having "one tile … with two letters upon it"; the Q&A describes digram puzzles
  with "the special two-letter tiles". That supports one special tile per board;
  it does not publish the menu or the type weights.
- **Coverage.** The Q&A is explicit: "With the exception of our themed boards,
  every board must use every tile at least 3 times." The patent generalises it to
  a threshold of at least three words per letter (claim 12). The same Q&A also
  guarantees "over 100 common words" per board, which is why our own gate keeps
  its word-count floors.
- **Duplicates.** No source states a duplicate-letter cap. The five official
  boards inspected for #148 peak at three copies of a common letter (3× E, 3× S),
  duplicate only common letters and never Q, Z, J or X. That is an observation
  from a small sample, not a published rule — hence Likely/Unconfirmed above.
  Our three-copy cap is aligned with it; our "no adjacent identical tiles" rule
  is deliberately stricter.
- **Adjacency examples.** The patent lists a polygram-adjacency rule and a Q–U
  positional rule among the examples. They are illustrative, so we record them
  as Likely; our generator keeps its own no-adjacent-polygrams invariant but,
  with one special per board, it is no longer load-bearing.

### Sources added

- Windows Experience Blog, "Q&A: The minds behind Wordament" (2012-03-05) —
  <https://blogs.windows.com/windowsexperience/2012/03/05/qa-the-minds-behind-wordament/>.
- Windows Experience Blog, "Sidebar: 5 tips for boosting your Wordament score"
  (2012-03-05) — <https://blogs.windows.com/windowsexperience/2012/03/05/sidebar-5-tips-for-boosting-your-wordament-score/>
  ("all the tiles on the board are playable at least once").
- Microsoft Devices Blog, "Challenge your mind and the world with Wordament"
  (2012-08-20) — <https://blogs.windows.com/devices/2012/08/20/challenge-your-mind-and-the-world-with-wordament/>
  (one two-letter tile in special rounds).
- Windows Developer Blog, "Wordament: The developer story …" (2014-08-14) —
  <https://blogs.windows.com/windowsdeveloper/2014/08/14/wordament-the-developer-story-of-one-of-windows-most-original-and-compelling-hit-games/>.
- Patent application US 2013/0260887 A1, "Rule set for creating word-puzzles"
  (published 2013-10-03) —
  <https://patents.google.com/patent/US20130260887A1/en> (claims 1, 10, 12, 14,
  17–20; FIG. 11).
