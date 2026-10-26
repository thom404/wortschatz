import { describe, expect, it } from "vitest";
import type { PlayerInfo, RevealPayload, ServerMessage, SnapshotMsg } from "@wortschatz/shared";
import { GameStore, type DeltaKind } from "../src/store.js";
import { BOARD, ROOM_CODE } from "./fixtures.js";

/**
 * The store is the single reducer for server messages. These tests drive it
 * directly — no DOM, no connection — and assert the resulting client state
 * and the play-time versus structural classification that the renderer uses.
 */

const REVEAL: RevealPayload = {
  groups: [{ length: 3, words: [{ word: "ort", points: 4, foundBy: [1] }] }],
};

function seat(seatId: number, nickname: string): PlayerInfo {
  return { seatId, nickname, role: "player", cumulativeScore: 0, connected: true };
}

function playingSnapshot(): SnapshotMsg {
  return {
    type: "snapshot",
    room: { code: ROOM_CODE, phase: "playing", hostSeatId: 1, roundNumber: 1 },
    self: { seatId: 1, nickname: "Lena", role: "player", cumulativeScore: 0 },
    players: [seat(1, "Lena"), seat(2, "Ben")],
    round: { roundNumber: 1, board: BOARD, deadline: 10_000 },
  };
}

function intermissionSnapshot(): SnapshotMsg {
  return {
    type: "snapshot",
    room: { code: ROOM_CODE, phase: "intermission", hostSeatId: 1, roundNumber: 1 },
    self: { seatId: 1, nickname: "Lena", role: "player", cumulativeScore: 0 },
    players: [seat(1, "Lena"), seat(2, "Ben")],
    finishedRound: { roundNumber: 1, board: BOARD, reveal: REVEAL, deadline: 0 },
  };
}

describe("GameStore.apply", () => {
  it("applies a playing snapshot and classifies it as structural", () => {
    const store = new GameStore();
    expect(store.apply(playingSnapshot())).toBe<DeltaKind>("structural");
    expect(store.code).toBe(ROOM_CODE);
    expect(store.phase).toBe("playing");
    expect(store.roundNumber).toBe(1);
    expect(store.players.map((p) => p.nickname)).toEqual(["Lena", "Ben"]);
    expect(store.round?.board).toEqual(BOARD);
    expect(store.deadline).toBe(10_000);
  });

  it("applies the play-time deltas — tick, score-update, word-accepted — and classifies them as play-time", () => {
    const store = new GameStore();
    store.apply(playingSnapshot());

    expect(store.apply({ type: "tick", remaining: 90_000, deadline: 20_000 })).toBe("play-time");
    expect(store.deadline).toBe(20_000);
    expect(store.phase).toBe("playing"); // a tick only re-anchors the round clock

    expect(
      store.apply({
        type: "score-update",
        roundNumber: 1,
        scores: [{ seatId: 1, nickname: "Lena", roundScore: 7, cumulativeScore: 7 }],
      })
    ).toBe("play-time");
    expect(store.selfRoundScore).toBe(7);

    expect(store.apply({ type: "word-accepted", word: "HAU", points: 5 })).toBe("play-time");
    expect(store.roundWords.get("HAU")).toBe(5);
    expect(store.selfRoundScore).toBe(12);
  });

  it("classifies every other server message as structural and applies its state change", () => {
    const store = new GameStore();
    store.apply(playingSnapshot());
    const structural: ServerMessage[] = [
      { type: "round-start", round: { roundNumber: 2, board: BOARD, deadline: 30_000 } },
      { type: "round-end", roundNumber: 2, reveal: REVEAL },
      { type: "player-joined", player: seat(3, "Cem") },
      { type: "player-left", seatId: 3, nickname: "Cem" },
      { type: "player-disconnected", seatId: 2, nickname: "Ben" },
      { type: "host-changed", hostSeatId: 2 },
      { type: "error", code: "invalid-word" },
      { type: "kicked" },
      { type: "room-ended", reason: "host-closed" },
    ];

    for (const msg of structural) expect(store.apply(msg)).toBe<DeltaKind>("structural");

    expect(store.roundNumber).toBe(2);
    expect(store.phase).toBe("intermission");
    expect(store.players.map((p) => p.nickname)).toEqual(["Lena", "Ben"]);
    expect(store.players[1]!.connected).toBe(false);
    expect(store.hostSeatId).toBe(2);
    expect(store.lastError?.code).toBe("invalid-word");
    expect(store.outcome).toBe("room-ended");
  });

  it("notifies subscribers with the same classification it returns", () => {
    const store = new GameStore();
    const seen: DeltaKind[] = [];
    store.subscribe((kind) => seen.push(kind));

    store.apply(playingSnapshot());
    store.apply({ type: "tick", remaining: 90_000, deadline: 20_000 });
    store.apply({ type: "player-joined", player: seat(3, "Cem") });

    expect(seen).toEqual(["structural", "play-time", "structural"]);
  });

  it("a reconnecting client's intermission snapshot carries a zero pause deadline", () => {
    const store = new GameStore();
    expect(store.apply(intermissionSnapshot())).toBe<DeltaKind>("structural");

    expect(store.phase).toBe("intermission");
    expect(store.deadline).toBe(0);
    expect(store.round?.board).toEqual(BOARD);
    expect(store.round?.deadline).toBe(0);
    expect(store.finishedRound?.reveal).toEqual(REVEAL);
  });

  it("a round-end delta enters the pause with a zero deadline", () => {
    const store = new GameStore();
    store.apply(playingSnapshot());
    expect(store.apply({ type: "round-end", roundNumber: 1, reveal: REVEAL })).toBe<DeltaKind>("structural");

    expect(store.phase).toBe("intermission");
    expect(store.deadline).toBe(0);
  });
});
