import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createDictionary, normalizeExclusions, normalizeWord } from "../src/dictionary/index.js";
import { defaultExclusionsPath, defaultWordsPath } from "../src/dictionary/loader.js";

/**
 * End-to-end curation checks against the committed assets (#114): the real
 * vendored word list plus the reviewed Exclusion list, through the same
 * ingestion seam the DAWG build and the dev fallback use.
 *
 * This is a full-list run like the audit, but fast (~1 s) and deterministic,
 * so it belongs in the default test run: it is the guard that the second
 * adjudicated batch removed what it says and left genuine German vocabulary —
 * including Duden loanwords and the words the audit only flags heuristically —
 * accepted.
 */
const readLines = (path: string): string[] => readFileSync(path, "utf8").split("\n");
const WORD_LINES = readLines(defaultWordsPath());
const EXCLUSION_LINES = readLines(defaultExclusionsPath());
const dictionary = createDictionary(WORD_LINES, EXCLUSION_LINES);

describe("committed exclusion list", () => {
  it("is normalized, deduped and free of sub-3 entries", () => {
    const entries = normalizeExclusions(EXCLUSION_LINES);
    expect(entries).toEqual([...new Set(entries)].sort());
    for (const entry of entries) {
      expect(entry, entry).toBe(normalizeWord(entry));
      expect(entry.length, entry).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("second reviewed batch (#114)", () => {
  it("rejects adjudicated proper nouns, abbreviations and brand names", () => {
    const excluded = [
      // proper nouns, toponyms and surnames
      "Kurt",
      "Roger",
      "Rom",
      "Sam",
      "Tex",
      "Tim",
      "Till",
      // abbreviations
      "Ads",
      "Aküspra",
      "Epo",
      "GroKo",
      "Ids",
      "Oled",
      "Oleds",
      // brands, products and proper-noun derivatives
      "BitTorrent",
      "BitTorrents",
      "CompactFlash",
      "JavaScript",
      "JavaScripts",
      "McCarthyismus",
      "McDonaldisierung",
      "Webhooks",
      "Wifi",
      "Wifis",
      "WikiWeb",
      "WikiWebs",
      "Youtuber",
      "Youtubern",
      "Youtubers",
    ];
    for (const word of excluded) expect(dictionary.isValid(word), word).toBe(false);
  });

  it("rejects adjudicated non-German-language forms", () => {
    const excluded = [
      "Baoulé",
      "Bokmål",
      "Bokmåls",
      "Brač",
      "Caló",
      "Cariñena",
      "Cariñenas",
      "Dimotikí",
      "Française",
      "Françaisen",
      "Hávamál",
      "Hávamáls",
      "Landsmål",
      "Landsmåls",
      "Lingála",
      "Quiché",
      "Riksmål",
      "Riksmåls",
      "Tupí",
      "VolXmusik",
      "Võro",
      "Ximénez",
      "Yue",
    ];
    for (const word of excluded) expect(dictionary.isValid(word), word).toBe(false);
  });

  it("retains Duden-accepted loanwords carrying non-German codepoints", () => {
    const retained = [
      "Café",
      "Cliché",
      "Coupé",
      "Rosé",
      "Soufflé",
      "Matinée",
      "Varieté",
      "Soirée",
      "Gulyás",
      "Csárdás",
      "Négritude",
      "Omertà",
      "Pietà",
      "Podestà",
      "Shōgun",
      "Voilà",
    ];
    for (const word of retained) expect(dictionary.isValid(word), word).toBe(true);
  });

  it("retains valid German words the audit only flags heuristically", () => {
    const retained = [
      // imperative/inflected forms also on the upstream blacklist
      "Grins",
      "Hänsel",
      "Kant",
      "Brecht",
      "Aalst",
      "Beate",
      "Jauch",
      // short capitalised German nouns from the abbreviation flag
      "Akt",
      "Bär",
      "Uhr",
      "Zug",
      // English-looking tokens that are ordinary German loanwords
      "Act",
      "Air",
      "Cox",
      "Aids",
      "Ufo",
      // inner-uppercase entries that are German common nouns
      "Latex",
      "Intercity",
      "MacGuffin",
    ];
    for (const word of retained) expect(dictionary.isValid(word), word).toBe(true);
  });

  it("keeps German orthography untouched", () => {
    for (const word of ["Straße", "Äpfel", "Süß"]) {
      expect(dictionary.isValid(word), word).toBe(true);
    }
    expect(dictionary.isValid("Strasse")).toBe(false);
    expect(dictionary.isValid("Aepfel")).toBe(false);
  });
});
