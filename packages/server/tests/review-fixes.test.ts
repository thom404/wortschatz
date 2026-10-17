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
  test("need-players counts connected players only, not reserved seats", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    const { player } = await joinPlayer(scene, snap.room.code, "Gretl");
    void player.close();
    // Deterministic ordering: only test the gate once the seat went absent.
    await host.expect((m) => m.type === "player-disconnected");
    host.send({ type: "start-round", reqId: 1 });
    expect((await host.expect((m) => m.type === "error" && m.reqId === 1)).code).toBe("need-players");
  });

  test("validation errors echo reqId verbatim", async () => {
    const c = await scene.makeClient();
    c.send({ type: "join", reqId: 42 }); // missing code + nickname
    expect((await c.expect((m) => m.type === "error" && m.reqId === 42)).code).toBe("invalid-message");
    c.send({ nonsense: true, reqId: 43 });
    expect((await c.expect((m) => m.type === "error" && m.reqId === 43)).code).toBe("invalid-message");
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
      intermissionMs: 700,
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

      // Next round: first-come promotion fills to the cap; Dritte stays out.
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
