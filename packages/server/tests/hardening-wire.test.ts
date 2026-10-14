import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SnapshotMsg } from "@wordament/shared";
import { createRoom, FAST_CLOCK, joinPlayer, makeScene, type Scene } from "./scene.js";
import { connect } from "./test-client.js";

let scene: Scene;
beforeEach(async () => {
  scene = await makeScene(FAST_CLOCK);
});
afterEach(async () => {
  await scene.stop();
});

describe("hardening", () => {
  test("malformed JSON draws invalid-message, the socket survives", async () => {
    const c = await scene.makeClient();
    c.ws.send("this is not json");
    expect((await c.expect((m) => m.type === "error")).code).toBe("invalid-message");
    c.send({ type: "create-room", nickname: "Ok", reqId: 1 });
    const snap = (await c.expect((m) => m.type === "snapshot" && m.reqId === 1)) as unknown as SnapshotMsg;
    expect(snap.self.nickname).toBe("Ok");
  });

  test("unknown message types are typed invalid-message", async () => {
    const c = await scene.makeClient();
    c.send({ type: "bogus", reqId: 1 });
    expect((await c.expect((m) => m.type === "error" && m.reqId === 1)).code).toBe("invalid-message");
  });

  test("payloads over 4 KiB draw invalid-message", async () => {
    const c = await scene.makeClient();
    c.send({ type: "create-room", nickname: "A".repeat(5000), reqId: 1 });
    expect((await c.expect((m) => m.type === "error")).code).toBe("invalid-message");
  });

  test("message flood: typed rate-limited first, then teardown", async () => {
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
      const limited = await flooder.expect((m) => m.type === "error" && m.code === "rate-limited", 3000);
      expect(limited.code).toBe("rate-limited");
      await flooder.waitForClose(4000); // sustained breach tears the socket down
      void host;
    } finally {
      await scene2.stop();
    }
  });

  test("non-greeted sockets that never say join are dead weight, saludable close still possible", async () => {
    const c = await scene.makeClient();
    c.send({ type: "create-room", nickname: "", reqId: 1 });
    expect((await c.expect((m) => m.type === "error")).code).toBe("invalid-message");
    // The socket is still greeting-capable.
    c.send({ type: "create-room", nickname: "Ok", reqId: 2 });
    const snap = (await c.expect((m) => m.type === "snapshot" && m.reqId === 2)) as unknown as SnapshotMsg;
    expect(snap.self.nickname).toBe("Ok");
  });
});
