import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SnapshotMsg } from "@wortschatz/shared";
import { createRoom, FAST_CLOCK, joinPlayer, makeScene, type Scene } from "./scene.js";
import { connect } from "./test-client.js";

let scene: Scene;
beforeEach(async () => {
  scene = await makeScene(FAST_CLOCK);
});
afterEach(async () => {
  await scene.stop();
});

describe("review fixes", () => {
  test("field validation uses one error reply shape and echoes reqId verbatim", async () => {
    const c = await scene.makeClient();
    const cases: { frame: Record<string, unknown>; message: RegExp }[] = [
      { frame: { type: "join", reqId: 42 }, message: /code required/ }, // missing code + nickname
      { frame: { type: "kick", seatId: 1.5, reqId: 43 }, message: /integer seatId required/ },
      { frame: { type: "transfer-host", seatId: "2", reqId: 44 }, message: /integer seatId required/ },
      { frame: { type: "submit-word", word: 7, reqId: 45 }, message: /word required/ },
      { frame: { nonsense: true, reqId: 46 }, message: /missing type/ },
      { frame: { type: "bogus", reqId: 47 }, message: /unknown type: bogus/ },
    ];
    for (const { frame, message } of cases) {
      const reqId = frame["reqId"] as number;
      c.send(frame);
      const err = await c.expect((m) => m.type === "error" && m.reqId === reqId);
      expect(err).toEqual({
        type: "error",
        reqId,
        code: "invalid-message",
        message: expect.stringMatching(message),
      });
    }

    // Field failures leave the socket greetable, and a valid frame keeps
    // its existing wire shape.
    c.send({ type: "create-room", nickname: "Ok", reqId: 48 });
    const snap = (await c.expect((m) => m.type === "snapshot" && m.reqId === 48)) as unknown as SnapshotMsg;
    expect(snap.self.nickname).toBe("Ok");
  });

  test("flood teardown flows into the normal disconnect path", async () => {
    const scene2 = await makeScene({ ...FAST_CLOCK, quotaMaxMessages: 5, quotaWindowMs: 10_000 });
    try {
      const { host, snap } = await createRoom(scene2, "Hansi");
      const flooder = await connect(scene2.handle.port);
      flooder.send({ type: "join", code: snap.room.code, nickname: "Bot", reqId: 0 });
      await flooder.expect((m) => m.type === "snapshot");
      for (let i = 1; i <= 12; i++) {
        flooder.send({ type: "resync", reqId: i });
        await new Promise((r) => setTimeout(r, 3));
      }
      await flooder.waitForClose(4000);
      // The room sees the seat's normal disconnect bookkeeping, not silence.
      const gone = await host.expect((m) => m.type === "player-disconnected", 3000);
      expect(gone).toMatchObject({ seatId: 1, nickname: "Bot" });
      void host;
    } finally {
      await scene2.stop();
    }
  });

  test("spectators bypass the player cap mid-round and stay capped out on promotion", async () => {
    const scene2 = await makeScene({
      roundMs: 1200,
      tickIntervalMs: 150,
      maxPlayers: 2,
    });
    try {
      const { host, snap } = await createRoom(scene2, "Hansi");
      await joinPlayer(scene2, snap.room.code, "Gretl");
      host.send({ type: "start-round", reqId: 1 });
      await host.expect((m) => m.type === "round-start");

      const over = await scene2.makeClient();
      over.send({ type: "join", code: snap.room.code, nickname: "Dritte", reqId: 2 });
      const joinSnap = (await over.expect((m) => m.type === "snapshot")) as unknown as SnapshotMsg;
      expect(joinSnap.self.role).toBe("spectator");

      // Next round: the host starts it, first-come promotion fills to the
      // cap; Dritte stays out.
      await host.expect((m) => m.type === "round-end", 4000);
      host.send({ type: "start-round", reqId: 2 });
      await host.expect((m) => m.type === "round-start" && m["round"].roundNumber === 2);
      over.send({ type: "resync", reqId: 3 });
      const after = (await over.expect(
        (m) => m.type === "snapshot" && m.reqId === 3
      )) as unknown as SnapshotMsg;
      expect(after.self.role).toBe("spectator");
      expect(after.players.filter((p) => p.role === "player")).toHaveLength(2);
      await over.close();
    } finally {
      await scene2.stop();
    }
  });
});
