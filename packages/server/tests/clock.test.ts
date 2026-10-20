import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SnapshotMsg } from "@wortschatz/shared";
import { createRoom, FAST_CLOCK, joinPlayer, makeScene, type Scene } from "./scene.js";
import type { TestClient } from "./test-client.js";

let scene: Scene;
beforeEach(async () => {
  scene = await makeScene(FAST_CLOCK);
});
afterEach(async () => {
  await scene.stop();
});

async function startMatch() {
  const { host, snap } = await createRoom(scene, "Hansi");
  const { player } = await joinPlayer(scene, snap.room.code, "Gretl");
  host.send({ type: "start-round", reqId: 10 });
  const roundStart = await host.expect((m) => m.type === "round-start");
  return { host, player, snap, roundStart };
}

/** Record the `type` of every frame a client receives, so absence of a
 *  self-advance can be asserted without draining the stream. */
function record(client: TestClient): string[] {
  const events: string[] = [];
  client.ws.on("message", (data) => {
    events.push((JSON.parse(data.toString()) as { type: string }).type);
  });
  return events;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("starting a round", () => {
  test("a non-host start-round is not-host", async () => {
    const { player } = await startMatch();
    player.send({ type: "start-round", reqId: 1 });
    const err = await player.expect((m) => m.type === "error" && m.reqId === 1);
    expect(err.code).toBe("not-host");
  });

  test("a solo host can start a round", async () => {
    const { host } = await createRoom(scene, "Hansi");
    host.send({ type: "start-round", reqId: 2 });
    const roundStart = await host.expect((m) => m.type === "round-start");
    expect((roundStart["round"] as { roundNumber: number }).roundNumber).toBe(1);
  });

  test("host starts the round: absolute deadline, 16-tile board, round 1", async () => {
    const { roundStart } = await startMatch();
    const round = roundStart["round"] as { roundNumber: number; board: string[]; deadline: number };
    expect(round.roundNumber).toBe(1);
    expect(round.board).toHaveLength(16);
    expect(round.board.every((t) => typeof t === "string")).toBe(true);
    expect(round.deadline).toBeGreaterThan(Date.now());
    expect(round.deadline - Date.now()).toBeLessThanOrEqual(1600);
  });
});

describe("tick fabric", () => {
  test("1 Hz ticks re-anchor the round with remaining and the absolute deadline", async () => {
    const { host } = await startMatch();
    const t1 = await host.expect((m) => m.type === "tick");
    const t2 = await host.expect((m) => m.type === "tick" && m.remaining < t1.remaining);
    expect(t1).not.toHaveProperty("phase");
    expect(t2.deadline).toBe(t1.deadline);
    expect(t2.remaining).toBeGreaterThan(0);
    expect(t2.remaining).toBeLessThanOrEqual(t1.remaining - 100);
  });

  test("room ends the round at one absolute moment for everyone", async () => {
    const { host, roundStart } = await startMatch();
    const deadline = (roundStart["round"] as { deadline: number }).deadline;

    await host.expect((m) => m.type === "round-end");
    expect(Math.abs(Date.now() - deadline)).toBeLessThan(400);
  });

  test("a pause never advances on its own: the host starts the next round", async () => {
    const { host } = await startMatch();
    await host.expect((m) => m.type === "round-end");
    const events = record(host);

    // Longer than the old intermission ever was: still no round-start.
    await wait(1200);
    expect(events).not.toContain("round-start");
    expect(events).not.toContain("tick");

    host.send({ type: "start-round", reqId: 11 });
    const next = await host.expect((m) => m.type === "round-start");
    expect((next["round"] as { roundNumber: number }).roundNumber).toBe(2);
  });

  test("a start-round during the pause starts the next round; non-host is refused", async () => {
    const { host, player } = await startMatch();
    await host.expect((m) => m.type === "round-end");

    player.send({ type: "start-round", reqId: 20 });
    expect((await player.expect((m) => m.type === "error" && m.reqId === 20)).code).toBe("not-host");

    host.send({ type: "start-round", reqId: 21 });
    const next = await host.expect((m) => m.type === "round-start");
    expect((next["round"] as { roundNumber: number }).roundNumber).toBe(2);
  });

  test("start-round during a running round is invalid-phase", async () => {
    const { host } = await startMatch();
    host.send({ type: "start-round", reqId: 30 });
    expect((await host.expect((m) => m.type === "error" && m.reqId === 30)).code).toBe("invalid-phase");
  });
});

describe("hostless rooms", () => {
  test("a pause with no host and a present spectator ends the room cleanly: no-players, 1001", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    const code = snap.room.code;
    const { player } = await joinPlayer(scene, code, "Gretl");
    host.send({ type: "start-round", reqId: 1 });
    await host.expect((m) => m.type === "round-start");

    // A mid-round joiner spectates; the two player seats leave while the
    // round is still running, so the room is hostless but not yet dead.
    const spectator = await scene.makeClient();
    spectator.send({ type: "join", code, nickname: "Spät", reqId: 2 });
    await spectator.expect((m) => m.type === "snapshot");

    await host.close();
    await player.close();

    const end = await spectator.expect((m) => m.type === "round-end", 4000);
    expect(end.type).toBe("round-end");
    const ended = await spectator.expect((m) => m.type === "room-ended", 2000);
    expect(ended.reason).toBe("no-players");
    expect(await spectator.waitForClose()).toMatchObject({ code: 1001 });
  });

  test("a hostless room adopts a reconnecting player as host", async () => {
    const { host, snap } = await createRoom(scene, "Hansi");
    const code = snap.room.code;
    const { player, snap: playerSnap } = await joinPlayer(scene, code, "Gretl");
    const token = playerSnap.self.token!;
    host.send({ type: "start-round", reqId: 1 });
    await host.expect((m) => m.type === "round-start");

    // Both player sockets go: no host remains, and the empty room keeps its
    // grace period while the round still runs.
    await player.close();
    await host.close();

    const re = await scene.makeClient();
    re.send({ type: "join", code, nickname: "IGNORED", token, reqId: 40 });
    const restored = (await re.expect((m) => m.type === "snapshot")) as unknown as SnapshotMsg;
    expect(restored.room.hostSeatId).toBe(playerSnap.self.seatId);
    await re.close();
    void player;
  });
});
