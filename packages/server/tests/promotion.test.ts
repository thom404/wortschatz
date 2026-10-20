import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SnapshotMsg } from "@wortschatz/shared";
import { createRoom, FAST_CLOCK, makeScene, type Scene } from "./scene.js";

let scene: Scene;
beforeEach(async () => {
  scene = await makeScene(FAST_CLOCK);
});
afterEach(async () => {
  await scene.stop();
});

describe("spectator promotion (in-room screens, #20)", () => {
  test("a promoted spectator learns it from a fresh snapshot at round start and can play the round", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    const gretl = await scene.makeClient();
    gretl.send({ type: "join", code: snap.room.code, nickname: "Gretl", reqId: 1 });
    host.send({ type: "start-round", reqId: 2 });
    await gretl.expect((m) => m.type === "round-start");

    // Fritz arrives mid-round: admitted as a spectator, watching this one.
    const watch = await scene.makeClient();
    watch.send({ type: "join", code: snap.room.code, nickname: "Fritz", reqId: 2 });
    const joinSnap = (await watch.expect((m) => m.type === "snapshot")) as unknown as SnapshotMsg;
    expect(joinSnap.self.role).toBe("spectator");

    // Round 2 begins when the host starts it: spectators are promoted in
    // join order (server truth), and the promoted seat is told about its own
    // change through a snapshot — the client's game screen flips its
    // input affordance on exactly there, without a resync request.
    await host.expect((m) => m.type === "round-end", 4000);
    host.send({ type: "start-round", reqId: 3 });
    const after = (await watch.expect(
      (m) => m.type === "snapshot" && m.self.role === "player"
    )) as unknown as SnapshotMsg;
    expect(after.room.roundNumber).toBe(2);
    expect(after.round?.roundNumber).toBe(2);

    // And the round is his to play: the accepted verdict arrives.
    watch.send({ type: "submit-word", word: "test", reqId: 4 });
    const verdict = await watch.expect((m) => m.type === "word-accepted" && m.reqId === 4);
    expect(verdict.points).toBeGreaterThan(0);
    void host;
  });
});
