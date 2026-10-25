import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRoom, FAST_CLOCK, makeScene, type Scene } from "./scene.js";

let scene: Scene;
beforeEach(async () => {
  scene = await makeScene(FAST_CLOCK);
});
afterEach(async () => {
  await scene.stop();
});

/**
 * A joining socket is bound before the room-wide join announcements, so the
 * newcomer receives the same frames as everyone already in the room: its own
 * `player-joined` (and the adoption `host-changed` when the room had no host)
 * before its snapshot. These are real-WebSocket assertions on arrival order.
 */
describe("join announcements reach the newcomer", () => {
  test("a newcomer receives its own player-joined before its snapshot", async () => {
    const { snap } = await createRoom(scene, "Hansi");
    const newcomer = await scene.makeClient();

    newcomer.send({ type: "join", code: snap.room.code, nickname: "Gretl", reqId: 2 });

    const joined = await newcomer.next();
    expect(joined.type).toBe("player-joined");
    expect(joined).toMatchObject({
      type: "player-joined",
      player: { nickname: "Gretl", role: "player", connected: true },
    });
    const snapshot = await newcomer.next();
    expect(snapshot.type).toBe("snapshot");
    expect(snapshot.reqId).toBe(2);
  });

  test("the adopted host receives host-changed before player-joined", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    host.send({ type: "leave" });
    await host.waitForClose();

    // The room has no host now; the joining player adopts it. The newcomer is
    // bound before the announcements, so it sees the adoption first.
    const adopted = await scene.makeClient();
    adopted.send({ type: "join", code: snap.room.code, nickname: "Gretl", reqId: 3 });

    const changed = await adopted.next();
    expect(changed.type).toBe("host-changed");
    expect(changed).toMatchObject({ type: "host-changed" });
    const joined = await adopted.next();
    expect(joined.type).toBe("player-joined");
    const snapshot = await adopted.next();
    expect(snapshot.type).toBe("snapshot");
    expect(snapshot.reqId).toBe(3);
  });
});
