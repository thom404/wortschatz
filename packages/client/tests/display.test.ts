import { describe, expect, it } from "vitest";
import { displayTile, displayWord } from "../src/display.js";

/**
 * The one display mapping (ADR-0002): the uppercase look belongs to CSS, so
 * this pure helper only substitutes the one letter whose Unicode full case
 * mapping would expand. Everything else is passed through untouched.
 */

describe("word display", () => {
  it("shows ß as capital ẞ instead of the two-glyph SS", () => {
    expect(displayWord("ß")).toBe("ẞ");
    expect(displayWord("straße")).toBe("straẞe");
    expect(displayWord("fuß")).toBe("fuẞ");
    expect("ß".toUpperCase()).toBe("SS"); // the browser's full case mapping this replaces
  });

  it("keeps ß and ss words distinguishable", () => {
    expect(displayWord("straße")).not.toBe(displayWord("strasse"));
    expect(displayWord("straße")).toContain("ẞ");
    expect(displayWord("strasse")).not.toContain("ẞ");
  });

  it("changes nothing else: umlauts, existing capital ẞ and plain words pass through", () => {
    expect(displayWord("äöü")).toBe("äöü");
    expect(displayWord("ẞ")).toBe("ẞ");
    expect(displayWord("wort")).toBe("wort");
  });
});

describe("tile display", () => {
  it("maps ß to ẞ on a single tile", () => {
    expect(displayTile("ß")).toBe("ẞ");
  });

  it("passes either/or tiles through with both variants", () => {
    expect(displayTile("a/e")).toBe("a/e");
    expect(displayTile("e/ä")).toBe("e/ä");
  });

  it("changes nothing else on ordinary and multi-letter tiles", () => {
    expect(displayTile("a")).toBe("a");
    expect(displayTile("sch")).toBe("sch");
    expect(displayTile("qu")).toBe("qu");
  });
});
