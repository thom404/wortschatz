import { ALL_SCENARIOS, ROOM_CODE } from "./scenarios.js";
import { enterRoom, expect, openPage, test } from "./support.js";

/**
 * The curated screenshot matrix (#156): canonical screens, outcome screens
 * and targeted edge states, each captured full-page in both skins at the
 * viewport its row prescribes. Baselines live in `e2e/__screenshots__/` and
 * are only updated through `npm run test:visual:update`.
 */
for (const scenario of ALL_SCENARIOS) {
  for (const viewport of scenario.viewports) {
    for (const skin of scenario.skins) {
      const title = `${scenario.id} · ${skin} · ${viewport.width}×${viewport.height}`;
      const screenshot = `${scenario.id}-${skin}-${viewport.width}x${viewport.height}.png`;

      const register = scenario.fixme ? test.fixme : test;
      register(title, async ({ page }) => {
        await openPage(page, {
          viewport,
          skin,
          ...(scenario.path ? { path: scenario.path } : {}),
          ...(scenario.wire ? { wire: scenario.wire } : {}),
        });
        if (scenario.wire) {
          await enterRoom(page, {
            mode: scenario.enter ?? "create",
            code: ROOM_CODE,
          });
        }
        if (scenario.afterOpen) await scenario.afterOpen(page);
        await scenario.ready(page);
        await expect(page).toHaveScreenshot(screenshot, { fullPage: true });
      });
    }
  }
}
