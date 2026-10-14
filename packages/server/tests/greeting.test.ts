import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SnapshotMsg } from "@wordament/shared";
import { createRoom, FAST_CLOCK, joinPlayer, makeScene, type Scene } from "./scene.js";

let scene: Scene;
beforeEach(async () => {
  scene = await makeScene(FAST_CLOCK);
});
afterEach(async () => {
  await scene.stop();
});

describe("greeting: one-shot create-room", () => {
  test("creator becomes host of a lobby room and gets token + full snapshot", async () => {
    const { host, snap } = await createRoom(scene, "Hansi", 7);

    expect(snap.reqId).toBe(7);
    expect(snap.room.phase).toBe("lobby");
    expect(snap.room.hostSeatId).toBe(snap.self.seatId);
    expect(snap.room.roundNumber).toBe(0);
    expect(snap.self.nickname).toBe("Hansi");
    expect(snap.self.role).toBe("player");
    expect(typeof snap.self.token).toBe("string");
    expect(snap.self.token).not.toBe("");
    expect(snap.players).toHaveLength(1);
    expect(snap.players[0]).toMatchObject({
      nickname: "Hansi",
      role: "player",
      connected: true,
    });
    expect(host.ws.readyState).toBe(1);
  });

  test("room code length and alphabet follow the shared constant", async () => {
    const { snap } = await createRoom(scene);
    expect(snap.room.code).toHaveLength(5);
    expect(snap.room.code.toUpperCase()).toBe(snap.room.code);
  });

  test("join with an unresolvable code is the generic room-not-found outcome", async () => {
    const c = await scene.makeClient();
    c.send({ type: "join", code: "ZZ9Z9", nickname: "Otto", reqId: 3 });
    const err = await c.expect((m) => m.type === "error");
    expect(err.code).toBe("room-not-found");
    expect(err.reqId).toBe(3);
  });

  test("nicknames are unique per room, case-insensitive and NFC-normalized", async () => {
    const { snap } = await createRoom(scene, "Hansi");
    const code = snap.room.code;

    const a = await scene.makeClient();
    a.send({ type: "join", code, nickname: "HANSI", reqId: 1 });
    expect((await a.expect((m) => m.type === "error")).code).toBe("nickname-taken");

    const b = await scene.makeClient();
    b.send({ type: "join", code, nickname: "Hansi\u0308", reqId: 2 }); // a + combining diaeresis ≠ ä… but hansi vs hänsi differ
    const snapB = (await b.expect((m) => m.type === "snapshot")) as unknown as SnapshotMsg;
    expect(snapB.self.seatId).not.toBe(snap.self.seatId);
  });

  test("a failed greet leaves the socket reusable for a retry", async () => {
    const { snap } = await createRoom(scene, "Hansi");
    const c = await scene.makeClient();
    c.send({ type: "join", code: "XXXXX", nickname: "Otto", reqId: 1 });
    expect((await c.expect((m) => m.type === "error")).code).toBe("room-not-found");
    c.send({ type: "join", code: snap.room.code, nickname: "Otto", reqId: 2 });
    const ok = (await c.expect((m) => m.type === "snapshot")) as unknown as SnapshotMsg;
    expect(ok.self.nickname).toBe("Otto");
  });

  test("non-greeting first messages are rejected", async () => {
    const c = await scene.makeClient();
    c.send({ type: "submit-word", word: "test", reqId: 1 });
    const err = await c.expect((m) => m.type === "error");
    expect(err.code).toBe("invalid-message");
  });
});

describe("greeting: join", () => {
  test("second player joins the lobby with a distinct seat in join order", async () => {
    const { snap: hostSnap } = await createRoom(scene, "Hansi");
    const { player, snap } = await joinPlayer(scene, hostSnap.room.code, "Gretl");
    expect(snap.self.seatId).toBe((hostSnap.self.seatId ?? 0) + 1);
    expect(snap.room.hostSeatId).toBe(hostSnap.self.seatId);
    expect(snap.players.map((p) => p.nickname)).toEqual(["Hansi", "Gretl"]);
    void player;
  });

  test("everyone sees the newcomer arrive as a player-joined delta", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    await joinPlayer(scene, snap.room.code, "Gretl");
    const delta = await host.expect((m) => m.type === "player-joined");
    expect(delta).toMatchObject({
      type: "player-joined",
      player: { nickname: "Gretl", role: "player", connected: true },
    });
  });
});
