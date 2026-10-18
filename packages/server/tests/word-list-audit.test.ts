import { describe, expect, it } from "vitest";
import {
  AUDIT_REASONS,
  formatWordListAudit,
  runWordListAudit,
  type WordListAuditReport,
} from "../src/audit/index.js";

const group = (report: WordListAuditReport, reason: (typeof AUDIT_REASONS)[number]): string[] =>
  report.groups.find((entry) => entry.reason === reason)?.words ?? [];

describe("runWordListAudit", () => {
  it("seeds from the upstream blacklist, skipping already-reviewed exclusions", () => {
    const report = runWordListAudit({
      words: ["Bébé", "Café", "Google", "Haus", "Iban", "Pkw"],
      exclusions: ["bébé"],
      upstreamBlacklist: ["Bébé", "Google", "Haus", "Iban", "Pkw"],
    });
    expect(group(report, "upstream-blacklist")).toEqual(["google", "haus", "iban", "pkw"]);
    expect(group(report, "upstream-blacklist")).not.toContain("bébé");
  });

  it("flags non-German codepoints for review without removing loanwords", () => {
    const report = runWordListAudit({
      words: ["Bébé", "Café", "Cliché", "Coupé", "Haus", "Straße", "Äpfel"],
      exclusions: ["bébé"],
      upstreamBlacklist: [],
    });
    expect(group(report, "non-german-codepoints")).toEqual(["café", "cliché", "coupé"]);
    expect(group(report, "non-german-codepoints")).not.toContain("straße");
    expect(group(report, "non-german-codepoints")).not.toContain("äpfel");
  });

  it("flags leading uppercase pairs and short capitalised tokens", () => {
    const report = runWordListAudit({
      words: ["ABCTest", "Aids", "Haus", "Iban", "Pkw"],
      exclusions: [],
      upstreamBlacklist: [],
    });
    expect(group(report, "abbreviation-patterns")).toEqual(["abctest", "pkw"]);
  });

  it("flags inner uppercase and raw-list ordering violations", () => {
    const report = runWordListAudit({
      words: ["Zebra", "Apfel", "JavaScript"],
      exclusions: [],
      upstreamBlacklist: [],
    });
    expect(group(report, "input-anomalies")).toEqual(["apfel", "javascript"]);
  });

  it("is deterministic across runs", () => {
    const input = {
      words: ["Bébé", "Café", "Google", "Haus", "Pkw", "JavaScript"],
      exclusions: ["bébé"],
      upstreamBlacklist: ["Google", "Haus"],
    };
    const first = formatWordListAudit(runWordListAudit(input));
    const second = formatWordListAudit(runWordListAudit(input));
    expect(second).toBe(first);
    expect(first).toContain("## upstream-blacklist (2)\ngoogle\nhaus");
    expect(first).toContain("## non-german-codepoints (1)\ncafé");
  });

  it("reports the reasons in a stable order with counts", () => {
    const report = runWordListAudit({
      words: ["Bébé", "Café", "Haus", "de"],
      exclusions: ["bébé"],
      upstreamBlacklist: ["Haus"],
    });
    expect(report.groups.map((entry) => entry.reason)).toEqual([...AUDIT_REASONS]);
    expect(report.rawWords).toBe(4);
    expect(report.acceptedWords).toBe(2);
    expect(report.excludedWords).toBe(1);
    expect(report.blacklistEntries).toBe(1);
  });

  it("fails loudly on a stale exclusion", () => {
    expect(() =>
      runWordListAudit({
        words: ["Haus"],
        exclusions: ["bébé"],
        upstreamBlacklist: [],
      })
    ).toThrow(/not present/);
  });
});
