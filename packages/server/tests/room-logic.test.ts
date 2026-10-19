import { describe, expect, test } from "vitest";
import type { RoomEndReason, ServerMessage } from "@wortschatz/shared";
import { resolveConfig, type ServerConfig, type ServerConfigResolved } from "../src/config.js";
import { RoomLogic, type Clock, type TimerHandle } from "../src/room-logic.js";
import { makeRoom, type Room, type Seat } from "../src/state.js";

/**
 * A clock the test owns: `advance` fires every due timer in order, so the
 * phase and roster rules run without a single real timer or socket.
 */
class ManualClock implements Clock {
  private time = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void; every: number | null }>();

  now(): number {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = ++this.seq;
    this.timers.set(id, { at: this.time + ms, fn, every: null });
    return id;
  }
  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as number);
  }
  setInterval(fn: () => void, ms: number): TimerHandle {
    const id = ++this.seq;
    this.timers.set(id, { at: this.time + ms, fn, every: ms });
    return id;
  }
  clearInterval(handle: TimerHandle): void {
    this.timers.delete(handle as number);
  }
  /** Move wall time forward, firing every timer that comes due, in order. */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next;
      this.time = timer.at;
      if (timer.every === null) this.timers.delete(id);
      else timer.at = this.time + timer.every;
      timer.fn();
    }
    this.time = target;
  }
}

function makeCfg(over: Partial<ServerConfig> = {}): ServerConfigResolved {
  return resolveConfig({
    port: 0,
    dictionary: { isValid: () => true },
    generateBoard: () => ({ board: ["a"], words: [] }),
    scoreWord: () => 1,
    reveal: () => ({ groups: [] }),
    seedSource: () => 1n,
    // Scaled-down clock; the tick loop is parked far out so only the phase
    // timer drives the tests.
    roundMs: 1000,
    intermissionMs: 500,
    tickIntervalMs: 60_000,
    roomEmptyGraceMs: 300,
    roomIdleMs: 10_000,
    log: { info() {}, warn() {}, error() {} },
    ...over,
  });
}

interface Harness {
  clock: ManualClock;
  logic: RoomLogic;
  room: Room;
  sent: ServerMessage[];
  promoted: Seat[];
  expired: RoomEndReason[];
  addSeat(nickname: string): Seat;
}

function makeHarness(over: Partial<ServerConfig> = {}): Harness {
  const clock = new ManualClock();
  const room = makeRoom("ABCDE");
  const sent: ServerMessage[] = [];
  const promoted: Seat[] = [];
  const expired: RoomEndReason[] = [];
  const logic = new RoomLogic({
    cfg: makeCfg(over),
    clock,
    broadcast: (_room, msg) => sent.push(msg),
    snapshot: (_room, seat) => promoted.push(seat),
    expire: (_room, reason) => expired.push(reason),
  });
  return {
    clock,
    logic,
    room,
    sent,
    promoted,
    expired,
    addSeat: (nickname) => logic.newSeat(room, nickname),
  };
}

function types(sent: ServerMessage[]): string[] {
  return sent.map((m) => m.type);
}

describe("room phase", () => {
  test("startRound takes the round deadline from the injected clock and announces it", () => {
    const h = makeHarness();
    const host = h.addSeat("Hansi");
    h.room.hostSeatId = host.seatId;
    h.clock.advance(1000);

    h.logic.startRound(h.room);

    expect(h.room.phase).toBe("playing");
    expect(h.room.deadline).toBe(2000); // now + roundMs
    const start = h.sent.find((m) => m.type === "round-start");
    expect(start).toMatchObject({
      type: "round-start",
      round: { roundNumber: 1, deadline: 2000 },
    });
    const tick = h.sent.find((m) => m.type === "tick");
    expect(tick).toMatchObject({ type: "tick", phase: "playing", remaining: 1000, deadline: 2000 });
  });

  test("the round ends at the deadline: round-end then an intermission tick", () => {
    const h = makeHarness();
    h.addSeat("Hansi");
    h.logic.startRound(h.room); // t = 0, deadline 1000
    h.sent.length = 0;

    h.clock.advance(1000);

    expect(h.room.phase).toBe("intermission");
    expect(h.room.deadline).toBe(1500); // now + intermissionMs
    expect(types(h.sent)).toEqual(["round-end", "tick"]);
    expect(h.sent[1]).toMatchObject({
      type: "tick",
      phase: "intermission",
      remaining: 500,
      deadline: 1500,
    });
  });

  test("the intermission auto-advances to the next round when two player seats exist", () => {
    const h = makeHarness();
    h.addSeat("Hansi");
    h.addSeat("Gretl");
    h.logic.startRound(h.room); // t = 0, deadline 1000

    h.clock.advance(1500); // round deadline 1000, intermission deadline 1500

    expect(h.room.phase).toBe("playing");
    expect(h.room.roundNumber).toBe(2);
    expect(h.room.deadline).toBe(2500); // intermission end + roundMs
    expect(h.sent.filter((m) => m.type === "round-start")).toHaveLength(2);
  });

  test("with fewer than two player seats the intermission waits instead of advancing", () => {
    const h = makeHarness();
    h.addSeat("Hansi");
    h.logic.startRound(h.room); // t = 0, deadline 1000

    h.clock.advance(5000);

    expect(h.room.phase).toBe("intermission");
    expect(h.room.roundNumber).toBe(1);
    expect(h.sent.filter((m) => m.type === "round-start")).toHaveLength(1);
  });

  test("round start promotes spectators in join order and snapshots each promoted seat", () => {
    const h = makeHarness({ maxPlayers: 2 });
    h.addSeat("Hansi");
    const spectator = h.addSeat("Sepp");
    spectator.role = "spectator";

    h.logic.startRound(h.room);

    expect(spectator.role).toBe("player");
    expect(h.promoted).toEqual([spectator]);
  });

  test("submissions are accepted only while playing and before the injected deadline", () => {
    const h = makeHarness();
    h.addSeat("Hansi");
    expect(h.logic.acceptsSubmissions(h.room)).toBe(false); // lobby

    h.logic.startRound(h.room); // t = 0, deadline 1000
    expect(h.logic.acceptsSubmissions(h.room)).toBe(true);

    h.clock.advance(1000); // the round has ended; intermission
    expect(h.logic.acceptsSubmissions(h.room)).toBe(false);
  });

  test("skip pulls the intermission deadline to now and announces a zero tick", () => {
    const h = makeHarness();
    h.addSeat("Hansi");
    h.logic.startRound(h.room);
    h.clock.advance(1000); // endRound: intermission deadline 1500
    h.clock.advance(200); // t = 1200
    h.sent.length = 0;

    h.logic.skip(h.room);

    expect(h.room.deadline).toBe(1200);
    expect(h.sent).toEqual([{ type: "tick", phase: "intermission", remaining: 0, deadline: 1200 }]);
  });
});

describe("roster", () => {
  test("releasing the host announces the successor first, then the removal", () => {
    const h = makeHarness();
    const host = h.addSeat("Hansi");
    h.clock.advance(10);
    const successor = h.addSeat("Gretl");
    h.clock.advance(10);
    h.addSeat("Sepp");
    h.room.hostSeatId = host.seatId;
    h.sent.length = 0;

    h.logic.releaseSeat(h.room, host);

    expect(types(h.sent)).toEqual(["host-changed", "player-left"]);
    expect(h.sent[0]).toEqual({ type: "host-changed", hostSeatId: successor.seatId });
    expect(h.sent[1]).toEqual({ type: "player-left", seatId: host.seatId, nickname: "Hansi" });
    expect(h.room.hostSeatId).toBe(successor.seatId);
    expect(h.room.seats.has(host.seatId)).toBe(false);
  });

  test("releasing a non-host announces only the removal", () => {
    const h = makeHarness();
    const host = h.addSeat("Hansi");
    const other = h.addSeat("Gretl");
    h.room.hostSeatId = host.seatId;
    h.sent.length = 0;

    h.logic.releaseSeat(h.room, other);

    expect(types(h.sent)).toEqual(["player-left"]);
  });

  test("a disconnect reserves the seat and hands host to the longest-connected successor", () => {
    const h = makeHarness();
    const host = h.addSeat("Hansi");
    h.clock.advance(10);
    const successor = h.addSeat("Gretl");
    h.clock.advance(10);
    h.addSeat("Sepp");
    h.room.hostSeatId = host.seatId;
    h.room.phase = "playing";
    h.room.roundNumber = 3;
    h.sent.length = 0;

    h.logic.disconnect(h.room, host);

    expect(host.present).toBe(false);
    expect(host.absentRound).toBe(3); // the round it went missing in
    expect(h.room.seats.has(host.seatId)).toBe(true); // reserved, not released
    expect(types(h.sent)).toEqual(["player-disconnected", "host-changed"]);
    expect(h.room.hostSeatId).toBe(successor.seatId);
  });

  test("a seat absent for a full round plus intermission is auto-released", () => {
    const h = makeHarness();
    h.addSeat("Hansi");
    const stale = h.addSeat("Gretl");
    stale.present = false;
    stale.absentRound = 1;
    h.room.roundNumber = 3; // missed rounds 2 and 3
    h.sent.length = 0;

    h.logic.autoReleaseStaleSeats(h.room);

    expect(h.room.seats.has(stale.seatId)).toBe(false);
    expect(types(h.sent)).toEqual(["player-left"]);
  });

  test("a seat absent for only one round is kept", () => {
    const h = makeHarness();
    h.addSeat("Hansi");
    const recent = h.addSeat("Gretl");
    recent.present = false;
    recent.absentRound = 2;
    h.room.roundNumber = 3; // one missed round so far
    h.sent.length = 0;

    h.logic.autoReleaseStaleSeats(h.room);

    expect(h.room.seats.has(recent.seatId)).toBe(true);
    expect(h.sent).toEqual([]);
  });
});

describe("room expiry", () => {
  test("an empty room expires through the injected clock, with no real timer", () => {
    const h = makeHarness({ roomEmptyGraceMs: 300 });
    h.logic.touch(h.room);

    h.logic.maybeScheduleEmptyGrace(h.room);
    h.clock.advance(299);
    expect(h.expired).toEqual([]);

    h.clock.advance(1);
    expect(h.expired).toEqual(["expired"]);
  });

  test("a room with a present occupant does not schedule expiry", () => {
    const h = makeHarness({ roomEmptyGraceMs: 300 });
    h.addSeat("Hansi");
    h.logic.touch(h.room);

    h.logic.maybeScheduleEmptyGrace(h.room);
    h.clock.advance(1000);

    expect(h.expired).toEqual([]);
  });

  test("a room idle past its limit expires on the injected clock", () => {
    const h = makeHarness({ roomIdleMs: 1000 });
    h.addSeat("Hansi");
    h.logic.touch(h.room);

    h.logic.scheduleIdleCheck(h.room);
    h.clock.advance(1500);

    expect(h.expired).toEqual(["expired"]);
  });
});
