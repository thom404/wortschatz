import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@wortschatz/shared";
import type { GestureState } from "../src/gesture.js";
import { ViewState } from "../src/view-state.js";
import {
  BOARD,
  NO_WORDS,
  ROOM_CODE,
  intermissionSnapshot,
  lobbySnapshot,
  playingSnapshot,
  roundEnded,
  roundStarted,
} from "./fixtures.js";

/**
 * The client-only View state (ADR-0024), driven as plain data: messages and
 * actions in, the three readable values out. The tests never inspect the
 * stored board key or any private field; same-board and different-board
 * behaviour is proven through the public reset rules.
 */

const OTHER_BOARD = ["Z", "U", "R", "F", "E", "L", "D", "A", "M", "I", "S", "T", "K", "O", "N", "G"];

/** A live gesture shaped like the rule module's state; its trace is a plain
 *  three-tile path so identity is easy to observe. */
function liveGesture(): GestureState {
  return { pointerId: 1, pointerCancelled: false, touchId: null, trace: [0, 1, 4] };
}

function playing(board: readonly string[], roundNumber: number) {
  return playingSnapshot({
    code: ROOM_CODE,
    selfSeatId: 1,
    nickname: "Lena",
    role: "player",
    board,
    roundNumber,
  });
}

describe("View state (ADR-0024)", () => {
  it("reset() returns all three values to their defaults", () => {
    const view = new ViewState();
    view.apply(roundStarted(BOARD, 1));
    view.revealOrder = "points";
    view.rotate();
    view.gesture = liveGesture();

    view.reset();

    expect(view.revealOrder).toBe("length");
    expect(view.boardRotation).toBe(0);
    expect(view.gesture).toBeNull();

    // The stored board identity started over too: a later Snapshot naming
    // the board seen before the reset counts as a new board.
    view.rotate();
    view.apply(playing(BOARD, 1));
    expect(view.boardRotation).toBe(0);
  });

  it("a Snapshot always resets the reveal order, keeping the rotation and a live Gesture for the same board", () => {
    const view = new ViewState();
    view.apply(roundStarted(BOARD, 1));
    view.revealOrder = "points";
    view.rotate();
    const gesture = liveGesture();
    view.gesture = gesture;

    view.apply(playing(BOARD, 1));

    expect(view.revealOrder).toBe("length");
    expect(view.boardRotation).toBe(90);
    expect(view.gesture).toBe(gesture);

    // The finished-round channel names the same board too: an intermission
    // reconnect keeps the arrangement and the live gesture it was holding.
    view.revealOrder = "alphabet";
    view.rotate();
    view.gesture = gesture;
    view.apply(
      intermissionSnapshot({
        code: ROOM_CODE,
        selfSeatId: 1,
        nickname: "Lena",
        board: BOARD,
        reveal: NO_WORDS,
        roundNumber: 1,
      })
    );
    expect(view.revealOrder).toBe("length");
    expect(view.boardRotation).toBe(180);
    expect(view.gesture).toBe(gesture);
  });

  it("a Snapshot naming a different board or no board resets the rotation and ends the Gesture", () => {
    const view = new ViewState();
    view.apply(roundStarted(BOARD, 1));

    view.revealOrder = "alphabet";
    view.rotate();
    view.gesture = liveGesture();
    view.apply(playing(OTHER_BOARD, 2));
    expect(view.revealOrder).toBe("length");
    expect(view.boardRotation).toBe(0);
    expect(view.gesture).toBeNull();

    view.revealOrder = "points";
    view.rotate();
    view.gesture = liveGesture();
    view.apply(lobbySnapshot({ code: ROOM_CODE, nickname: "Lena" }));
    expect(view.revealOrder).toBe("length");
    expect(view.boardRotation).toBe(0);
    expect(view.gesture).toBeNull();
  });

  it("round-start resets the rotation and ends the Gesture, while round-end keeps the rotation and reveal order", () => {
    const view = new ViewState();
    view.apply(roundStarted(BOARD, 1));
    view.revealOrder = "points";
    view.rotate();
    view.rotate();
    view.gesture = liveGesture();

    view.apply(roundStarted(OTHER_BOARD, 2));
    expect(view.revealOrder).toBe("points");
    expect(view.boardRotation).toBe(0);
    expect(view.gesture).toBeNull();

    view.rotate();
    view.gesture = liveGesture();
    view.apply(roundEnded(2, NO_WORDS));
    expect(view.revealOrder).toBe("points");
    expect(view.boardRotation).toBe(90);
    expect(view.gesture).toBeNull();
  });

  it("rotate() cycles 0° → 90° → 180° → 270° → 0° and ends a live Gesture", () => {
    const view = new ViewState();
    for (const expected of [90, 180, 270, 0] as const) {
      view.gesture = liveGesture();
      view.rotate();
      expect(view.boardRotation).toBe(expected);
      expect(view.gesture).toBeNull();
    }
  });

  it("every other message changes nothing", () => {
    const view = new ViewState();
    view.revealOrder = "alphabet";
    view.rotate();
    const gesture = liveGesture();
    view.gesture = gesture;

    const messages: ServerMessage[] = [
      { type: "tick", remaining: 90_000, deadline: 20_000 },
      {
        type: "score-update",
        roundNumber: 1,
        scores: [{ seatId: 1, nickname: "Lena", roundScore: 7, cumulativeScore: 7 }],
      },
      {
        type: "player-joined",
        player: { seatId: 2, nickname: "Ben", role: "player", cumulativeScore: 0, connected: true },
      },
      { type: "player-left", seatId: 2, nickname: "Ben" },
      { type: "player-disconnected", seatId: 2, nickname: "Ben" },
      { type: "host-changed", hostSeatId: 2 },
      { type: "word-accepted", word: "HAT", points: 5 },
      { type: "wiki-links", roundNumber: 1, links: { hat: "https://de.wiktionary.org/wiki/Hat" } },
      { type: "error", code: "invalid-word" },
      { type: "kicked" },
      { type: "room-ended", reason: "host-closed" },
    ];

    for (const msg of messages) view.apply(msg);

    expect(view.revealOrder).toBe("alphabet");
    expect(view.boardRotation).toBe(90);
    expect(view.gesture).toBe(gesture);
  });
});
