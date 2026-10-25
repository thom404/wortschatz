import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src/escape.js";

/**
 * The escaping contract (#163): one helper for text nodes and attribute values
 * alike. The table is deliberately pinned character by character so a change
 * to it fails one focused test rather than a screen test.
 */

describe("escapeHtml", () => {
  it("escapes each of the five HTML-significant characters", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  it("escapes a mixed string in one pass, ampersand first", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;"
    );
  });

  it("passes non-ASCII input through untouched", () => {
    expect(escapeHtml("ä ß ẞ")).toBe("ä ß ẞ");
  });

  it("returns the empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("is not idempotent: escaping twice double-escapes", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});
