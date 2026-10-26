# Either/or pair calibration (#225, ADR-0027)

The either/or tile's pair menu is a committed measurement, not a hand-written
guess. This note records how `EITHER_OR_MENU` was chosen so a future tuning
change can be audited and reproduced.

## Method

`packages/server/scripts/either-or-pair-calibration.ts` reads the real committed
word list (ADR-0001) and the real generator (ADR-0003), then:

1. generates 40 boards from seeds `1 + i·7919` (`i = 0…39`);
2. takes each board's special cell and, for every unordered pair of the
   inventory's single letters except standalone `q`, puts that pair in the cell;
3. enumerates the candidate board through the real DAWG and applies
   `isFormable`, exactly as generation does;
4. counts the words the pair adds over the same board with `e` in the special
   cell, and sums that over the 40 boards.

Pair search costs about 1.5 s per board on the full dictionary, so it cannot
run at game time. The result is measured once, reviewed here, and committed as
the menu constant.

```sh
npx tsc -b packages/shared packages/server
node --experimental-strip-types packages/server/scripts/either-or-pair-calibration.ts 40
```

## Result

Top 15 pairs by total added words (40 boards, 406 candidate pairs):

| Pair  | Added words | Added / board | Words / board | Range  |
| ----- | ----------: | ------------: | ------------: | ------ |
| `r/s` |        3674 |          91.8 |         194.1 | 85–502 |
| `s/t` |        3586 |          89.7 |         192.3 | 77–417 |
| `g/s` |        3492 |          87.3 |         188.4 | 70–408 |
| `n/s` |        3461 |          86.5 |         189.3 | 82–423 |
| `l/s` |        3410 |          85.3 |         187.1 | 72–497 |
| `a/s` |        3352 |          83.8 |         184.8 | 62–385 |
| `b/s` |        3305 |          82.6 |         184.4 | 82–437 |
| `k/s` |        3265 |          81.6 |         183.0 | 79–427 |
| `r/t` |        3262 |          81.5 |         185.3 | 87–412 |
| `g/r` |        3175 |          79.4 |         181.8 | 78–404 |
| `d/s` |        3161 |          79.0 |         180.1 | 71–379 |
| `h/s` |        3155 |          78.9 |         180.3 | 74–393 |
| `n/r` |        3147 |          78.7 |         182.8 | 85–420 |
| `m/s` |        3118 |          78.0 |         179.1 | 71–439 |
| `l/r` |        3097 |          77.4 |         180.6 | 80–493 |

The committed menu is the first eight:

```ts
["r/s", "s/t", "g/s", "n/s", "l/s", "a/s", "b/s", "k/s"];
```

## Density and special mix

Run against the same 200-board sample used by the generation property tests
(`packages/server/scripts/board-sim.ts`, seeds `1 + i·7919`):

- 200/200 boards passed gate, coverage and variety, with 0 fallbacks.
- Median findable words **136** (p25 102, p75 176), inside the recorded band
  `DENSITY_BAND = { minWords: 100, maxWords: 140 }`.
- Median ≥5-letter words **63**, median ≥7-letter words **7**.
- Choice-tile boards **96/200 (48 %)** — inside
  `CHOICE_TILE_FREQUENCY = { min: 0.35, max: 0.55 }`; specials split 104
  digram / 96 either-or, so digrams stay the most common special.
- Median generation time **3.5 ms** (p95 well below the 15 ms budget).

The draw weights are digram 9/15 and either/or 6/15. The former prefix and
suffix share (2/15 each) moved to the either/or tile.
