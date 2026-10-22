import type { Page } from "@playwright/test";
import { CANONICAL_SCENARIOS, ROOM_CODE, type ScreenshotScenario } from "./scenarios.js";
import {
  DESKTOP,
  PHONE_LARGE,
  PHONE_SMALL,
  TABLET,
  enterRoom,
  expect,
  openPage,
  test,
  type SkinId,
  type Viewport,
} from "./support.js";

/**
 * The responsive audit (#175, ADR-0020 amendment): the widths named by the
 * acceptance criteria, wider than the screenshot matrix's four viewports.
 * Heights only give the browser a window; horizontal overflow is the
 * property under test.
 */
const AUDIT_VIEWPORTS: readonly Viewport[] = [
  { width: 320, height: 640 },
  PHONE_SMALL,
  PHONE_LARGE,
  TABLET,
  { width: 860, height: 800 },
  { width: 1024, height: 768 },
  DESKTOP,
  { width: 1440, height: 900 },
];

const TARGET_MIN = 44;

async function openScenario(
  page: Page,
  scenario: ScreenshotScenario,
  viewport: Viewport,
  skin: SkinId
): Promise<void> {
  await openPage(page, {
    viewport,
    skin,
    ...(scenario.path ? { path: scenario.path } : {}),
    ...(scenario.wire ? { wire: scenario.wire } : {}),
  });
  if (scenario.wire) {
    await enterRoom(page, { mode: scenario.enter ?? "create", code: ROOM_CODE });
  }
  if (scenario.afterOpen) await scenario.afterOpen(page);
  await scenario.ready(page);
}

interface ControlBox {
  name: string;
  height: number;
  width: number;
  iconOnly: boolean;
}

/**
 * Every visible control at the current state, measured in CSS pixels. Icon
 * buttons must be square-ish targets; all buttons and inputs share the
 * 44 px minimum from the token (ADR-0022 §6).
 */
async function controlBoxes(page: Page): Promise<ControlBox[]> {
  return page.locator("button, input, select").evaluateAll((elements) =>
    elements
      .map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          name:
            element.getAttribute("aria-label") ||
            element.id ||
            (element.textContent ?? "").trim().slice(0, 24) ||
            element.tagName.toLowerCase(),
          height: rect.height,
          width: rect.width,
          iconOnly: element.classList.contains("icon-btn"),
          visible:
            style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0,
        };
      })
      .filter((control) => control.visible)
      .map(({ name, height, width, iconOnly }) => ({ name, height, width, iconOnly }))
  );
}

for (const scenario of CANONICAL_SCENARIOS) {
  for (const viewport of AUDIT_VIEWPORTS) {
    for (const skin of scenario.skins) {
      const title = `${scenario.id} · ${skin} · ${viewport.width}×${viewport.height}`;

      test(`${title} · no horizontal overflow`, async ({ page }) => {
        await openScenario(page, scenario, viewport, skin);

        const overflow = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          viewport: window.innerWidth,
        }));
        expect(overflow.document, "document scrollWidth").toBeLessThanOrEqual(overflow.viewport);
        expect(overflow.body, "body scrollWidth").toBeLessThanOrEqual(overflow.viewport);

        for (const control of await controlBoxes(page)) {
          expect(control.height, `${control.name} height`).toBeGreaterThanOrEqual(TARGET_MIN);
          if (control.iconOnly) {
            expect(control.width, `${control.name} width`).toBeGreaterThanOrEqual(TARGET_MIN);
          }
        }
      });
    }
  }
}

/**
 * The board is the drag surface, so it must be fully on screen at the two
 * viewports the acceptance criteria name — the desktop dashboard and the
 * large phone — without scrolling.
 */
for (const viewport of [DESKTOP, PHONE_LARGE]) {
  for (const skin of ["standard", "arcade"] as const) {
    test(`game board fully visible · ${skin} · ${viewport.width}×${viewport.height}`, async ({ page }) => {
      const game = CANONICAL_SCENARIOS.find((scenario) => scenario.id === "game-digram");
      if (!game) throw new Error("the game scenario is missing from the canonical matrix");

      await openScenario(page, game, viewport, skin);

      const board = await page.locator("#board").boundingBox();
      const window = page.viewportSize();
      if (!board || !window) throw new Error("the board or viewport has no box");

      expect(board.x, "board left edge").toBeGreaterThanOrEqual(0);
      expect(board.y, "board top edge").toBeGreaterThanOrEqual(0);
      expect(board.x + board.width, "board right edge").toBeLessThanOrEqual(window.width);
      expect(board.y + board.height, "board bottom edge").toBeLessThanOrEqual(window.height);
      expect(await page.evaluate(() => window.scrollY), "page scroll").toBe(0);
    });
  }
}
