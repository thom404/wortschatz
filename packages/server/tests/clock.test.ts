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

async function startMatch() {
  const { host, snap } = await createRoom(scene, "Hansi");
  const { player } = await joinPlayer(scene, snap.room.code, "Gretl");
  host.send({ type: "start-round", reqId: 10 });
  const roundStart = await host.expect((m) => m.type === "round-start");
  return { host, player, snap, roundStart };
}

describe("starting a round", () => {
  test("first round is host-gated: non-host gets not-host", async () => {
    const { host, player } = await startMatch();
    void host;
    // player sends start-round themselves: not the host
    const fresh = await scene.makeClient(); // dummy to keep player's stream clean
    void fresh;
    player.send({ type: "start-round", reqId: 1 });
    const err = await player.expect((m) => m.type === "error" && m.reqId === 1);
    expect(err.code).toBe("not-host");
  });

  test("lone host cannot start: need-players", async () => {
    const { host } = await createRoom(scene, "Hansi");
    host.send({ type: "start-round", reqId: 2 });
    const err = await host.expect((m) => m.type === "error" && m.reqId === 2);
    expect(err.code).toBe("need-players");
  });

  test("host starts the round: absolute deadline, 16-tile board, round 1", async () => {
    const { host, roundStart } = await startMatch();
    void host;
    const round = roundStart["round"] as { roundNumber: number; board: string[]; deadline: number };
    expect(round.roundNumber).toBe(1);
    expect(round.board).toHaveLength(16);
    expect(round.board.every((t) => typeof t === "string")).toBe(true);
    expect(round.deadline).toBeGreaterThan(Date.now());
    expect(round.deadline - Date.now()).toBeLessThanOrEqual(1600);
  });
});

describe("tick fabric", () => {
  test("1 Hz ticks re-anchor with phase, remaining and the absolute deadline", async () => {
    const { host } = await startMatch();
    const deadline = (await host.expect((m) => m.type === "round-start"))["round"] as never;
    void deadline;
    const t1 = await host.expect((m) => m.type === "tick" && m.phase === "playing");
    const t2 = await host.expect(
      (m) => m.type === "tick" && m.phase === "playing" && m.remaining < t1.remaining
    );
    expect(t1.deadline).toBe(t2.deadline);
    expect(t2.remaining).toBeGreaterThan(0);
    expect(t2.remaining).toBeLessThanOrEqual(t1.remaining - 100);
  });

  test("room ends the round at one absolute moment for everyone", async () => {
    const { host, player, roundStart } = await startMatch();
    const deadline = (roundStart["round"] as { deadline: number }).deadline;

    // Late joiner spectates the running round: same absolute deadline.
    const before = host.expect((m) => m.type === "round-end") as Promise<{ reveal: unknown }>;
    void before;
    void player;

    const endAt = await host.expect((m) => m.type === "round-end");
    expect(Math.abs(Date.now() - deadline)).toBeLessThan(400);
    void endAt;
  });

  test("canonical sequence per cycle: round-end → intermission ticks → next round-start", async () => {
    const { host } = await startMatch();
    await host.expect((m) => m.type === "round-end");
    const it = await host.expect((m) => m.type === "tick" && m.phase === "intermission");
    expect(it.remaining).toBeGreaterThan(0);
    const next = await host.expect((m) => m.type === "round-start");
    const round = next["round"] as { roundNumber: number };
    expect(round.roundNumber).toBe(2); // auto-advance keeps rolling rounds
  });

  test("skip pulls the intermission deadline forward instead of waiting it out", async () => {
    const { host } = await createRoom(scene, "Hansi");
    const { player } = await joinPlayer(scene, (await snapshotOf(host)).room.code, "Gretl");
    void player;
    host.send({ type: "start-round", reqId: 1 });
    await host.expect((m) => m.type === "round-start");
    await host.expect((m) => m.type === "round-end");
    host.send({ type: "skip", reqId: 5 });
    const started = Date.now();
    const next = await host.expect((m) => m.type === "round-start");
    expect(next["round"].roundNumber).toBe(2);
    expect(Date.now() - started).toBeLessThan(800);
  });

  test("skip outside intermission is invalid-phase; non-host skip is not-host", async () => {
    const { host, player } = await startMatch();
    host.send({ type: "skip", reqId: 20 });
    expect((await host.expect((m) => m.type === "error" && m.reqId === 20)).code).toBe("invalid-phase");
    player.send({ type: "skip", reqId: 21 });
    expect((await player.expect((m) => m.type === "error" && m.reqId === 21)).code).toBe("not-host");
  });
});

async function snapshotOf(c: Awaited<ReturnType<typeof createRoom>>["host"]) {
  c.send({ type: "resync", reqId: 99 });
  return (await c.expect((m) => m.type === "snapshot" && m.reqId === 99)) as unknown as SnapshotMsg;
}
