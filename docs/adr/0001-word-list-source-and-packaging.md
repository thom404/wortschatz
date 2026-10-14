# ADR-0001: German word-list source, packaging and in-memory structure

- Status: Accepted
- Date: 2026-10-14
- Ticket: #10 (Word-list source choice & packaging)
- Research: [`docs/research/german-word-list.md`](../research/german-word-list.md) (issue #2)

## Context

The game validates German words and generates boards, so it needs a free, legally
redistributable German word list, plus a decision on how it is packaged and loaded.
A hard constraint is **zero licence cost** and **no obligation we cannot honour** for
a self-hosted, no-account side project. Deployment facts (#9) fix the shape further:
a single Node process on the homelab, **no persistent volume**, one image behind Traefik.

The research (#2) shortlisted three usable sources:

- **`enz/german-wordlist`** — CC0-1.0, ~686k forms, drop-in UTF-8 one-word-per-line,
  Scrabble-style curation (no proper nouns/toponyms/abbreviations/archaic forms; inflections
  and dated/regional words included), real `ä/ö/ü`, distinct `ß`, capitalised nouns.
- **igerman98 / `hunspell-de-de` / LibreOffice `de_DE_frami`** — GPL-2.0-or-later,
  affix-compressed, best coverage/authority, but the data file carries copyleft.
- **Daniel Naber Morphologie-Lexikon** — CC BY-SA 4.0, full forms + lemma + POS tags
  (metadata we do not need), ~25 MB.

Excluded as not redistributable: Duden, DWDS, dict.cc, LEO/PONS/Wahrig, and the
`germandict` "public domain" claim (derived from GPL + CC BY-SA data).

## Decision

1. **Source & licence.** Adopt **`enz/german-wordlist` (CC0-1.0)** as the sole word
   list. No GPL, no CC BY-SA, no derived/expanded list. Pin commit
   `1071d87d9535b57b80ec076c699f2578a28ee9dc`, file `words`,
   SHA-256 `20095928ca70974fb5d86e44f10181cee16e2831b0d4b1a4ddd12c261aebc5e9`.
2. **Validity semantics.** Case-insensitive (lowercase canonical); real `ä/ö/ü/ß`
   with no `ae/oe/ue/ss` aliasing; standard German only (no Austrian/Swiss forms);
   **strict list membership**, no algorithmic compound splitting.
3. **Packaging.** Commit the raw `words` + upstream `COPYING`; the Docker build
   verifies the checksum and bakes the list into the image. No runtime volume, no
   build-time network fetch.
4. **Loading.** Loaded **once, eagerly, at server startup**, shared read-only across
   all rooms. **Server-only** — the browser never holds the list.
5. **Runtime workload.** The only live query is a **submit-time validity check**.
   A second capability, **board enumeration** (8-way adjacency, tile-once, min length 3,
   deduped words), is shared by board generation (#7) and the end-of-round reveal (#6).
6. **Structure.** One **DAWG** (minimal acyclic FSA, ~2.3 MB, ~161k states) serves both
   membership (automaton walk) and enumeration (prefix-pruned DFS). Resident dictionary
   budget ≤ ~10 MB.
7. **Transform.** Generated **during the Docker image build** from the committed raw
   file; the artifact is **not committed**; startup loads it instantly. The build
   asserts the checksum and that no entry is shorter than 3 (drops the 90 two-letter
   entries); the long tail is kept (multi-letter tiles can produce words longer than 16).
8. **Interface.** A deep `Dictionary` module: `isValid(word) => boolean` and
   `findWords(board) => string[]`. The DAWG stays private. The board is **caller-supplied**
   (each cell yields one or more candidate letter-strings), so tile and special-tile rules
   live in #7, not the dictionary. Output is words-only; paths/coordinates are deferred to
   #6/#7.
9. **Normalization.** Lowercase + **NFC** applied to both the list (at load) and player
   input (at query); entries that collide after folding are deduped.
10. **Verification.** Golden valid/invalid word checks (incl. umlauts/`ß`), a fixture-board
    enumeration snapshot, and build assertions (checksum; zero entries < 3).

## Consequences

- **Clean licence.** CC0 imposes no attribution or ShareAlike; we ship `COPYING` as a
  courtesy, not an obligation. See [`docs/licences/enz-german-wordlist.md`](../licences/enz-german-wordlist.md).
- **One structure, two jobs.** The DAWG answers both membership and enumeration, so #7
  and #6 need no second index, and the whole-board solve is fast.
- **Small footprint.** ~2.3 MB resident instead of ~30 MB for a naive `Set<string>`, at
  the cost of a build step.
- **Curation trade-off.** enz is a curated game list, not a lexicographic authority, so a
  few false positives/negatives are accepted. Compound words that are not lexicalised in
  the list are rejected.
- **Constrained coverage.** Standard German only; Austrian/Swiss-only spellings and the
  Swiss `ß→ss` merge are out of scope.
- **Build-time coupling.** The image build now owns checksum + trim + DAWG generation;
  the raw list is the single source of truth and the artifact is never committed, so it
  cannot drift.

## Suppressed alternatives

- **igerman98 / `hunspell-de-de` (GPL-2.0-or-later).** Rejected: best coverage but the
  data file carries copyleft/source-offer obligations for no gameplay benefit.
- **Daniel Naber Morphologie-Lexikon (CC BY-SA 4.0).** Rejected: attribution + ShareAlike
  and ~25 MB to gain lemma/POS metadata the game does not use.
- **Build a derived list from igerman98.** Rejected: more moving parts for the same
  outcome and a blurred licence story.
- **Algorithmic compound validation.** Rejected: accepts grammatical-but-non-lexical
  concatenations and wrecks fairness.
- **Sorted blob + offset index / `Set<string>`.** Rejected: membership-only, no practical
  enumeration (blob) or ~30 MB and no enumeration (`Set`).
