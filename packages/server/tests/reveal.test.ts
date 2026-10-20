import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SnapshotMsg } from "@wortschatz/shared";
import { PlaceholderDictionary } from "../src/defaults.js";
import { createRoom, joinPlayer, makeScene, type Scene } from "./scene.js";

/**
 * Reveal tests ride the single server seam: real websocket clients see the
 * `round-end` payload and the intermission `snapshot`'s `finishedRound` —
 * the only two channels a findable-word reveal travels on. The enumerated
 * word list comes in through the board-generation seam (round state, ADR-0003
 * retention); per-word points are the #6 scoring engine's letter sums, worked
 * out by hand: t1·e1·s1·t1 = 4, s1·a1·a1·t1 = 4, w3·o2·r1·t1 = 7,
 * o2·r1·t1 = 4.
 */
let scene: Scene;
beforeEach(async () => {
  scene = await makeScene({
    roundMs: 1600,
    tickIntervalMs: 250,
    roomEmptyGraceMs: 60_000,
    roomIdleMs: 30 * 60_000,
    dictionary: new PlaceholderDictionary(["test", "wort", "ort"]),
    // Deliberately scrambled; the reveal must regroup by length ascending.
    generateBoard: () => ({
      board: ["t", "e", "s", "t", "w", "o", "r", "t", "z", "z", "a", "a", "b", "b", "c", "c"],
      words: ["saat", "wort", "ort", "test"],
    }),
  });
});
afterEach(async () => {
  await scene.stop();
});

async function playedRound() {
  const { host, snap: hostSnap } = await createRoom(scene, "Hansi");
  const { player, snap: playerSnap } = await joinPlayer(scene, hostSnap.room.code, "Gretl");
  host.send({ type: "start-round", reqId: 1 });
  await host.expect((m) => m.type === "round-start");
  host.send({ type: "submit-word", word: "ort", reqId: 2 });
  await host.expect((m) => m.type === "word-accepted" && m.reqId === 2);
  host.send({ type: "submit-word", word: "test", reqId: 3 });
  await host.expect((m) => m.type === "word-accepted" && m.reqId === 3);
  player.send({ type: "submit-word", word: "wort", reqId: 4 });
  await player.expect((m) => m.type === "word-accepted" && m.reqId === 4);
  // Per-seat dedupe lets the second seat find it too: the multi-finder case.
  player.send({ type: "submit-word", word: "ort", reqId: 5 });
  await player.expect((m) => m.type === "word-accepted" && m.reqId === 5);
  return { host, hostSnap, playerSnap };
}

function expectedReveal(hostSeat: number, playerSeat: number) {
  return {
    groups: [
      { length: 3, words: [{ word: "ort", points: 4, foundBy: [hostSeat, playerSeat] }] },
      {
        length: 4,
        words: [
          { word: "saat", points: 4, foundBy: [] },
          { word: "test", points: 4, foundBy: [hostSeat] },
          { word: "wort", points: 7, foundBy: [playerSeat] },
        ],
      },
    ],
  };
}

describe("round-end reveal", () => {
  test("findable words grouped by length ascending, scored, found-by seat ids, missed words present", async () => {
    const { host, hostSnap, playerSnap } = await playedRound();
    const end = (await host.expect((m) => m.type === "round-end", 6000)) as {
      reveal: unknown;
    };
    expect(end.reveal).toEqual(expectedReveal(hostSnap.self.seatId, playerSnap.self.seatId));
  });
});

describe("identical reveal across channels", () => {
  test("a late joiner gets the finished round's standing as a room-wide score-update on join", async () => {
    const { host, hostSnap, playerSnap } = await playedRound();
    const end = (await host.expect((m) => m.type === "round-end", 6000)) as unknown as {
      roundNumber: number;
    };

    // A brand-new seat joining during the intermission: the room's finished
    // round never scored it, yet its screen must read the same standings as
    // everyone else's — a room-wide score-update re-anchors them all.
    const late = await joinPlayer(scene, hostSnap.room.code, "Spät");
    const scores = (await late.player.expect((m) => m.type === "score-update", 2000)) as unknown as {
      roundNumber: number;
      scores: { seatId: number; roundScore: number; cumulativeScore: number }[];
    };
    const bySeat = new Map(scores.scores.map((s) => [s.seatId, s]));
    expect(scores.roundNumber).toBe(end.roundNumber);
    const pick = (s: { seatId: number; roundScore: number; cumulativeScore: number }) => ({
      seatId: s.seatId,
      roundScore: s.roundScore,
      cumulativeScore: s.cumulativeScore,
    });
    expect(pick(bySeat.get(hostSnap.self.seatId)!)).toEqual({
      seatId: hostSnap.self.seatId,
      roundScore: 8, // ort (4) + test (4)
      cumulativeScore: 8,
    });
    expect(pick(bySeat.get(playerSnap.self.seatId)!)).toEqual({
      seatId: playerSnap.self.seatId,
      roundScore: 11, // wort (7) + ort (4)
      cumulativeScore: 11,
    });
  });

  test("intermission snapshot carries the payload round-end carried: late joiner and reconnecter alike", async () => {
    const { host, hostSnap, playerSnap } = await playedRound();
    const end = (await host.expect((m) => m.type === "round-end", 6000)) as {
      reveal: unknown;
    };
    const want = expectedReveal(hostSnap.self.seatId, playerSnap.self.seatId);
    expect(end.reveal).toEqual(want);

    // A brand-new seat joining during intermission.
    const late = await joinPlayer(scene, hostSnap.room.code, "Spät");
    // A second socket for the host's still-live seat, reclaimed by token.
    const re = await scene.makeClient();
    re.send({
      type: "join",
      code: hostSnap.room.code,
      nickname: "IGNORED",
      token: hostSnap.self.token!,
      reqId: 40,
    });
    const reSnap = (await re.expect(
      (m) => m.type === "snapshot" && m.reqId === 40
    )) as unknown as SnapshotMsg;

    expect(late.snap.finishedRound!.reveal).toEqual(end.reveal);
    expect(reSnap.finishedRound!.reveal).toEqual(end.reveal);
    expect(reSnap.self.seatId).toBe(hostSnap.self.seatId);
  });
});
