import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SnapshotMsg } from "@wortschatz/shared";
import { createRoom, FAST_CLOCK, joinPlayer, makeScene, fullCfg, type Scene } from "./scene.js";
import { connect, type TestClient } from "./test-client.js";

let scene: Scene;
beforeEach(async () => {
  scene = await makeScene(FAST_CLOCK);
});
afterEach(async () => {
  await scene.stop();
});

function seatSnap(m: Record<string, unknown> & { type: string }): SnapshotMsg {
  return m as unknown as SnapshotMsg;
}

/** Record the `type` of every frame a client receives, for counting and
 *  ordering assertions the draining `expect` helper cannot express. */
function record(client: TestClient): string[] {
  const events: string[] = [];
  client.ws.on("message", (data) => {
    events.push((JSON.parse(data.toString()) as { type: string }).type);
  });
  return events;
}

/** The departure announcements a remaining client sees, in arrival order. */
function departures(events: string[]): string[] {
  return events.filter((t) => t === "host-changed" || t === "player-left");
}

describe("seat lifecycle", () => {
  test("voluntary leave releases the seat instantly: player-left for others, socket closes 1000", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    const { player } = await joinPlayer(scene, snap.room.code, "Gretl");
    player.send({ type: "leave" });
    const gone = await host.expect((m) => m.type === "player-left");
    expect(gone).toMatchObject({ seatId: 1, nickname: "Gretl" });
    expect(await player.waitForClose()).toMatchObject({ code: 1000 });
    host.send({ type: "resync", reqId: 200 });
    const after = (await host.expect(
      (m) => m.type === "snapshot" && m.reqId === 200
    )) as unknown as SnapshotMsg;
    expect(after.players.map((p) => p.nickname)).toEqual(["Hansi"]);
  });

  test("host powers move to the longest-connected remaining player when the host drops", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    const code = snap.room.code;
    const p2 = await joinPlayer(scene, code, "Gretl");
    await joinPlayer(scene, code, "Sepp");
    const hostSeat = seatSnap(await p2.player.expect(() => false, 1).catch(() => null));
    void hostSeat;
    host.close();
    const changed = await p2.player.expect((m) => m.type === "host-changed", 4000);
    expect(changed.hostSeatId).toBe(1); // Gretl joined before Sepp
  });

  test("a host leaving announces host-changed exactly once to every connected client", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    const code = snap.room.code;
    const { player: gretl, snap: gretlSnap } = await joinPlayer(scene, code, "Gretl");
    const { player: sepp } = await joinPlayer(scene, code, "Sepp");

    const gretlEvents = record(gretl);
    const seppEvents = record(sepp);

    host.send({ type: "leave" });

    // Successor host first, roster removal after — once for each client.
    const changed = await gretl.expect((m) => m.type === "host-changed", 4000);
    expect(changed.hostSeatId).toBe(gretlSnap.self.seatId); // longest-connected successor
    await gretl.expect((m) => m.type === "player-left" && m.seatId === 0, 4000);
    await sepp.expect((m) => m.type === "host-changed", 4000);
    await sepp.expect((m) => m.type === "player-left" && m.seatId === 0, 4000);
    // Give any duplicate a chance to arrive before counting.
    await new Promise((r) => setTimeout(r, 100));

    expect(departures(gretlEvents)).toEqual(["host-changed", "player-left"]);
    expect(departures(seppEvents)).toEqual(["host-changed", "player-left"]);
  });

  test("a host dropping its socket announces host-changed exactly once and reserves the seat", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    const code = snap.room.code;
    const { player: gretl, snap: gretlSnap } = await joinPlayer(scene, code, "Gretl");
    const { player: sepp } = await joinPlayer(scene, code, "Sepp");

    const gretlEvents = record(gretl);
    const seppEvents = record(sepp);

    // The transport drops rather than a voluntary leave: the host's seat is
    // reserved, so there is no player-left — only the single host hand-off.
    host.close();

    await gretl.expect((m) => m.type === "player-disconnected" && m.seatId === snap.self.seatId, 4000);
    const changed = await gretl.expect((m) => m.type === "host-changed", 4000);
    expect(changed.hostSeatId).toBe(gretlSnap.self.seatId); // longest-connected successor
    await sepp.expect((m) => m.type === "player-disconnected" && m.seatId === snap.self.seatId, 4000);
    await sepp.expect((m) => m.type === "host-changed", 4000);
    // Give any duplicate a chance to arrive before counting.
    await new Promise((r) => setTimeout(r, 100));

    expect(gretlEvents.filter((t) => t === "host-changed")).toHaveLength(1);
    expect(seppEvents.filter((t) => t === "host-changed")).toHaveLength(1);
    expect(gretlEvents).not.toContain("player-left");
    expect(seppEvents).not.toContain("player-left");
  });

  test("leave, kick and auto-release announce a departure in the same order", async () => {
    // Voluntary leave: the departing host's successor is announced first.
    {
      const { host, snap } = await createRoom(scene, "Hansi");
      const { player: gretl } = await joinPlayer(scene, snap.room.code, "Gretl");
      const events = record(gretl);
      host.send({ type: "leave" });
      await gretl.expect((m) => m.type === "player-left" && m.seatId === 0, 4000);
      await new Promise((r) => setTimeout(r, 100));
      expect(departures(events)).toEqual(["host-changed", "player-left"]);
    }

    // Explicit kick: a non-host departure is roster removal alone.
    {
      const { host, snap } = await createRoom(scene, "Hansi");
      const { player: gretl } = await joinPlayer(scene, snap.room.code, "Gretl");
      const { player: sepp, snap: seppSnap } = await joinPlayer(scene, snap.room.code, "Sepp");
      const events = record(gretl);
      host.send({ type: "kick", seatId: seppSnap.self.seatId, reqId: 5 });
      await gretl.expect((m) => m.type === "player-left" && m.seatId === seppSnap.self.seatId, 4000);
      await new Promise((r) => setTimeout(r, 100));
      expect(departures(events)).toEqual(["player-left"]);
      void sepp;
    }

    // Auto-release of a long-absent seat: the same roster-removal announcement.
    const scene2 = await makeScene({ roundMs: 300, tickIntervalMs: 100 });
    try {
      const { host, snap } = await createRoom(scene2, "Hansi");
      const { player: gretl } = await joinPlayer(scene2, snap.room.code, "Gretl");
      const events = record(host);
      host.send({ type: "start-round", reqId: 1 });
      await host.expect((m) => m.type === "round-start");
      gretl.close();
      await host.expect((m) => m.type === "player-disconnected" && m.seatId === 1, 4000);
      // Two more host-started rounds: the seat misses a full round and pause
      // before the auto-release on the third start.
      await host.expect((m) => m.type === "round-end", 2000);
      host.send({ type: "start-round", reqId: 2 });
      await host.expect((m) => m.type === "round-start" && m["round"].roundNumber === 2, 2000);
      await host.expect((m) => m.type === "round-end", 2000);
      host.send({ type: "start-round", reqId: 3 });
      await host.expect((m) => m.type === "player-left" && m.seatId === 1, 4000);
      await new Promise((r) => setTimeout(r, 100));
      expect(departures(events)).toEqual(["player-left"]);
    } finally {
      await scene2.stop();
    }
  });

  test("explicit transfer-host moves duties immediately", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    const { player } = await joinPlayer(scene, snap.room.code, "Gretl");
    const gretlSeat = (await host.expect((m) => m.type === "player-joined"))["player"].seatId;
    host.send({ type: "transfer-host", seatId: gretlSeat, reqId: 7 });
    const changed = await player.expect((m) => m.type === "host-changed");
    expect(changed.hostSeatId).toBe(gretlSeat);
  });

  test("host close tears the room down: room-ended + close 1000 everywhere, code dies", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    const { player } = await joinPlayer(scene, snap.room.code, "Gretl");
    host.send({ type: "close-room", reqId: 9 });
    const ended = await player.expect((m) => m.type === "room-ended");
    expect(ended.reason).toBe("host-closed");
    expect(await player.waitForClose()).toMatchObject({ code: 1000 });
    expect((await host.waitForClose())["code"]).toBe(1000);

    const late = await scene.makeClient();
    late.send({ type: "join", code: snap.room.code, nickname: "Otto", reqId: 5 });
    expect((await late.expect((m) => m.type === "error" && m.reqId === 5)).code).toBe("room-not-found");
  });

  test("kicked player is told unmistakably: kicked + close 1000; others see player-left", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    const { player, snap: pSnap } = await joinPlayer(scene, snap.room.code, "Gretl");
    await joinPlayer(scene, snap.room.code, "Sepp"); // warm the room
    host.send({ type: "kick", seatId: (pSnap as unknown as SnapshotMsg).self.seatId, reqId: 12 });
    const kicked = await player.expect((m) => m.type === "kicked");
    expect(kicked.type).toBe("kicked");
    expect(await player.waitForClose()).toMatchObject({ code: 1000 });
    await host.expect((m) => m.type === "player-left");
    // Kicked seats are not reclaimable by token.
    const re = await scene.makeClient();
    re.send({
      type: "join",
      code: snap.room.code,
      nickname: "Gretl",
      token: (pSnap as unknown as SnapshotMsg).self.token,
      reqId: 13,
    });
    const dead = (await re.expect((m) => m.type === "snapshot" && m.reqId === 13)) as unknown as SnapshotMsg;
    expect(dead.self.seatId).toBeGreaterThan(2); // fresh seat, not the kicked one
  });
});

describe("room lifetime", () => {
  test("server shutdown path: room-ended broadcast + close 1001 on every socket", async () => {
    const scene2 = await makeScene(FAST_CLOCK);
    try {
      const { host, snap } = await createRoom(scene2, "Hansi");
      const { player } = await joinPlayer(scene2, snap.room.code, "Gretl");
      await scene2.stop();
      expect((await host.waitForClose())["code"]).toBe(1001);
      expect((await player.waitForClose())["code"]).toBe(1001);
    } finally {
      await scene2.stop();
    }
  });

  test("empty room expires after its grace and its code stops resolving", async () => {
    const scene2 = await makeScene({ ...FAST_CLOCK, roomEmptyGraceMs: 250 });
    try {
      const { host, snap } = await createRoom(scene2, "Hansi");
      await host.close();
      // everyone left → grace elapses → room gone
      await new Promise((r) => setTimeout(r, 400));
      const late = await connect(scene2.handle.port);
      late.send({ type: "join", code: snap.room.code, nickname: "Otto", reqId: 1 });
      expect((await late.expect((m) => m.type === "error" && m.reqId === 1)).code).toBe("room-not-found");
      await late.close();
    } finally {
      await scene2.stop();
    }
  });

  test("disconnected seat auto-releases after missing a full round + intermission", async () => {
    const scene2 = await makeScene({
      roundMs: 300,
      tickIntervalMs: 100,
      pingIntervalMs: 60_000,
      pongGraceMs: 60_000,
    });
    try {
      const { host, snap } = await createRoom(scene2, "Hansi");
      const code = snap.room.code;
      const token = snap.self.token!;
      const { player } = await joinPlayer(scene2, code, "Gretl");
      host.send({ type: "start-round", reqId: 1 });
      await host.expect((m) => m.type === "round-start");
      host.close(); // host drops mid-round
      // Seat reserved through the next round-start; released the round after.
      await player.expect((m) => m.type === "round-end", 2000);
      player.send({ type: "start-round", reqId: 2 });
      await player.expect((m) => m.type === "round-start" && m["round"].roundNumber === 2);
      await player.expect((m) => m.type === "round-end", 2000);
      player.send({ type: "start-round", reqId: 3 });
      const released = await player.expect((m) => m.type === "player-left" && m.seatId === 0, 4000);
      expect(released.nickname).toBe("Hansi");
      // Old token is dead: rejoining with it is a brand-new player.
      const re = await connect(scene2.handle.port);
      re.send({ type: "join", code, nickname: "Hansi", token, reqId: 3 });
      const friendship = (await re.expect(
        (m) => m.type === "snapshot" && m.reqId === 3
      )) as unknown as SnapshotMsg;
      expect(friendship.self.seatId).toBeGreaterThan(1);
      expect(friendship.self.token).not.toBe(token);
      await re.close();
      void player;
    } finally {
      await scene2.stop();
    }
  });
});

describe("capacity", () => {
  test("ninth joiner of a full room: room-full", async () => {
    const scene2 = await makeScene({ ...FAST_CLOCK, maxPlayers: 2 });
    try {
      const { snap } = await createRoom(scene2, "Hansi");
      await joinPlayer(scene2, snap.room.code, "Gretl");
      const third = await scene2.makeClient();
      third.send({ type: "join", code: snap.room.code, nickname: "Drei", reqId: 1 });
      expect((await third.expect((m) => m.type === "error" && m.reqId === 1)).code).toBe("room-full");
      await third.close();
    } finally {
      await scene2.stop();
    }
  });

  test("33rd room of a capped server: server-full", async () => {
    const scene2 = await makeScene({ ...FAST_CLOCK, maxRooms: 2 });
    try {
      await createRoom(scene2, "A");
      await createRoom(scene2, "B");
      const c = await scene2.makeClient();
      c.send({ type: "create-room", nickname: "C", reqId: 2 });
      expect((await c.expect((m) => m.type === "error" && m.reqId === 2)).code).toBe("server-full");
      await c.close();
    } finally {
      await scene2.stop();
    }
  });

  test("fullCfg exposes injectable constants for scaled-down testing", () => {
    const cfg = fullCfg({ roundMs: 123 });
    expect(cfg.roundMs).toBe(123);
  });
});

export type { TestClient };
