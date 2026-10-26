import { describe, expect, it } from "vitest";
import { readAppVersion } from "../app-version.js";
import { APP_VERSION } from "../src/version.js";
import viteConfig from "../vite.config.js";

describe("APP_VERSION (#181)", () => {
  it("is injected from the root manifest's version field", () => {
    expect(APP_VERSION).toBe(readAppVersion());
    expect(APP_VERSION).toBe("0.1.1");
  });

  it("uses the same reader as the client build injection", () => {
    const buildDefine = viteConfig.define as Record<string, string>;
    expect(buildDefine.__APP_VERSION__).toBe(JSON.stringify(readAppVersion()));
  });
});
