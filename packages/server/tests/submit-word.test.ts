import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SnapshotMsg } from "@wortschatz/shared";
import { createRoom, FAST_CLOCK, fixedBoard, joinPlayer, makeScene, type Scene } from "./scene.js";

let scene: Scene;
beforeEach(async () => {
  scene = await makeScene(FAST_CLOCK);
});
afterEach(async () => {
  await scene.stop();
});

async function match() {
  const { host, snap } = await createRoom(scene, "Hansi");
  const { player } = await joinPlayer(scene, snap.room.code, "Gretl");
  host.send({ type: "start-round", reqId: 1 });
  const rs = await host.expect((m) => m.type === "round-start");
  expect(rs["round"].board).toEqual(fixedBoard());
  return { host, player };
}

async function accept(client: Awaited<ReturnType<typeof match>>["host"], word: string, reqId: number) {
  client.send({ type: "submit-word", word, reqId });
  return client.expect((m) => m.type === "word-accepted" && m.reqId === reqId, 4000);
}

describe("submit-word with a choice tile", () => {
  test("accepts the second reading carried alongside the first", async () => {
    const choiceScene = await makeScene({
      ...FAST_CLOCK,
      generateBoard: () => ({
        board: ["t", "a/e", "s", "t", "w", "o", "r", "t", "z", "z", "a", "a", "b", "b", "c", "c"],
        words: ["test"],
      }),
    });
    try {
      const { host, snap } = await createRoom(choiceScene, "Hansi");
      await joinPlayer(choiceScene, snap.room.code, "Gretl");
      host.send({ type: "start-round", reqId: 1 });
      await host.expect((m) => m.type === "round-start");

      host.send({ type: "submit-word", word: "tast", alternate: "test", reqId: 2 });
      const ack = await host.expect((m) => m.type === "word-accepted" && m.reqId === 2, 4000);
      expect(ack.word).toBe("test");
      expect(ack.points).toBe(4);
    } finally {
      await choiceScene.stop();
    }
  });
});

describe("submit-word", () => {
  test("valid word synchronously accepted with points, echoed reqId", async () => {
    const { host } = await match();
    const ack = await accept(host, "test", 10);
    expect(ack.word).toBe("test");
    expect(ack.points).toBe(4); // real engine: t e s t are all value 1
  });

  test("every verdict broadcasts the scoreboard room-wide", async () => {
    const { host, player } = await match();
    await accept(host, "test", 10);
    const su = await player.expect((m) => m.type === "score-update");
    expect(su.roundNumber).toBe(1);
    const scores = su.scores as { seatId: number; roundScore: number; cumulativeScore: number }[];
    const mine = scores.find((s) => s.seatId === 0)!;
    expect(mine.roundScore).toBe(4);
    expect(mine.cumulativeScore).toBe(4);
    const other = scores.find((s) => s.seatId === 1)!;
    expect(other.roundScore).toBe(0);
  });

  test("resubmitting the same word in a round is word-duplicate, not double-scored", async () => {
    const { host } = await match();
    await accept(host, "test", 10);
    host.send({ type: "submit-word", word: "test", reqId: 11 });
    const err = await host.expect((m) => m.type === "error" && m.reqId === 11);
    expect(err.code).toBe("word-duplicate");
    host.send({ type: "resync", reqId: 12 });
    const snap = (await host.expect(
      (m) => m.type === "snapshot" && m.reqId === 12
    )) as unknown as SnapshotMsg;
    expect(snap.self.cumulativeScore).toBe(4);
  });

  test("short words are invalid server-side", async () => {
    const { host } = await match();
    host.send({ type: "submit-word", word: "te", reqId: 4 });
    expect((await host.expect((m) => m.type === "error" && m.reqId === 4)).code).toBe("invalid-word");
  });

  test("non-pathable strings are rejected server-side", async () => {
    const { host } = await match();
    // "saat" is in the dictionary but the fixed board has no such path.
    host.send({ type: "submit-word", word: "saat", reqId: 5 });
    expect((await host.expect((m) => m.type === "error" && m.reqId === 5)).code).toBe("invalid-word");
  });

  test("words outside the list are invalid", async () => {
    const { host } = await match();
    host.send({ type: "submit-word", word: "wett", reqId: 6 });
    expect((await host.expect((m) => m.type === "error" && m.reqId === 6)).code).toBe("invalid-word");
  });

  test("submissions after the round boundary are round-over, not silent", async () => {
    const { host } = await match();
    await host.expect((m) => m.type === "round-end");
    host.send({ type: "submit-word", word: "test", reqId: 7 });
    expect((await host.expect((m) => m.type === "error" && m.reqId === 7)).code).toBe("round-over");
  });

  test("mid-round joiners spectate: submissions get not-playing, then they play next round", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    await joinPlayer(scene, snap.room.code, "Gretl");
    host.send({ type: "start-round", reqId: 1 });
    await host.expect((m) => m.type === "round-start");

    const spec = await scene.makeClient();
    spec.send({ type: "join", code: snap.room.code, nickname: "Spielo", reqId: 30 });
    const specSnap = (await spec.expect((m) => m.type === "snapshot")) as unknown as SnapshotMsg;
    expect(specSnap.self.role).toBe("spectator");
    expect(specSnap.round?.deadline).toBeGreaterThan(0); // live view of board + countdown

    spec.send({ type: "submit-word", word: "test", reqId: 31 });
    expect((await spec.expect((m) => m.type === "error" && m.reqId === 31)).code).toBe("not-playing");

    // the host starts the next round → promoted exactly at round-start
    await host.expect((m) => m.type === "round-end", 4000);
    host.send({ type: "start-round", reqId: 2 });
    await host.expect((m) => m.type === "round-start" && m["round"].roundNumber === 2);
    spec.send({ type: "resync", reqId: 32 });
    const promoted = (await spec.expect(
      (m) => m.type === "snapshot" && m.reqId === 32
    )) as unknown as SnapshotMsg;
    expect(promoted.self.role).toBe("player");
    spec.send({ type: "submit-word", word: "test", reqId: 33 });
    const ack = await spec.expect((m) => m.type === "word-accepted" && m.reqId === 33, 4000);
    expect(ack.points).toBe(4); // t e s t are all value 1
    void host;
  });
});
