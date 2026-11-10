import { tileValues } from "@wortschatz/shared";
import { rotateBoard, type BoardRotation } from "../board-rotation.js";
import { displayTile } from "../display.js";
import { escapeHtml } from "../escape.js";
import { rotateIcon } from "../icons.js";
import type { ViewState } from "../view-state.js";
import { iconButtonHtml } from "./controls.js";

/** The board presentation shared by Game and Intermission (ADR-0002,
 *  ADR-0030): tile and board HTML, the visible point display, the computed
 *  gap measurement, the rotation control and the in-place repaint. */

/** The German points phrase for a tile: singular at one point, an `oder`
 *  pair when the spellings differ, plural otherwise (issue #142). Equal
 *  either/or variants collapse exactly as the visible number does. */
function pointsText(values: readonly number[]): string {
  const first = values[0] ?? 0;
  if (!values.every((v) => v === first)) return `${values.join(" oder ")} Punkte`;
  return first === 1 ? "1 Punkt" : `${first} Punkte`;
}

/** The visible corner number: differing either/or variants join with `/` in
 *  letter order; equal variants (and every other tile kind) collapse to one. */
function pointsDisplay(values: readonly number[]): string {
  const first = values[0] ?? 0;
  return values.every((v) => v === first) ? String(first) : values.join("/");
}

/**
 * One board tile: the displayed letters, the points in the old index corner
 * (hidden from assistive technology, since the tile's label already carries
 * them) and the whole tile as the hover target. Both the game and
 * intermission boards render through this one path (ADR-0002).
 */
function tileHtml(t: string): string {
  const letters = displayTile(t);
  const values = tileValues(t);
  const points = pointsText(values);
  const label = `${letters}, ${points}`;
  return `<div class="tile" title="${escapeHtml(points)}" aria-label="${escapeHtml(label)}">${escapeHtml(letters)}<span class="pts" aria-hidden="true">${escapeHtml(pointsDisplay(values))}</span></div>`;
}

/** The 4×4 board both screens share. Font sizing is one content-independent
 *  value on the grid container (ADR-0002): per-tile `em` resolves against
 *  the parent and breaks, and the tile mix must never move the type scale.
 *  Rotation only permutes the cells (ADR-0002 amendment #151): the tile
 *  markup stays upright and the server board array is never reordered. */
export function boardHtml(board: readonly string[], rotation: BoardRotation): string {
  return `<div id="board" class="board" data-rotation="${rotation}">${boardTilesHtml(board, rotation)}</div>`;
}

/** The tiles in rotated render order: each cell shows the tile the module's
 *  forward permutation places there, so the arrangement turns while every
 *  glyph, corner value and tile identity stays as authored. */
export function boardTilesHtml(board: readonly string[], rotation: BoardRotation): string {
  if (board.length === 0) return "";
  return rotateBoard(board, rotation).map(tileHtml).join("");
}

/**
 * Measures the board's gap once, after a board has rendered (ADR-0002 §20),
 * returning it instead of writing it onto a shared record. The CSS
 * `--board-gap` token is the single source of the drag clear-hit margin, so
 * the board's computed gap is authoritative and no second literal copies it.
 */
export function measureBoardGap(root: HTMLElement): number {
  const board = root.querySelector<HTMLElement>("#board");
  if (!board) return 0;
  const computed = getComputedStyle(board);
  const gap = computed.gap || computed.columnGap || computed.getPropertyValue("--board-gap");
  return Number.parseFloat(gap) || 0;
}

/** The single cycling rotation control (ADR-0002 #174): each press turns
 *  the board 90° clockwise. The name never changes with the angle; the
 *  board's `data-rotation` is the machine-readable live value. */
const ROTATE_LABEL = "Spielfeld um 90° drehen";

export function boardRotationHtml(): string {
  return iconButtonHtml({
    id: "board-rotation",
    className: "icon-btn board-rotation",
    icon: rotateIcon,
    label: ROTATE_LABEL,
  });
}

/** Re-renders only the board tiles in place: the board element survives, as
 *  do the timer, scoreboard and found-word chips around it. The stable
 *  control needs no pressed-state repaint. */
export function repaintBoard(root: HTMLElement, board: readonly string[], rotation: BoardRotation): void {
  const el = root.querySelector<HTMLElement>("#board");
  if (el) {
    el.dataset.rotation = String(rotation);
    el.innerHTML = boardTilesHtml(board, rotation);
  }
}

/** Wires the one rotation button to an arrangement-only repaint: no store
 *  notification and no wire message, so the board data, score and timer
 *  identity stay untouched. View state owns the quarter turn and ends any
 *  live gesture first, so a trace can never span two arrangements
 *  (issue #151). The repaint callback lets each screen restore what it owns
 *  (Game repaints its trace; Intermission needs nothing). */
export function wireBoardRotation(
  root: HTMLElement,
  board: readonly string[],
  view: ViewState,
  repaint: () => void
): void {
  const button = root.querySelector<HTMLButtonElement>("#board-rotation");
  if (!button) return;
  button.onclick = () => {
    view.rotate();
    repaintBoard(root, board, view.boardRotation);
    repaint();
  };
}
