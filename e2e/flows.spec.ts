import {
  intermissionSnapshot,
  lobbySnapshot,
  playingSnapshot,
  seat,
} from "../packages/client/tests/fixtures.js";
import { BOARD_DIGRAM, BOARD_DRAG, REVEAL, ROOM_CODE } from "./scenarios.js";
import { DESKTOP, FIXED_NOW, expect, openPage, test } from "./support.js";

/**
 * The five core flows (#156): behavior through the real browser UI, asserted
 * on the wire rather than on pixels, so the visual layer never replaces the
 * fast behavior layer.
 */

test("create room → lobby", async ({ page }) => {
  const wire = await openPage(page, {
    viewport: DESKTOP,
    skin: "standard",
    wire: {
      onMessage(msg, ws) {
        if (msg.type !== "create-room") return;
        ws.send(
          JSON.stringify(lobbySnapshot({ code: ROOM_CODE, nickname: msg.nickname, seatId: 1, hostSeatId: 1 }))
        );
      },
    },
  });

  await page.locator("#mk-nick").fill("Lena");
  await page.locator("#mk-btn").click();

  await expect(page.locator("#screen h1")).toHaveText(`Raum ${ROOM_CODE}`);
  await expect(page.locator("#start-btn")).toBeVisible();
  expect(wire.received.find((m) => m.type === "create-room")).toMatchObject({
    type: "create-room",
    nickname: "Lena",
  });
});

test("deep-link join", async ({ page }) => {
  const wire = await openPage(page, {
    viewport: DESKTOP,
    skin: "standard",
    path: `/r/${ROOM_CODE}`,
    wire: {
      onMessage(msg, ws) {
        if (msg.type !== "join") return;
        ws.send(
          JSON.stringify(
            lobbySnapshot({
              code: ROOM_CODE,
              nickname: msg.nickname,
              seatId: 2,
              hostSeatId: 1,
              players: [seat({ seatId: 1, nickname: "Lena" }), seat({ seatId: 2, nickname: msg.nickname })],
            })
          )
        );
      },
    },
  });

  await page.locator("#jn-nick").fill("Jonas");
  await page.locator("#jn-btn").click();

  await expect(page.locator("#screen")).toContainText("Warte auf den Gastgeber");
  expect(wire.received.find((m) => m.type === "join")).toMatchObject({
    type: "join",
    code: ROOM_CODE,
    nickname: "Jonas",
  });
});

test("skin switch survives reload", async ({ page }) => {
  await openPage(page, { viewport: DESKTOP });

  await expect(page.locator("body")).toHaveAttribute("data-skin", "standard");
  await page.locator("#skin-select").selectOption("arcade");
  await expect(page.locator("body")).toHaveAttribute("data-skin", "arcade");

  await page.reload();

  await expect(page.locator("body")).toHaveAttribute("data-skin", "arcade");
  await expect(page.locator("#skin-select")).toHaveValue("arcade");
});

test("drag → submit-word", async ({ page }) => {
  const wire = await openPage(page, {
    viewport: DESKTOP,
    skin: "standard",
    wire: {
      messages: [
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

  await page.locator("#mk-nick").fill("Lena");
  await page.locator("#mk-btn").click();

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
  const wire = await openPage(page, {
    viewport: DESKTOP,
    skin: "standard",
    wire: {
      messages: [
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

  await page.locator("#mk-nick").fill("Lena");
  await page.locator("#mk-btn").click();

  await expect(page.locator("#start-btn")).toBeVisible();
  await page.locator("#start-btn").click();

  await expect.poll(() => wire.received.some((m) => m.type === "start-round")).toBe(true);
});
