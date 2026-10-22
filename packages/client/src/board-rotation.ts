/**
 * The pure Board rotation rules (#167): a player-local view transform that
 * turns the shared 4×4 board in clockwise quarter steps. The tiles are
 * permuted over the grid; the server board array, the wire protocol and the
 * score are never touched. See [GLOSSARY](../../../GLOSSARY.md): Board
 * rotation, and ADR-0002's #151 amendment.
 *
 * The forward permutation and its inverse are defined here together, so a
 * rendered cell and the server index it shows can never drift apart. The
 * client's render and wiring consume this module; the rotation state and its
 * reset rules still live in the app (issue #168).
 */

/** The client-only arrangement of the shared board: a clockwise quarter turn. */
export type BoardRotation = 0 | 90 | 180 | 270;

/** The four valid quarter turns, in cycle order. */
export const BOARD_ROTATIONS: readonly BoardRotation[] = [0, 90, 180, 270];

/** The board is a fixed square: four rows of four cells, row-major. */
const BOARD_SIDE = 4;
const BOARD_CELLS = BOARD_SIDE * BOARD_SIDE;

/** Narrows an arbitrary number to a valid quarter turn. */
export function isBoardRotation(value: number): value is BoardRotation {
  return BOARD_ROTATIONS.some((rotation) => rotation === value);
}

/**
 * The inverse permutation: the server board index whose tile renders in
 * `cell` at `rotation`. A clockwise quarter turn maps server (row, col) to
 * rendered (col, 3 − row), so walking a rendered cell counter-clockwise
 * recovers its source.
 */
export function serverBoardIndex(cell: number, rotation: BoardRotation): number {
  let row = Math.floor(cell / BOARD_SIDE);
  let col = cell % BOARD_SIDE;
  for (let turn = 0; turn < rotation / 90; turn += 1) {
    const nextRow = BOARD_SIDE - 1 - col;
    col = row;
    row = nextRow;
  }
  return row * BOARD_SIDE + col;
}

/**
 * The forward permutation: the board as rendered at `rotation`, where each
 * grid cell shows the server tile its inverse names. The server board is
 * left untouched and every tile stays upright; only its cell changes.
 */
export function rotateBoard(board: readonly string[], rotation: BoardRotation): readonly string[] {
  const rotated: string[] = [];
  for (let cell = 0; cell < BOARD_CELLS; cell += 1) {
    rotated.push(board[serverBoardIndex(cell, rotation)] ?? "");
  }
  return rotated;
}

/**
 * The board-identity key: a round number plus the server board array. Two
 * snapshots with the same key name the same puzzle (issue #151), so the
 * local arrangement survives a reconnect for that board and resets for a
 * different one.
 */
export function boardIdentityKey(roundNumber: number, board: readonly string[]): string {
  return `${roundNumber}:${board.join("/")}`;
}
