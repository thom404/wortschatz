import type { Page } from "@playwright/test";
import { COPY } from "../packages/client/tests/fixtures.js";
import {
  DESKTOP,
  PHONE_LARGE,
  PHONE_SMALL,
  SKINS,
  activateServiceWorker,
  expect,
  offerInstallPrompt,
  openPage,
  test,
  waitForWaitingWorker,
  type SkinId,
  type Viewport,
} from "./support.js";

/**
 * Visual records for the installed app states (#261, ADR-0029): the Home
 * install card, the waiting-worker update notice and the offline Home. This
 * is the only visual spec that opts service workers back in, because the
 * update notice and the offline Home need a real worker; the install card
 * lives beside them so the installed states share one visual home.
 */

test.use({ serviceWorkers: "allow" });

const VIEWPORTS: readonly Viewport[] = [PHONE_SMALL, PHONE_LARGE, DESKTOP];
const OFFLINE_NOTICE = "Du bist offline.";

async function openInstallCard(page: Page, viewport: Viewport, skin: SkinId): Promise<void> {
  await openPage(page, { viewport, skin });
  await offerInstallPrompt(page);
  await expect(page.locator(".install-card")).toBeVisible();
}

async function openUpdateNotice(page: Page, viewport: Viewport, skin: SkinId): Promise<void> {
  await openPage(page, { viewport, skin });
  await activateServiceWorker(page);
  await expect(page.locator("#screen h1")).toHaveText(COPY.home.title);
  await waitForWaitingWorker(page);
  await expect(page.locator("#update-notice")).toBeVisible();
}

async function openOfflineHome(page: Page, viewport: Viewport, skin: SkinId): Promise<void> {
  await openPage(page, { viewport, skin });
  await activateServiceWorker(page);
  await expect(page.locator("#screen h1")).toHaveText(COPY.home.title);
  await page.context().setOffline(true);
  await page.goto("/");
  await expect(page.locator("#screen h1")).toHaveText(COPY.home.title);
  await expect(page.locator("#notice-status")).toHaveText(OFFLINE_NOTICE);
}

for (const skin of SKINS) {
  for (const viewport of VIEWPORTS) {
    const size = `${viewport.width}×${viewport.height}`;
    const file = `${skin}-${viewport.width}x${viewport.height}`;

    test(`install card · ${skin} · ${size}`, async ({ page }) => {
      await openInstallCard(page, viewport, skin);
      await expect(page).toHaveScreenshot(`install-card-${file}.png`, { fullPage: true });
    });

    test(`update notice · ${skin} · ${size}`, async ({ page }) => {
      await openUpdateNotice(page, viewport, skin);
      await expect(page).toHaveScreenshot(`update-notice-${file}.png`, { fullPage: true });
    });

    test(`offline state · ${skin} · ${size}`, async ({ page }) => {
      await openOfflineHome(page, viewport, skin);
      await expect(page).toHaveScreenshot(`offline-state-${file}.png`, { fullPage: true });
    });
  }
}

test("install card semantics", async ({ page }) => {
  await openInstallCard(page, DESKTOP, "standard");
  await expect(page.locator(".install-card")).toMatchAriaSnapshot({ name: "install-card.aria.yml" });
});

test("update notice semantics", async ({ page }) => {
  await openUpdateNotice(page, DESKTOP, "standard");
  await expect(page.locator("#update-notice")).toMatchAriaSnapshot({ name: "update-notice.aria.yml" });
});
