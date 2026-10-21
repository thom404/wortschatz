import { defineConfig } from "@playwright/test";

/**
 * The browser/visual regression seam (#156): the production client build,
 * driven through its WebSocket boundary with deterministic fixtures.
 *
 * Chromium only, one device pixel per CSS pixel, a frozen locale/timezone and
 * a strict zero-retry comparison. Baseline images are committed and updated
 * only inside the pinned Playwright container (see docs/adr/0020).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  outputDir: "test-results",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["list"], ["html", { open: "never" }]],
  expect: {
    toHaveScreenshot: {
      threshold: 0.2,
      maxDiffPixels: 0,
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      scale: "css",
    },
    toMatchAriaSnapshot: {
      pathTemplate: "{testDir}/__aria__/{arg}{ext}",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    deviceScaleFactor: 1,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "npm run build && npm run preview --workspace @wortschatz/client -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
