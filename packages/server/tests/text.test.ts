import { describe, expect, it } from "vitest";
import { createDictionary } from "../src/dictionary/index.js";
import {
  normalizeCode as packageNormalizeCode,
  normalizeWord as packageNormalizeWord,
} from "../src/index.js";
import { fold, normalizeCode, normalizeNickname, normalizeWord, validNickname } from "../src/text.js";

describe("text normalization", () => {
  describe("nicknames", () => {
    it("is NFC, trimmed and capped at 24 characters", () => {
      expect(normalizeNickname("  Ha\u0308nsi  ")).toBe("Hänsi");
      expect(normalizeNickname("  Hänsi  ")).toBe("Hänsi");
      expect(normalizeNickname("A".repeat(30))).toBe("A".repeat(24));
    });

    it("folds case and canonical form for collision checks", () => {
      expect(fold("HÄNSI")).toBe("hänsi");
      expect(fold("Ha\u0308nsi")).toBe(fold("Hänsi"));
    });

    it("accepts every non-empty normalized name and rejects an empty one", () => {
      expect(validNickname(normalizeNickname("  Jörg  "))).toBe(true);
      expect(validNickname(normalizeNickname("   "))).toBe(false);
    });
  });

  describe("words", () => {
    it("is NFC, lowercase and trimmed", () => {
      expect(normalizeWord("  Straße  ")).toBe("straße");
      expect(normalizeWord("A\u0308PFEL")).toBe("äpfel");
      expect(normalizeWord("\tHaus\n")).toBe("haus");
    });

    it("leaves already-normalized input unchanged", () => {
      expect(normalizeWord("haus")).toBe("haus");
      expect(normalizeWord("straße")).toBe("straße");
      expect(normalizeWord("äpfel")).toBe("äpfel");
    });
  });

  describe("room codes", () => {
    it("trims and uppercases", () => {
      expect(normalizeCode("  lag4t ")).toBe("LAG4T");
      expect(normalizeCode("LAG4T")).toBe("LAG4T");
    });
  });
});

describe("the dictionary consumes the shared word normalizer", () => {
  it("trims surrounding whitespace on both the load and lookup paths", () => {
    const dict = createDictionary(["Haus", "  Straße  "]);
    expect(dict.isValid("haus")).toBe(true);
    expect(dict.isValid("  HAUS  ")).toBe(true);
    expect(dict.isValid("\tstraße\n")).toBe(true);
    expect(dict.isValid("  fehlt  ")).toBe(false);
  });
});

describe("the package re-exports the normalizers", () => {
  it("keeps the word and code normalizers on their public paths", () => {
    expect(packageNormalizeWord("  HAUS  ")).toBe("haus");
    expect(packageNormalizeCode(" lag4t ")).toBe("LAG4T");
  });
});
