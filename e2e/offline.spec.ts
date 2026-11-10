import type { Page } from "@playwright/test";
import { COPY, NO_WORDS, ROOM_CODE, playingSnapshot, roundEnded } from "../packages/client/tests/fixtures.js";
import { BOARD_DIGRAM } from "./scenarios.js";
import { DESKTOP, FIXED_NOW, PHONE_LARGE, enterRoom, expect, openPage, test } from "./support.js";

/**
 * The installable app from outside (#260, ADR-0029): one production-build
 * spec for the offline shell, the waiting update and the Home install card.
 * It is the only browser spec that lets service workers run; every other
 * spec keeps them blocked so screenshot baselines stay deterministic.
 */

test.use({ serviceWorkers: "allow" });

test.describe.configure({ mode: "serial" });

const UPDATE_NOTICE = "Neue Version verfügbar.";
const OFFLINE_NOTICE = "Du bist offline.";
const INSTALL_DISMISSED_KEY = "wordament:install-dismissed";

/** Dispatches the browser's install-prompt event through the real window
 *  boundary; Chromium does not offer it in headless mode. */
async function offerInstallPrompt(
  page: Page,
  outcome: "accepted" | "dismissed" = "dismissed"
): Promise<void> {
  await page.evaluate((choice) => {
    const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt(): Promise<void>;
      readonly userChoice: Promise<{ outcome: string; platform: string }>;
    };
    Object.defineProperties(event, {
      prompt: { value: async () => {} },
      userChoice: { value: Promise.resolve({ outcome: choice, platform: "web" }) },
    });
    window.dispatchEvent(event);
  }, outcome);
}

/** Serves a byte-different worker on a second registration URL, then asks
 *  the browser to install it beside the controlling worker and waits for it
 *  to reach `waiting`. */
async function waitForWaitingWorker(page: Page): Promise<void> {
  const context = page.context();
  let serveUpdate = false;
  await context.route("**/sw.js*", async (route) => {
    if (!serveUpdate) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: `${body}\n// update proof ${Date.now()}\n` });
  });
  try {
    serveUpdate = true;
    await page.evaluate(async () => {
      await navigator.serviceWorker.register(`/sw.js?update-proof=${Date.now()}`);
    });
    await expect
      .poll(async () =>
        page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))
      )
      .toBe(true);
  } finally {
    await context.unroute("**/sw.js*");
  }
}

test("the stored shell opens with the network disabled and says Du bist offline.", async ({ page }) => {
  await openPage(page, { viewport: PHONE_LARGE });

  // The first online visit installs and activates the shell. One more
  // navigation lets that active worker take control of the document, after
  // which the shell is all the browser needs.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator("#screen h1")).toHaveText(COPY.home.title);

  await page.context().setOffline(true);
  await page.goto("/");

  await expect(page.locator("#screen h1")).toHaveText(COPY.home.title);
  await expect(page.locator("#notice-status")).toHaveText(OFFLINE_NOTICE);
});

test("a waiting worker announces Neue Version verfügbar. after the Round", async ({ page }) => {
  const wire = await openPage(page, {
    viewport: DESKTOP,
    wire: {
      messages: [
        playingSnapshot({
          code: ROOM_CODE,
          selfSeatId: 1,
          nickname: "Lena",
          role: "player",
          board: BOARD_DIGRAM,
          deadline: FIXED_NOW + 100_000,
        }),
      ],
    },
  });

  // A page controlled by the active worker is what makes the next worker
  // wait instead of activating immediately.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await enterRoom(page, { mode: "create", nickname: "Lena" });
  await expect(page.locator("#countdown")).toBeVisible();

  await waitForWaitingWorker(page);
  await expect(page.locator("#update-notice")).toBeHidden();

  wire.send(roundEnded(1, NO_WORDS));
  await expect(page.locator("#update-notice")).toBeVisible();
  await expect(page.locator("#update-notice")).toContainText(UPDATE_NOTICE);
  await expect(page.locator("#update-reload-btn")).toHaveText("Neu laden");
});

test("the install card appears, remembers Später and hides after install", async ({ page }) => {
  await openPage(page, { viewport: PHONE_LARGE });
  await expect(page.locator(".install-card")).toHaveCount(0);

  await offerInstallPrompt(page);
  await expect(page.locator(".install-card")).toBeVisible();
  await expect(page.locator("#install-title")).toHaveText("Startbildschirm");
  await expect(page.locator("#install-btn")).toHaveText("Installieren");

  await page.locator("#install-dismiss-btn").click();
  await expect(page.locator(".install-card")).toHaveCount(0);

  await page.reload();
  await expect(page.locator("#screen h1")).toHaveText(COPY.home.title);
  await offerInstallPrompt(page);
  await expect(page.locator(".install-card")).toHaveCount(0);

  // A later visit with a cleared dismissal offers installation again; an
  // accepted prompt hides the card for good.
  await page.evaluate((key) => localStorage.removeItem(key), INSTALL_DISMISSED_KEY);
  await page.reload();
  await offerInstallPrompt(page, "accepted");
  await expect(page.locator(".install-card")).toBeVisible();
  await page.locator("#install-btn").click();
  await expect(page.locator(".install-card")).toHaveCount(0);
});
