import type { Page } from "@playwright/test";
import { ROOM_CODE, playingSnapshot, seat, type Scene } from "../packages/client/tests/fixtures.js";
import { BOARD_DIGRAM } from "./scenarios.js";
import { DESKTOP, FIXED_NOW, PHONE_SMALL, expect, openScene, test } from "./support.js";

/**
 * The board type scale belongs to the viewport and the board surface, never to
 * the tile mix (ADR-0002). At one viewport a singles-only board, an either/or
 * board and a board with a 3-letter digram render at the same size, and every
 * tile's letters stay inside its own cell. The assertions read computed layout
 * in the production client: happy-dom cannot prove this invariant.
 */

/** A plain singles-only board. */
const BOARD_SINGLES = [
  "h",
  "a",
  "u",
  "s",
  "e",
  "n",
  "d",
  "r",
  "t",
  "i",
  "m",
  "l",
  "g",
  "o",
  "c",
  "k",
] as const;

/** The same surface with one either/or tile, whose slash must not resize it. */
const BOARD_EITHER = [
  "a/s",
  "a",
  "u",
  "s",
  "e",
  "n",
  "d",
  "r",
  "t",
  "i",
  "m",
  "l",
  "g",
  "o",
  "c",
  "k",
] as const;

function playingScene(board: readonly string[]): Scene {
  return {
    entry: { mode: "create", nickname: "Lena" },
    greeting: [snapshotFor(board)],
  };
}

function snapshotFor(board: readonly string[]) {
  return playingSnapshot({
    code: ROOM_CODE,
    selfSeatId: 1,
    nickname: "Lena",
    role: "player",
    board,
    deadline: FIXED_NOW + 100_000,
    players: [seat({ seatId: 1, nickname: "Lena" })],
  });
}

interface BoardMetrics {
  boardSize: number;
  tileSize: number;
}

async function metrics(page: Page): Promise<BoardMetrics> {
  return page.locator("#board").evaluate((board) => {
    const tile = board.querySelector<HTMLElement>(".tile");
    if (!tile) throw new Error("the board has no tile");
    return {
      boardSize: Number.parseFloat(getComputedStyle(board).fontSize),
      tileSize: Number.parseFloat(getComputedStyle(tile).fontSize),
    };
  });
}

/** Tiles whose rendered letters reach outside their own content box. */
async function overflowingTiles(page: Page): Promise<string[]> {
  return page.locator("#board .tile").evaluateAll((tiles) =>
    tiles.flatMap((tile) => {
      const text = tile.firstChild;
      if (!text) return [];
      const range = document.createRange();
      range.selectNodeContents(text);
      const textBox = range.getBoundingClientRect();
      const tileBox = tile.getBoundingClientRect();
      const style = getComputedStyle(tile);
      const left =
        tileBox.left + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft);
      const right =
        tileBox.right - Number.parseFloat(style.borderRightWidth) - Number.parseFloat(style.paddingRight);
      const top = tileBox.top + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop);
      const bottom =
        tileBox.bottom - Number.parseFloat(style.borderBottomWidth) - Number.parseFloat(style.paddingBottom);
      const tolerance = 0.5;
      const inside =
        textBox.left >= left - tolerance &&
        textBox.right <= right + tolerance &&
        textBox.top >= top - tolerance &&
        textBox.bottom <= bottom + tolerance;
      return inside ? [] : [`${(tile.textContent ?? "").trim() || "tile"} escapes its cell`];
    })
  );
}

/** The legibility floor: the singles-only baseline is 1.35rem (21.6 px). */
const LEGIBLE_MIN_PX = 20;

for (const viewport of [PHONE_SMALL, DESKTOP]) {
  for (const skin of ["standard", "arcade"] as const) {
    test(`board type is independent of tile content · ${skin} · ${viewport.width}×${viewport.height}`, async ({
      page,
    }) => {
      const wire = await openScene(page, { viewport, skin, scene: playingScene(BOARD_SINGLES) });
      await expect(page.locator("#board .tile")).toHaveCount(16);

      const singles = await metrics(page);
      expect(singles.tileSize, "tiles inherit the board scale").toBeCloseTo(singles.boardSize, 5);
      expect(singles.tileSize, "the singles baseline stays legible").toBeGreaterThanOrEqual(LEGIBLE_MIN_PX);
      expect(await overflowingTiles(page), "singles stay inside their cells").toEqual([]);

      const shapes = [
        { label: "a/s", board: BOARD_EITHER, firstTile: "a/s" },
        { label: "sch", board: BOARD_DIGRAM, firstTile: "sch" },
      ] as const;

      for (const shape of shapes) {
        wire.send(snapshotFor(shape.board));
        await expect(page.locator("#board .tile").first()).toContainText(shape.firstTile);

        const shapeMetrics = await metrics(page);
        expect(shapeMetrics.tileSize, `${shape.label} tile keeps the singles size`).toBeCloseTo(
          singles.tileSize,
          5
        );
        expect(shapeMetrics.boardSize, `${shape.label} board keeps the singles size`).toBeCloseTo(
          singles.tileSize,
          5
        );
        expect(
          shapeMetrics.tileSize,
          `${shape.label} is not below the singles baseline`
        ).toBeGreaterThanOrEqual(singles.tileSize);
        expect(await overflowingTiles(page), `${shape.label} letters stay inside their cells`).toEqual([]);
      }

      // Rotation is arrangement-only: the repaint must not restore a
      // content-derived scale (ADR-0002 amendment #151).
      await page.locator("#board-rotation").click();
      await expect(page.locator("#board")).toHaveAttribute("data-rotation", "90");
      expect((await metrics(page)).tileSize, "rotation keeps the board scale").toBeCloseTo(
        singles.tileSize,
        5
      );
      expect(await overflowingTiles(page), "rotated letters stay inside their cells").toEqual([]);
    });
  }
}
