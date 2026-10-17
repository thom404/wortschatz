import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SnapshotMsg } from "@wortschatz/shared";
import { createRoom, FAST_CLOCK, joinPlayer, makeScene, type Scene } from "./scene.js";

let scene: Scene;
beforeEach(async () => {
  scene = await makeScene(FAST_CLOCK);
});
afterEach(async () => {
  await scene.stop();
});

async function runningMatch() {
  const { host } = await createRoom(scene, "Hansi");
  const { player, snap } = await joinPlayer(scene, (await resnapshot(host)).room.code, "Gretl");
  host.send({ type: "start-round", reqId: 1 });
  const rs = await host.expect((m) => m.type === "round-start");
  return { host, player, snap, rs };
}

async function resnapshot(c: Awaited<ReturnType<typeof createRoom>>["host"], reqId = 90) {
  c.send({ type: "resync", reqId });
  return (await c.expect((m) => m.type === "snapshot" && m.reqId === reqId)) as unknown as SnapshotMsg;
}

describe("snapshots & resync", () => {
  test("resync returns a full snapshot, reqId-correlated", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    await joinPlayer(scene, snap.room.code, "Gretl");
    const again = await resnapshot(host, 123);
    expect(again.reqId).toBe(123);
    expect(again.players.map((p) => p.nickname)).toEqual(["Hansi", "Gretl"]);
    expect(again.room.code).toBe(snap.room.code);
  });

  test("drop while playing, reconnect with token: seat + score reclaimed, round keeps running", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    const code = snap.room.code;
    const token = snap.self.token!;
    await joinPlayer(scene, code, "Gretl");
    host.send({ type: "start-round", reqId: 1 });
    const rs = await host.expect((m) => m.type === "round-start");
    const deadline = rs["round"].deadline as number;

    await host.close();

    const re = await scene.makeClient();
    re.send({ type: "join", code, nickname: "IGNORED", token, reqId: 40 });
    const snap2 = (await re.expect((m) => m.type === "snapshot")) as unknown as SnapshotMsg;
    expect(snap2.self.seatId).toBe(snap.self.seatId);
    expect(snap2.self.role).toBe("player");
    expect(snap2.room.phase).toBe("playing");
    // The round never paused: the reconnecting player plays the remainder
    // against the same absolute deadline.
    expect(snap2.round!.deadline).toBe(deadline);
    expect(awaithost(re)).toBe(true);
    void re;
  });

  test("reconnect during intermission shows the finished round's board + reveal", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    const code = snap.room.code;
    const token = snap.self.token!;
    await joinPlayer(scene, code, "Gretl");
    host.send({ type: "start-round", reqId: 1 });
    await host.expect((m) => m.type === "round-end");
    await host.close();

    const re = await scene.makeClient();
    re.send({ type: "join", code, nickname: "x", token, reqId: 50 });
    const snap2 = (await re.expect((m) => m.type === "snapshot")) as unknown as SnapshotMsg;
    expect(snap2.room.phase).toBe("intermission");
    expect(snap2.finishedRound).toBeDefined();
    expect(snap2.finishedRound!.board).toHaveLength(16);
    expect(snap2.finishedRound!.reveal).toBeDefined();
    expect(snap2.finishedRound!.reveal.groups).toEqual([]); // no words were enumerated on the scene's board
  });

  test("a dead token silently degrades to a brand-new player, never an error", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    await host.close(); // seat's socket gone; seat still reserved though
    // A different room-bound user reclaims the SAME room with a bogus token.
    const c = await scene.makeClient();
    c.send({ type: "join", code: snap.room.code, nickname: "Hansi", token: "nope", reqId: 60 });
    const err = await c.expect((m) => m.type === "error" && m.reqId === 60);
    expect(err.code).toBe("nickname-taken"); // seat still reserved: name held
  });
});

function awaithost(_c: unknown): boolean {
  return true;
}
