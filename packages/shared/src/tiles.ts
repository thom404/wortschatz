/**
 * The German tile vocabulary: notation predicates, tile letters, curated
 * special-tile menus and the one committed tile bag. ADR-0003 is normative
 * for the bag's composition; this module is its surface.
 *
 * Canonical tile form is lowercase NFC strings; notation is `st`-style
 * digrams as plain concatenation, either/or as `a/e`, prefixes as `an-`,
 * suffixes as `-ung`. Display is independent of data (ADR-0002). Length
 * counts letters, not tiles: a `sch` tile contributes three.
 */
export type Tile = string;
export type TileKind = "single" | "digram" | "either-or" | "prefix" | "suffix";

/** Words must start with the prefix, exactly where a prefix tile begins a path. */
export function isPrefix(t: Tile): boolean {
  return t.length > 1 && t.endsWith("-");
}

/** Words must end with the suffix, on the suffix tile. */
export function isSuffix(t: Tile): boolean {
  return t.length > 1 && t.startsWith("-");
}

/** Word is valid if either variant is on the list. */
export function isEitherOr(t: Tile): boolean {
  return t.includes("/") && t.length === 3;
}

/** Consecutive letters from the digram part of the bag (`st`, `sch`, `qu`, …). */
export function isDigram(t: Tile): boolean {
  return tileKind(t) === "digram";
}

export function tileKind(t: Tile): TileKind {
  if (isEitherOr(t)) return "either-or";
  if (isPrefix(t)) return "prefix";
  if (isSuffix(t)) return "suffix";
  if (t.length > 1) return "digram";
  return "single";
}

/** The tile's letters, in order — length counts letters, not tiles. */
export function tileLetters(t: Tile): string[] {
  if (isEitherOr(t)) return [...t.replace("/", "")];
  return [...t.replace(/^-|-$/g, "")];
}

/**
 * The candidate letter-strings the cell can spell: one for most tiles, two
 * for either/or. This is what the dictionary enumerates against.
 */
export function tileStrings(t: Tile): string[] {
  if (isEitherOr(t)) return t.split("/");
  return [t.replace(/^-|-$/g, "")];
}

/** The most letters any one variant of this tile can contribute. */
export function tileSpellingLength(t: Tile): number {
  return Math.max(...tileStrings(t).map((s) => s.length));
}

/** Curated menus for special tiles (ADR-0003 §6). */
export const PREFIX_MENU = ["an-", "un-", "ge-", "ab-"] as const;
export const SUFFIX_MENU = ["-ung", "-en", "-er", "-s"] as const;
export const EITHER_OR_MENU = ["e/ä", "i/e", "a/e", "o/u"] as const;

/**
 * One tile bag: tile → count. Vowel mass 30/96 (31.25%); no standalone `q`
 * (`q` only via `qu`); runts `x j y` exactly one each.
 */
export const TILE_BAG: Readonly<Record<Tile, number>> = {
  e: 10,
  a: 6,
  i: 6,
  o: 4,
  u: 4,
  ä: 2,
  ö: 1,
  ü: 1,
  t: 4,
  r: 4,
  n: 4,
  s: 3,
  h: 2,
  l: 3,
  g: 2,
  c: 2,
  m: 2,
  d: 2,
  b: 2,
  f: 1,
  p: 1,
  k: 1,
  w: 1,
  v: 1,
  z: 1,
  x: 1,
  j: 1,
  y: 1,
  ß: 2,
  er: 3,
  en: 3,
  te: 3,
  ch: 2,
  sch: 3,
  st: 3,
  ei: 2,
  qu: 2,
} as const;

export const TILE_BAG_SIZE: number = Object.values(TILE_BAG).reduce((n, c) => n + c, 0);
