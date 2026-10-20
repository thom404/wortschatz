import { expect, test } from "vitest";
import { PROTOCOL } from "../src/constants.js";
import type { Board } from "../src/board.js";

test("board is a fixed 16-tile shape, row-major", () => {
  const board: Board = Array.from({ length: PROTOCOL.BOARD_SIZE }, () => "a");
  expect(board).toHaveLength(16);
});

test("constants carry the protocol's documented defaults", () => {
  expect(PROTOCOL.MAX_PLAYERS).toBe(8);
  expect(PROTOCOL.MAX_ROOMS).toBe(32);
  expect(PROTOCOL.ROUND_MS).toBe(120_000);
  expect(PROTOCOL.TICK_INTERVAL_MS).toBe(1_000);
  expect(PROTOCOL.ROOM_EMPTY_GRACE_MS).toBe(60_000);
  expect(PROTOCOL.ROOM_IDLE_MS).toBe(30 * 60_000);
  expect(PROTOCOL.MAX_PAYLOAD_BYTES).toBe(4 * 1024);
  expect(PROTOCOL.MAX_PAYLOAD_HARD_BYTES).toBe(64 * 1024);
  expect(PROTOCOL.QUOTA_WINDOW_MS).toBe(10_000);
  expect(PROTOCOL.QUOTA_MAX_MESSAGES).toBe(40);
  expect(PROTOCOL.PING_INTERVAL_MS).toBe(15_000);
  expect(PROTOCOL.PONG_GRACE_MS).toBe(45_000);
});

test("room code alphabet excludes ambiguous glyphs", () => {
  for (const ch of "0O1Iil") {
    expect(PROTOCOL.ROOM_CODE_ALPHABET).not.toContain(ch);
  }
  expect(PROTOCOL.ROOM_CODE_ALPHABET).toHaveLength(31);
});
