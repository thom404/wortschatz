import { describe, expect, it } from "vitest";
import {
  BOARD_ROTATIONS,
  boardIdentityKey,
  isBoardRotation,
  rotateBoard,
  serverBoardIndex,
  type BoardRotation,
} from "../src/board-rotation.js";

/**
 * The pure Board rotation rules (#167). The tests read the module's public
 * surface only: the rotated board and the cell→server-index inverse, never a
 * private lookup table. A distinct A–P board makes the clockwise arrangement
 * unambiguous, and the index board pins the permutation cell by cell.
 */

const BOARD = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"] as const;

/** The same tiles laid clockwise by 0°, 90°, 180° and 270°. */
const CLOCKWISE: Record<BoardRotation, readonly string[]> = {
  0: BOARD,
  90: ["M", "I", "E", "A", "N", "J", "F", "B", "O", "K", "G", "C", "P", "L", "H", "D"],
  180: ["P", "O", "N", "M", "L", "K", "J", "I", "H", "G", "F", "E", "D", "C", "B", "A"],
  270: ["D", "H", "L", "P", "C", "G", "K", "O", "B", "F", "J", "N", "A", "E", "I", "M"],
};

/** A board whose cell values are their own indices, so a rotated cell names
 *  the server index it shows. */
const INDICES = Array.from({ length: 16 }, (_, cell) => String(cell));

describe("board rotation module (#167)", () => {
  it("exports the four quarter turns in cycle order and narrows only those", () => {
    expect(BOARD_ROTATIONS).toEqual([0, 90, 180, 270]);
    for (const rotation of BOARD_ROTATIONS) {
      expect(isBoardRotation(rotation)).toBe(true);
    }
    for (const value of [-90, -1, 1, 45, 90.5, 135, 360, Number.NaN]) {
      expect(isBoardRotation(value)).toBe(false);
    }
  });

  it("lays a known board out clockwise at every quarter turn", () => {
    for (const rotation of BOARD_ROTATIONS) {
      expect(rotateBoard(BOARD, rotation)).toEqual(CLOCKWISE[rotation]);
    }
  });

  it("round-trips forward and inverse for all four rotations and all sixteen cells", () => {
    for (const rotation of BOARD_ROTATIONS) {
      const rendered = rotateBoard(INDICES, rotation);
      expect([...rendered].map(Number).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 16 }, (_, cell) => cell)
      );

      for (let cell = 0; cell < 16; cell += 1) {
        // Rendered cell → server index.
        const source = serverBoardIndex(cell, rotation);
        expect(rendered[cell]).toBe(String(source));

        // Forward ∘ inverse returns the same rendered cell.
        expect(rendered.indexOf(String(source))).toBe(cell);
        expect(serverBoardIndex(rendered.indexOf(String(source)), rotation)).toBe(source);

        // The known board shows exactly the server tile that inverse names.
        expect(rotateBoard(BOARD, rotation)[cell]).toBe(BOARD[source]);
      }
    }
  });

  it("builds the board-identity key from the round number and the board", () => {
    expect(boardIdentityKey(1, BOARD)).toBe(`1:${BOARD.join("/")}`);
    expect(boardIdentityKey(2, ["A", "B", "C"])).toBe("2:A/B/C");
    expect(boardIdentityKey(1, BOARD)).not.toBe(boardIdentityKey(2, BOARD));
    expect(boardIdentityKey(1, BOARD)).not.toBe(boardIdentityKey(1, CLOCKWISE[90]));
  });
});
