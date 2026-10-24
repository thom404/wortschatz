import type { ServerMessage } from "@wortschatz/shared";
import { BOARD_ROTATIONS, boardIdentityKey, type BoardRotation } from "./board-rotation.js";
import type { GestureState } from "./gesture.js";

/**
 * The client-only view state (ADR-0024): the Intermission reveal order, the
 * player-local Board rotation and the live Gesture. It reads the same server
 * messages as the store but owns no store handle, DOM or timer; it only
 * decides when each value resets.
 *
 * The reset table is the whole lifecycle:
 * - `reset()` returns every value to its default, once per Room visit.
 * - `snapshot` always returns the reveal order to the grouped default. A
 *   board key that differs from the last one (including a Snapshot that
 *   names no board) resets the rotation and ends the Gesture; a Snapshot for
 *   the same board keeps both.
 * - `round-start` resets the rotation, ends the Gesture and records the new
 *   board.
 * - `round-end` ends the Gesture and keeps the rotation, reveal order and
 *   board key, so that round's Intermission shows the arrangement played.
 * - Every other message changes nothing.
 */
export type RevealOrder = "length" | "points" | "alphabet";

export class ViewState {
  /** The chosen reveal order; `length` is the server's grouped default. */
  revealOrder: RevealOrder = "length";
  /** The player-local arrangement of the current board. */
  boardRotation: BoardRotation = 0;
  /** The live drag, or `null` between gestures. */
  gesture: GestureState | null = null;

  /** The identity of the last board this module saw, from the one key
   *  function in the Board rotation module. Never wire state. */
  private boardKey = "";

  /** Applies one server message to the client-only state. Called before the
   *  store applies the same message, because the store's notification
   *  renders synchronously. */
  apply(msg: ServerMessage): void {
    switch (msg.type) {
      case "snapshot": {
        this.revealOrder = "length";
        const round = msg.round ?? msg.finishedRound;
        const key = round ? boardIdentityKey(round.roundNumber, round.board) : "";
        if (key !== this.boardKey) {
          this.boardRotation = 0;
          this.gesture = null;
        }
        this.boardKey = key;
        break;
      }
      case "round-start":
        this.boardRotation = 0;
        this.gesture = null;
        this.boardKey = boardIdentityKey(msg.round.roundNumber, msg.round.board);
        break;
      case "round-end":
        this.gesture = null;
        break;
      default:
        break;
    }
  }

  /** Returns every value to its default: a fresh Room visit. */
  reset(): void {
    this.revealOrder = "length";
    this.boardRotation = 0;
    this.gesture = null;
    this.boardKey = "";
  }

  /** Advances the rotation one clockwise quarter turn and ends any live
   *  Gesture, so a trace can never span two arrangements. */
  rotate(): void {
    const next = (BOARD_ROTATIONS.indexOf(this.boardRotation) + 1) % BOARD_ROTATIONS.length;
    this.boardRotation = BOARD_ROTATIONS[next]!;
    this.gesture = null;
  }
}
