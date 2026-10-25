import { describe, expect, test } from "vitest";
import { seatInfo, type Seat } from "../src/state.js";

/** A complete seat; only the fields the projection reads vary per test. */
function seat(over: Partial<Seat> = {}): Seat {
  return {
    seatId: 0,
    nickname: "Lena",
    role: "player",
    cumulativeScore: 0,
    token: "",
    present: true,
    sockets: new Set(),
    joinedAt: 0,
    absentRound: null,
    autoReleased: false,
    roundWords: new Set(),
    roundScore: 0,
    ...over,
  };
}

describe("seat-to-player projection", () => {
  test("carries every wire field of a seat, with presence as connectedness", () => {
    const projected = seatInfo(
      seat({ seatId: 7, nickname: "Aylin", role: "spectator", cumulativeScore: 42, present: false })
    );

    expect(projected).toEqual({
      seatId: 7,
      nickname: "Aylin",
      role: "spectator",
      cumulativeScore: 42,
      connected: false,
    });
  });
});
