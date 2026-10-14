# Research: free/OSS German word-list sourcing

Ticket: GitHub issue #2 — "Research: free/OSS German word-list sourcing"
Date: 2026-10-14
Context: German-language, real-time multiplayer Wordament-like game; self-hosted
TypeScript full-stack web app; hard constraint **zero licence cost** — every list
must be legally redistributable inside a Docker image.

Every claim below is traced to a primary source (upstream repo, licence file,
upstream docs). Numbers were measured by downloading the artefact and counting it
where possible; those measurements are marked "(measured)".

---

## TL;DR recommendation

1. **`enz/german-wordlist`** — **CC0-1.0**, a plain UTF-8 one-word-per-line list,
   685,829 entries (measured), inflected forms, real umlauts, real `ß`, capitalised
   nouns, no phrases/proper nouns. Drops straight into a `Set<string>`; **no
   obligations at all**, so the safest possible redistribution. ← primary pick.
2. **igerman98 / `hunspell-de-de` / LibreOffice `de_DE_frami`** — **GPL-2.0-or-later**,
   Björn Jacke's authoritative spelling dictionary; affix-compressed, so the
   surface-form count is in the millions once expanded. Use as the spelling
   authority and (optionally) to *validate* the CC0 list. ← coverage/authority pick.
3. **Daniel Naber "Deutsches Morphologie-Lexikon"** — **CC BY-SA 4.0**, full-form
   lexicon with lemma + POS tags. Use only if we want lemma/inflection metadata,
   not just a word set. ← metadata pick.

A naive flat list from germandict is *probably* fine but its "Public Domain" claim
rests on data derived from GPL and CC-BY-SA sources (see §3.4) — treat it as a
licence risk, not a clean-room source.

---

## 1. Decision criteria

| Criterion | Why it matters here |
|---|---|
| Licence cost | Must be 0 €. |
| Redistributable in a Docker image | We vendor the list into the image, i.e. we *redistribute* it. No "personal use only", no "do not republish". |
| Attribution / ShareAlike obligations | CC0 = none; CC BY-SA / GPL = attribution and (data) copyleft obligations we must honour in our own licence/docs. |
| Format & parseability | We need a set of valid words at runtime; simpler is better. |
| Size & memory footprint | Game server must hold the list in RAM. |
| Coverage | Inflected forms, umlauts (`ä/ö/ü` vs `ae/oe/ue`), `ß` distinct from `ss`, capitalised nouns, proper nouns/phrases in or out. |

Licence/obligation summary of the free licences involved: CC0 imposes no
conditions; CC BY-SA requires attribution + sharing modifications under the same
licence; GPL-2.0-or-later requires that redistributed copies (including the data
file) carry the licence and offer the source. All three are zero-cost. GPL on a
*data file* shipped next to our code is "mere aggregation" for the code, but the
data file itself must remain under GPL — worth an explicit `docs/licences/` note.

---

## 2. Candidates at a glance

| # | Source | Licence | Redistribute @ 0 € | Format | Entries / size (measured) | Inflected forms | Umlauts | `ß` ≠ `ss` | Nouns capitalised | Phrases / proper nouns |
|---|---|---|---|---|---|---|---|---|---|---|
| 2.1 | enz/german-wordlist | CC0-1.0 | Yes, no obligations | UTF-8 text, 1/line | 685,829 / 8,644,058 B | Yes | `ä/ö/ü` | Yes (11,974 lines) | Yes (291,428 lines) | No / No |
| 2.2 | igerman98 (`hunspell-de-de`, LO `de_DE_frami`) | GPL-2.0-or-later | Yes, copyleft | Hunspell `.dic`+`.aff` (ISO-8859-1) | 258,220 stems / 4.36 MB; millions of forms after expansion | Yes (affix rules) | `ä/ö/ü` | Yes | Yes | compound rules; some names |
| 2.3 | Daniel Naber Morphologie-Lexikon | CC BY-SA 4.0 | Yes, attribution + SA | TSV (form, lemma, tags), UTF-8 | 25 MB text lexicon | Yes (explicit) | `ä/ö/ü` | Yes | Yes | some multi-word entries |
| 2.4 | Free German Dictionary (germandict) | declared Public Domain (⚠ see §3.4) | claim yes — legally shaky | plain text, Latin-1, CRLF | >2,000,000 / 6.27 MB `.7z` | Yes | `ä/ö/ü` | Yes | Yes | occasional |
| 2.5 | German Wiktionary dump / kaikki+wiktextract | CC BY-SA 4.0 (+GFDL) | Yes, attribution + SA | XML dump → JSONL | 1,269,246 pages; kaikki extract 1.0 GB / 352,527 words | partial | `ä/ö/ü` | Yes | Yes | yes, incl. proper names |
| 2.6 | wordfreq (`de`, `de-large`) | data CC BY-SA 4.0 (code Apache-2.0) | Yes, attribution + SA | Python pkg / msgpack.gz | small 186,094 B; large 3,622,737 B | wordforms | `ä/ö/ü` | ⚠ case/ß normalised | lowercased | yes, incl. junk |
| 2.7 | dewiki-wordrank | CC BY-SA 4.0 | Yes, attribution + SA | TSV word+count | lowercased, from de.wikipedia | yes (as surface forms) | `ä/ö/ü` | lowercased | no (lowercased) | yes (wiki noise) |
| 2.8 | OpenThesaurus | LGPL-2.1 **or** CC BY-SA 4.0 | Yes, attribution (+SA/LGPL) | text/MySQL dump | text export 1.61 MB zip | lemmas mostly | `ä/ö/ü` | ⚠ CH variant `ss` | yes | no (synonym thesaurus) |

---

## 3. Detailed findings

### 3.1 igerman98 (and its packaged forms) — GPL-2.0-or-later

- **What it is.** Björn Jacke's German Ispell/MySpell/Hunspell dictionary, maintained
  since 1999, following the post-1996 (and post-2006) orthography. It is the base
  dictionary behind the Debian `hunspell-de-de`, `aspell-de` and the LibreOffice
  German dictionary. Source: <https://www.j3e.de/ispell/igerman98/>.
- **Licence.** `Documentation/Copyright` inside the release tarball states:
  *"This program is free software; you can redistribute it and/or modify it under
  the terms of the GNU General Public License version 2 or 3"* →
  **GPL-2.0-or-later**. Source: `igerman98-20161207.tar.bz2` →
  `Documentation/Copyright`; also <https://www.j3e.de/ispell/igerman98/dict/>.
  Tarball itself is only ~459 KB; latest release 2016-12-07.
- **Source lists (parse trap).** The raw word lists under `dicts/*.txt`
  (88,676 tag lines, measured) use **TeX-style escapes**, not real letters:
  `bin/dic2iso` maps `a"→ä`, `o"→ö`, `u"→ü`, `A"→Ä`, …, and `sS→ß`
  (`bin/dic2iso`, `bin/iso2dic` in the tarball). E.g. the file literally contains
  `Bo"sewichter/N` and `A"usSerlichkeit/P`. Do **not** feed `dicts/*.txt` in
  directly.
- **Compiled dictionaries.** The build emits ISO-8859-1 Hunspell `.dic`+`.aff`
  (`hunspell/de_all.aff.header`: `License: GPLv2, GPLv3`). These are
  **affix-compressed**: the `.dic` is stems + flags, and the `.aff` rules generate
  surface forms. To get a flat word list you must expand, e.g. Hunspell's
  `wordforms`/`unmunch` (the Makefile uses Aspell/Hunspell affix expansion:
  `AFFIX_EXPAND_COMMAND = … aspell … expand`).
- **Size.** LibreOffice's `de_DE_frami.dic` (igerman98 + Franz Baumann's
  additions) is 4,356,903 bytes and 258,220 tag lines (measured); 4,771 lines
  contain `ß` and 27,856 contain `ä/ö/ü` (measured, ISO-8859-1). The base igerman98
  is smaller; expansion via compounding rules yields **millions** of accepted
  surface forms.
- **Coverage.** Inflected forms via affixes: yes — `Aachenerin`, `Aachenerinnen`,
  `Aachenern` etc. Umlauts as real `ä/ö/ü`: yes. `ß` distinct from `ss`: yes. Nouns
  capitalised: yes. Compounds: handled by rules (so the "list" is effectively
  infinite on demand). Some proper names/geography included (`dicts/namen-*`,
  `dicts/vornamen-*`).
- **Packaged forms / same licence.**
  - Debian `hunspell-de-de` (589 kB pkg / 1,928 kB installed):
    <https://packages.debian.org/sid/hunspell-de-de>.
  - `aspell-de` word list: <https://packages.debian.org/sid/aspell-de>.
  - LibreOffice German dictionary `de_DE_frami`:
    <https://github.com/LibreOffice/dictionaries/tree/master/de> — its
    `README_de_DE_frami.txt` says the word lists are *"lizenziert unter der GNU
    GPL, Version 2 oder 3"* and are derived from igerman98; `COPYING_GPLv2` /
    `COPYING_GPLv3` are shipped. Encoding is `SET ISO8859-1` (in
    `de_DE_frami.aff`).

### 3.2 `enz/german-wordlist` (Tanglet) — CC0-1.0

- **What it is.** A word-game word list ("for Tanglet and other wordgames"),
  Scrabble-style inclusion rules (no names, proper nouns, toponyms, abbreviations,
  archaic/outdated spellings; regional and dated words allowed). Source:
  <https://github.com/enz/german-wordlist>.
- **Licence.** Repository is marked **CC0-1.0** (`COPYING`); GitHub reports the
  `CC0-1.0` SPDX id. No attribution/ShareAlike obligations.
- **Format.** Plain **UTF-8**, sorted, one word per line, Unix (LF) endings. Zero
  lines contain a space, i.e. **no multi-word phrases** (measured: `grep -c ' '` = 0).
- **Size (measured).** `words` = 8,644,058 bytes, **685,829 entries**; longest word
  25 chars (`Abonnementsabbestellungen`), mean length 11.38 chars.
- **Coverage (measured).** Inflected forms present (`Aachener`, `Aachenerin`,
  `Aachenerinnen`, `Aachenern`). Real umlauts `ä/ö/ü` in 138,703 lines; real `ß`
  (not `ss`) in 11,974 lines. Capitalised (noun/name-like) starts in 291,428 lines.
  Provides an explicit `blacklist` (91,697 B) and `verify.sh` for maintenance.
- **Memory.** ~685k short strings. In Node/V8 a `Set<string>` of this size is on the
  order of **50–100 MB** (Latin-1 one-byte strings + per-entry overhead); storing the
  raw file as one interned blob + binary search is ~9 MB. A DAWG/trie shrinks it
  further (~2–4 bytes/word, single-digit MB).
- **Verdict.** Best drop-in: correct orthography, inflections, `ä/ö/ü`, `ß`,
  capitalisation, and **no licence obligations**. Caveat: it is a curated game list,
  not a lexicographic authority; expect a few false positives/negatives.

### 3.3 Daniel Naber "Deutsches Morphologie-Lexikon" — CC BY-SA 4.0

- **What it is.** Morphy-derived German morphology data with many corrections and
  extensions (largely from korrekturen.de). Source:
  <https://www.danielnaber.de/morphologie/>.
- **Licence.** *"Die Daten stehen unter der Creative Commons Namensnennung -
  Weitergabe unter gleichen Bedingungen 4.0 Unported Lizenz"* → **CC BY-SA 4.0**
  (attribution + ShareAlike). Same page.
- **Format.** Export via LanguageTool produces per-line
  `form <TAB> lemma <TAB> POS-tags`, e.g. `Häusern  Haus  SUB:DAT:PLU:NEU`.
  UTF-8.
- **Size.** "Vollformenlexikon 2011-07-22" = **25 MB** (UTF-8). A smaller
  lemmatizer CSV (1.2 MB) lists forms → lemmas. (The LanguageTool export is the
  corrected/extended set.)
- **Coverage.** Explicit full inflected forms with lemmas and POS tags — umlauts,
  `ß`, capitalised nouns, plurals all present. Best choice **if we need lemma/POS
  metadata**; overkill (and larger) than the CC0 list if we only need a word set.
- **Memory.** ~2M+ records as TSV; naive `Map` of strings is ~150–250 MB.
  Recommend a build step that emits a compact word-set/DAWG rather than loading the
  raw TSV.

### 3.4 Free German Dictionary (germandict) — declared Public Domain ⚠

- **What it is.** Jan Schreiber's large Aspell-oriented word list, "over 2 million
  entries (including inflected forms)". Source:
  <https://sourceforge.net/projects/germandict/>. Project page states licence
  **Public Domain**; `readme.txt` says plain text, one word per line,
  alphabetically ordered, **Latin-1 (ANSI), CRLF**, distributed as `german.7z`
  (**6,271,782 bytes**, measured) plus `AT-CH-DE.7z` (10,532,844 bytes, measured).
- **Coverage.** Full forms incl. inflections; `ä/ö/ü`; `ß` vs `ss` carefully
  handled; capitalised nouns; occasional false positives (author's own admission).
- **⚠ Licence trap.** `Methoden und Quellen der Wortliste.txt` (in the project's own
  files) says the data was built by *filtering a corpus with Hunspell and the
  **DE-frami** dictionary (GPL)*, from sources that include the **German Wikipedia
  dump (CC BY-SA)** and **OpenThesaurus (CC BY-SA / LGPL)**. A work derived from
  GPL and CC-BY-SA data **cannot simply be relicensed as Public Domain**, and EU
  sui-generis database rights may also apply to a word list. So the "Public Domain"
  label is legally doubtful for redistribution. Do **not** rely on this list as the
  sole basis for shipping; prefer §3.1/§3.2/§3.3.

### 3.5 German Wiktionary — CC BY-SA (4.0, historically 3.0) + GFDL

- **What it is.** The community dictionary. Licence page:
  <https://de.wiktionary.org/wiki/Wiktionary:Lizenzbestimmungen> — content is under
  **CC BY-SA** (page footer: CC BY-SA 4.0; page text also cites 3.0) and, for
  compatibility, **GFDL**; commercial use allowed with attribution + ShareAlike.
- **Scale.** 1,269,246 content pages and 98,378,478 words across content pages
  (<https://de.wiktionary.org/wiki/Spezial:Statistik>).
- **Format / extraction.** XML dumps → parse with **wiktextract**
  (<https://github.com/tatuylonen/wiktextract>); a ready-made post-processed
  **kaikki.org** German extract (from the en.wiktionary dump) is 1.0 GB JSONL with
  352,527 distinct word forms, POS-tagged (adjectives 312k, nouns 155k, verbs 144k):
  <https://kaikki.org/dictionary/German/index.html>. Extracted data inherits
  Wiktionary's CC BY-SA.
- **Coverage.** Lemmas + many inflections, real umlauts/`ß`, capitalisation,
  **includes proper names** and phrases — needs filtering for a game dictionary.
- **Verdict.** Free and redistributable (attribution + SA) but heavy to process and
  noisy; best as a *supplement* to a curated list, not the primary source.

### 3.6 wordfreq — data CC BY-SA 4.0 (code Apache-2.0)

- **What it is.** Frequency lists for 40+ languages incl. German; code Apache-2.0,
  **data CC BY-SA 4.0**, with additional attribution to Google Books Ngrams,
  SUBTLEX-DE (Brysbaert et al., used by permission; must credit), OpenSubtitles,
  Wikipedia, ParaCrawl, Leeds Internet Corpus. Sources:
  <https://github.com/rspeer/wordfreq> (README, `LICENSE.txt`, `NOTICE.md`).
- **Format / size (measured).** Python package; German data files
  `wordfreq/data/small_de.msgpack.gz` = **186,094 B** and
  `large_de.msgpack.gz` = **3,622,737 B**.
- **Coverage trap.** It is **frequency data**, not a spelling authority: words are
  lowercased and the tokenisation folds case; expect junk/short/non-word tokens and
  multi-word items. Unsuitable as the primary valid-word set; usable for weighting
  word rarity/scoring.

### 3.7 dewiki-wordrank — CC BY-SA 4.0

- Tab-delimited **lowercased** word-frequency list compiled from the German
  Wikipedia (dump 2021-11-02). Source:
  <https://github.com/gambolputty/dewiki-wordrank>. Licence **CC BY-SA 4.0**.
  Lowercasing rules it out as a capitalisation-preserving dictionary; useful only
  for frequency weighting.

### 3.8 OpenThesaurus — LGPL-2.1 **or** CC BY-SA 4.0

- German **synonym thesaurus** (not a spelling list). Data downloadable as text
  (1.61 MB zip), oxt, or MySQL dump; licence **LGPL-2.1 or CC BY-SA 4.0** (choose
  either), attribution to openthesaurus.de required:
  <https://www.openthesaurus.de/about/download>. Swiss variant replaces `ß` with
  `ss`. Could yield a lemma list but is not inflected-form complete.

---

## 4. Sources that are **NOT** usable

| Source | Why not |
|---|---|
| **Duden** (duden.de, Duden print/software) | Proprietary, all rights reserved. The Duden dictionary explicitly states no part may be reproduced or distributed in any form without the publisher's written consent ("Kein Teil dieses Werkes darf ohne schriftliche Einwilligung des Verlages … reproduziert … werden", Duden – Das Fremdwörterbuch, Bibliographisches Institut). Paying for a licence violates the zero-cost constraint. Source: <https://www.duden.de/woerterbuch>, book preview at <https://api.pageplace.de/preview/DT0400.9783411913145_A40494506/preview-9783411913145_A40494506.pdf>. |
| **DWDS** (dwds.de) | BBAW reserves rights under §44b UrhG: *"Jegliche Nutzung der Inhalte des DWDS, einschließlich … automatisierte Abfragen und Auswertungen (Crawlen, Parsen, Text- und Data-Mining) … ist nur mit ausdrücklicher Genehmigung gestattet."* Not redistributable. Source: <https://www.dwds.de/d/nutzungsbedingungen>, <https://www.dwds.de/d/urheberrechte>. **Warning:** third-party repos that label DWDS-derived lemmata as "CC BY-SA 4.0" (e.g. `holzga/anagram-guesser`'s `LICENSE-DATA`) are mis-attributing — DWDS does not grant that. |
| **dict.cc** | Free to use but explicitly **not republishable**: an available vocabulary file is *"free to use (as long as it is not republished)"*. Source: <https://www.dict.cc/?l=e&s=about%3Awordlist>. |
| **LEO, Langenscheidt, PONS, Wahrig** | Proprietary commercial dictionaries; no redistribution licence. |
| **Official Scrabble/Duden tournament word lists** | Proprietary (Scrabble word lists are licensed products); not OSS. |
| **Any Hunspell dictionary without an OSI/CC licence** | Licences vary per dictionary; only GPL/MPL/LGPL/CC dictionaries are safe. Verify the licence file in the specific dictionary, not just the package. |

---

## 5. Parsing notes (practical)

- **Hunspell `.dic`/`.aff` (igerman98, frami):** files are **ISO-8859-1**
  (`SET ISO8859-1`). The first line of `.dic` is the entry count; then
  `word/FLAGS`. To enumerate accepted surface forms, expand with Hunspell
  (`wordforms`/`unmunch`) or Aspell (`aspell … expand`); otherwise you must run the
  Hunspell engine at runtime to validate words, because compounds are rule-generated.
- **igerman98 raw `dicts/*.txt`:** TeX escapes `a" o" u" A" O" U"` → `ä ö ü Ä Ö Ü`,
  and `sS` → `ß`. Requires `bin/dic2iso`-style conversion first.
- **enz list:** UTF-8, LF, one word per line, sorted — trivially `split('\n')`.
- **germandict:** Latin-1 (ISO-8859-1), CRLF, one word per line — decode as `latin1`
  then split on `\r\n`.
- **Naber morphology:** UTF-8 TSV `form\tlemma\ttags`; build a compact form set at
  image-build time.
- **Wiktionary/kaikki:** JSONL, very large; stream and filter by POS/language.
  Preserve `ä/ö/ü/ß`; do **not** transliterate to `ae/oe/ue/ss`.

---

## 6. Coverage answer (the ticket's checklist)

- **Inflected forms:** yes in enz (explicit), igerman98/frami (affix-generated),
  Naber morphology (explicit), germandict (explicit). Wiktionary partial; wordfreq
  as wordforms; OpenThesaurus mostly lemmas.
- **Umlauts:** all viable lists use real `ä/ö/ü` (not `ae/oe/ue`), except the
  raw igerman98 source lists which use TeX escapes. Swiss variants
  (OpenThesaurus "Schweizer Version", igerman98 `de_CH`) replace `ß`→`ss`.
- **`ß` distinct from `ss`:** yes in enz (11,974 entries), igerman98/frami
  (4,771 in frami), germandict, Naber; the Swiss variants deliberately merge them.
- **Nouns capitalised:** yes in enz, igerman98/frami, germandict, Naber, Wiktionary.
  wordfreq and dewiki-wordrank are **lowercased** and therefore not usable as-is for
  capitalisation-sensitive play.
- **Multi-word phrases:** essentially none in enz (by design); some in
  Wiktionary/igerman98/Naber. **Proper nouns:** excluded from enz (Scrabble rules);
  included in igerman98 (names/geography), Wiktionary, Naber — filter if unwanted.

---

## 7. References (primary)

1. igerman98 upstream — <https://www.j3e.de/ispell/igerman98/> ; release dir
   <https://www.j3e.de/ispell/igerman98/dict/> ; licence in
   `igerman98-20161207.tar.bz2` → `Documentation/Copyright` (GPL-2.0-or-later);
   escape mapping `bin/dic2iso` / `bin/iso2dic`.
2. LibreOffice German dictionary (`de_DE_frami`) —
   <https://github.com/LibreOffice/dictionaries/tree/master/de> ;
   `README_de_DE_frami.txt`, `COPYING_GPLv2`, `COPYING_GPLv3`,
   `de_DE_frami.dic`, `de_DE_frami.aff`.
3. Debian packages — <https://packages.debian.org/sid/hunspell-de-de> ,
   <https://packages.debian.org/sid/aspell-de>.
4. enz/german-wordlist — <https://github.com/enz/german-wordlist> (CC0-1.0;
   `COPYING`, `words`, `blacklist`).
5. Free German Dictionary — <https://sourceforge.net/projects/germandict/> ;
   `readme.txt`; `Methoden und Quellen der Wortliste.txt`; `german.7z`.
6. wordfreq — <https://github.com/rspeer/wordfreq> ; `LICENSE.txt`, `NOTICE.md`;
   data sizes from `wordfreq/data/`.
7. German Wiktionary licence — <https://de.wiktionary.org/wiki/Wiktionary:Lizenzbestimmungen> ;
   statistics — <https://de.wiktionary.org/wiki/Spezial:Statistik>.
8. kaikki.org German machine-readable dictionary —
   <https://kaikki.org/dictionary/German/index.html> ; wiktextract —
   <https://github.com/tatuylonen/wiktextract>.
9. Daniel Naber Morphologie-Lexikon — <https://www.danielnaber.de/morphologie/>
   (CC BY-SA 4.0).
10. OpenThesaurus download/licence — <https://www.openthesaurus.de/about/download>.
11. dewiki-wordrank — <https://github.com/gambolputty/dewiki-wordrank>.
12. DWDS terms/copyright — <https://www.dwds.de/d/nutzungsbedingungen> ,
    <https://www.dwds.de/d/urheberrechte>.
13. Duden — <https://www.duden.de/woerterbuch> ; book copyright notice
    <https://api.pageplace.de/preview/DT0400.9783411913145_A40494506/preview-9783411913145_A40494506.pdf>.
14. dict.cc word list terms — <https://www.dict.cc/?l=e&s=about%3Awordlist>.
15. GNU Aspell — <http://aspell.net>.
