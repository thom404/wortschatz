# Word-list curation

The game accepts strict membership in the vendored `enz/german-wordlist`
([ADR-0001](adr/0001-word-list-source-and-packaging.md)). That list is a
Scrabble-style game list, not a lexicographic authority, so a small number of
foreign-language forms, proper nouns/toponyms and abbreviations slip through.
The **Exclusion list** removes known-invalid entries without replacing the
source and without over-pruning real German vocabulary.

## Policy

Exclude:

- non-German-language forms (`Bébé`, `Pokémon`, `Šeqel`);
- proper nouns, toponyms and surnames (`Nouméa`, `Bingen`, `Schulte`);
- abbreviations (`Pkw`, `IBAN`, `CMOS`).

Keep:

- German loanwords that Duden accepts (`Café`, `Cliché`, `Coupé`);
- real umlauts and `ß`, with no `ae/oe/ue/ss` aliasing;
- dated, regional and archaic forms, and rare inflections — these are out of
  scope for this curation pass.

A human (maintainer/native speaker) adjudicates every entry. The audit only
proposes candidates; it never auto-excludes by heuristic.

## Reviewed batches

- **First batch (#107).** The mechanism plus the clear-cut entries: obvious
  proper nouns/toponyms/surnames, brands, abbreviations and foreign forms.
- **Second batch (#114).** The borderline tail. Each of the four audit groups
  was adjudicated against the policy: every flagged candidate was either
  excluded (the lines under the `Second reviewed batch (#114)` heading in
  `packages/server/word-exclusions.txt`) or deliberately retained. The diff is
  the review artefact, and `word-list-curation.test.ts` pins the decisions
  end-to-end against the real list.

A flag is not a verdict, and the second batch records that explicitly:

- The upstream blacklist also contains valid German imperatives and inflected
  forms (`Grins`, `Hänsel`, `Kant`, `Brecht`, `Aalst`, `Beate`, `Jauch`), so
  blacklist membership alone never justifies removal.
- The abbreviation-pattern group is dominated by ordinary short nouns
  (`Akt`, `Bär`, `Uhr`, `Zug`), not abbreviations.
- The inner-uppercase group also contains German common nouns
  (`Latex`, `Intercity`, `MacGuffin`).
- Non-German codepoints are a review flag, not a rule: Duden loanwords such as
  `Café`, `Cliché`, `Coupé`, `Rosé`, `Soufflé`, `Matinée`, `Varieté`,
  `Soirée`, `Gulyás`, `Csárdás`, `Négritude`, `Omertà`, `Pietà`, `Podestà`
  and `Shōgun` stay accepted. Only forms that are languages, peoples, places or
  plain English tokens were removed.

## Asset

`packages/server/word-exclusions.txt` is the committed Exclusion list:

- one entry per line, NFC-normalized and lowercase (the list's canonical form);
- blank lines and lines starting with `#` are ignored;
- entries are deduped and validated when read;
- every entry must be present in `words`, otherwise the build and the dev
  fallback fail loudly.

Subtraction happens in `rawLinesToWords` (`packages/server/src/dictionary/index.ts`),
the single ingestion seam shared by the DAWG build, `createDictionary` and the
dev fallback loader. The raw list and its checksum are untouched.

## Audit

Build first, then run the audit:

```sh
npm run build
npm run audit-words
# or: node --experimental-strip-types packages/server/scripts/audit-word-list.ts
```

The audit is deterministic and offline. It reads the vendored list, the
Exclusion list and the vendored upstream `enz` `blacklist`
(`packages/server/data/enz-blacklist`, SHA-256
`7feaaed9b39473f01de967caf2da7e3f5cf34a2dad49fb6a5d5b6840d51acf68`).
Full-list runs are ad hoc, like `board-sim`, and stay out of the default
`vitest` run. Re-running produces the same grouped report, so reports can be
diffed.

Groups, in report order:

1. **upstream-blacklist** — normalized entries present in upstream's own
   blacklist. This is the strongest seed because upstream already rejected them.
2. **non-german-codepoints** — entries containing anything outside
   `a-zäöüß`. This is a review flag, not a rule: `Café` and `Cliché` must stay.
3. **abbreviation-patterns** — a leading uppercase pair (upstream's
   `verify.sh` rule) or a capitalised token of at most three letters
   (e.g. `Pkw`, `Dax`, `Ufo`).
4. **input-anomalies** — inner uppercase (e.g. `JavaScript`) and raw-list
   ordering violations under German collation, mirroring the remaining
   upstream `verify.sh` invariants.

## Reviewing a candidate

1. Run the audit.
2. Decide each candidate against the policy above. Unsure cases stay accepted
   for a later pass; lean on Duden for loanwords.
3. Add the normalized entry to `packages/server/word-exclusions.txt` under the
   matching comment heading.
4. Re-run the audit and `npm test`. A stale or mistyped entry makes the run
   fail instead of lingering silently.
