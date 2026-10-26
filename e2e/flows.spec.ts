import {
  COPY,
  ROOM_CODE,
  intermissionSnapshot,
  lobbySnapshot,
  playingSnapshot,
  seat,
} from "../packages/client/tests/fixtures.js";
import { BOARD_DIGRAM, BOARD_DRAG, REVEAL } from "./scenarios.js";
import { DESKTOP, FIXED_NOW, expect, openMenu, openPage, openScene, test } from "./support.js";

/**
 * The core flows (#156), now including the app-owned Menü (ADR-0023): behavior through the real browser UI, asserted
 * on the wire rather than on pixels, so the visual layer never replaces the
 * fast behavior layer.
 */

test("create room → lobby", async ({ page }) => {
  const wire = await openScene(page, {
    viewport: DESKTOP,
    skin: "standard",
    scene: {
      entry: { mode: "create", nickname: "Lena" },
      greeting: [lobbySnapshot({ code: ROOM_CODE, nickname: "Lena", seatId: 1, hostSeatId: 1 })],
    },
  });

  await expect(page.locator("#screen h1")).toHaveText(COPY.lobby.title(ROOM_CODE));
  await expect(page.locator("#start-btn")).toBeVisible();
  expect(wire.received.find((m) => m.type === "create-room")).toMatchObject({
    type: "create-room",
    nickname: "Lena",
  });
});

test("deep-link join", async ({ page }) => {
  const wire = await openScene(page, {
    viewport: DESKTOP,
    skin: "standard",
    scene: {
      path: `/r/${ROOM_CODE}`,
      entry: { mode: "join", nickname: "Jonas" },
      greeting: [
        lobbySnapshot({
          code: ROOM_CODE,
          nickname: "Jonas",
          seatId: 2,
          hostSeatId: 1,
          players: [seat({ seatId: 1, nickname: "Lena" }), seat({ seatId: 2, nickname: "Jonas" })],
        }),
      ],
    },
  });

  await expect(page.locator("#screen")).toContainText(COPY.lobby.waiting);
  expect(wire.received.find((m) => m.type === "join")).toMatchObject({
    type: "join",
    code: ROOM_CODE,
    nickname: "Jonas",
  });
});

test("skin switch through the Menü survives reload", async ({ page }) => {
  await openPage(page, { viewport: DESKTOP });

  await expect(page.locator("body")).toHaveAttribute("data-skin", "standard");
  await expect(page.locator("#menu-panel")).toBeHidden();
  await openMenu(page);
  await expect(page.locator("#menu-panel .menu-version")).toHaveText(`Version 0.1.0`);
  await page.locator("#skin-select").selectOption("arcade");
  await expect(page.locator("body")).toHaveAttribute("data-skin", "arcade");

  await page.reload();

  await expect(page.locator("body")).toHaveAttribute("data-skin", "arcade");
  await openMenu(page);
  await expect(page.locator("#skin-select")).toHaveValue("arcade");
});

test("menu over a running round closes on Esc and leaves the board usable", async ({ page }) => {
  const wire = await openScene(page, {
    viewport: DESKTOP,
    skin: "standard",
    scene: {
      entry: { mode: "create", nickname: "Lena" },
      greeting: [
        playingSnapshot({
          code: ROOM_CODE,
          selfSeatId: 1,
          nickname: "Lena",
          role: "player",
          board: BOARD_DRAG,
          deadline: FIXED_NOW + 100_000,
          players: [seat({ seatId: 1, nickname: "Lena" })],
        }),
      ],
    },
  });

  // Closed, the floating surface intercepts no pointer input: only the
  // 44 px trigger is interactive.
  await expect(page.locator("#menu")).toHaveCSS("pointer-events", "none");
  await expect(page.locator("#menu-trigger")).toHaveCSS("pointer-events", "auto");
  await openMenu(page);
  await expect(page.locator("#menu-panel")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#menu-panel")).toBeHidden();
  await expect(page.locator("#menu-trigger")).toBeFocused();

  const tiles = page.locator("#board .tile");
  const boxes = await Promise.all([0, 1, 2].map(async (i) => tiles.nth(i).boundingBox()));
  const points = boxes.map((box) => {
    if (!box) throw new Error("board tile has no layout box");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  const [first, second, third] = points as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(second.x, second.y, { steps: 3 });
  await page.mouse.move(third.x, third.y, { steps: 3 });
  await page.mouse.up();

  await expect
    .poll(() => wire.received.find((m) => m.type === "submit-word"))
    .toMatchObject({ type: "submit-word", word: "hau" });
});

test("drag → submit-word", async ({ page }) => {
  const wire = await openScene(page, {
    viewport: DESKTOP,
    skin: "standard",
    scene: {
      entry: { mode: "create", nickname: "Lena" },
      greeting: [
        playingSnapshot({
          code: ROOM_CODE,
          selfSeatId: 1,
          nickname: "Lena",
          role: "player",
          board: BOARD_DRAG,
          deadline: FIXED_NOW + 100_000,
          players: [seat({ seatId: 1, nickname: "Lena" })],
        }),
      ],
    },
  });

  const tiles = page.locator("#board .tile");
  await expect(tiles).toHaveCount(16);
  const boxes = await Promise.all([0, 1, 2].map(async (i) => tiles.nth(i).boundingBox()));
  const points = boxes.map((box) => {
    if (!box) throw new Error("board tile has no layout box");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });

  const [first, second, third] = points as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(second.x, second.y, { steps: 3 });
  await page.mouse.move(third.x, third.y, { steps: 3 });
  await page.mouse.up();

  await expect
    .poll(() => wire.received.find((m) => m.type === "submit-word"))
    .toMatchObject({ type: "submit-word", word: "hau" });
});

test("intermission → start-round", async ({ page }) => {
  const wire = await openScene(page, {
    viewport: DESKTOP,
    skin: "standard",
    scene: {
      entry: { mode: "create", nickname: "Lena" },
      greeting: [
        intermissionSnapshot({
          code: ROOM_CODE,
          selfSeatId: 1,
          nickname: "Lena",
          hostSeatId: 1,
          board: BOARD_DIGRAM,
          reveal: REVEAL,
          players: [seat({ seatId: 1, nickname: "Lena" })],
        }),
      ],
    },
  });

  await expect(page.locator("#start-btn")).toBeVisible();
  await page.locator("#start-btn").click();

  await expect.poll(() => wire.received.some((m) => m.type === "start-round")).toBe(true);
});
