import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The browser that renders the Screenshot baselines must be the browser the
 * tests were written against (ADR-0032). The exact `@playwright/test` pin, the
 * `visual` job's container image and the AGENTS.md recipe all have to name the
 * same version.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  devDependencies?: Record<string, string>;
};
const CI_WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const AGENTS = readFileSync(join(ROOT, "AGENTS.md"), "utf8");

const CONTAINER_IMAGE = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble/;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

function imageVersion(source: string, sourceName: string): string {
  const match = source.match(CONTAINER_IMAGE);
  if (!match) {
    throw new Error(
      `${sourceName} must name the Playwright container image ` +
        "`mcr.microsoft.com/playwright:v<version>-noble`"
    );
  }
  return match[1]!;
}

describe("Playwright pin coherence", () => {
  it("names the same browser in the manifest, the CI container and the AGENTS.md recipe", () => {
    const pin = MANIFEST.devDependencies?.["@playwright/test"];
    if (!pin || !EXACT_VERSION.test(pin)) {
      throw new Error('package.json must pin "@playwright/test" to an exact version, for example "1.64.1"');
    }

    expect(imageVersion(CI_WORKFLOW, ".github/workflows/ci.yml")).toBe(pin);
    expect(imageVersion(AGENTS, "AGENTS.md")).toBe(pin);
  });
});
