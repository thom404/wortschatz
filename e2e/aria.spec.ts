import { CANONICAL_SCENARIOS } from "./scenarios.js";
import { DESKTOP, enterRoom, expect, openPage, test } from "./support.js";

/**
 * One ARIA snapshot per canonical screen (#156), independent of skin and
 * viewport: the semantic layer beside the pixel layer. These assert roles,
 * names and reading order, not computed styles.
 */
for (const scenario of CANONICAL_SCENARIOS) {
  test(`${scenario.id} semantics`, async ({ page }) => {
    await openPage(page, {
      viewport: DESKTOP,
      skin: "standard",
      ...(scenario.path ? { path: scenario.path } : {}),
      ...(scenario.wire ? { wire: scenario.wire } : {}),
    });
    if (scenario.wire) {
      await enterRoom(page, { mode: scenario.enter ?? "create" });
    }
    if (scenario.afterOpen) await scenario.afterOpen(page);
    await scenario.ready(page);
    await expect(page.locator("#app")).toMatchAriaSnapshot({ name: `${scenario.id}.aria.yml` });
  });
}

test("Menü closed semantics", async ({ page }) => {
  await openPage(page, { viewport: DESKTOP, skin: "standard" });
  await expect(page.locator("#menu")).toMatchAriaSnapshot({ name: "menu-closed.aria.yml" });
});

test("Menü open semantics", async ({ page }) => {
  await openPage(page, { viewport: DESKTOP, skin: "standard" });
  await page.locator("#menu-trigger").click();
  await expect(page.locator("#menu")).toMatchAriaSnapshot({ name: "menu-open.aria.yml" });
});
