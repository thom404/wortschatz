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
    expect(tick).toMatchObject({ type: "tick", remaining: 1000, deadline: 2000 });
    expect(tick).not.toHaveProperty("phase");
  });

  test("the round ends at the deadline: round-end only, with no pause clock", () => {
    const h = makeHarness();
    h.addSeat("Hansi");
    h.logic.startRound(h.room); // t = 0, deadline 1000
    h.sent.length = 0;

    h.clock.advance(1000);

    expect(h.room.phase).toBe("intermission");
    expect(h.room.deadline).toBe(0);
    expect(types(h.sent)).toEqual(["round-end"]);
  });

  test("the pause never advances on its own", () => {
    const h = makeHarness();
    const host = h.addSeat("Hansi");
    h.room.hostSeatId = host.seatId;
    h.logic.startRound(h.room); // t = 0, deadline 1000
    h.clock.advance(1000); // intermission, no deadline
    h.sent.length = 0;

    h.clock.advance(60_000);

    expect(h.room.phase).toBe("intermission");
    expect(h.room.roundNumber).toBe(1);
    expect(h.sent).toEqual([]);
  });

  test("a solo host can start the next round from the pause", () => {
    const h = makeHarness();
    const host = h.addSeat("Hansi");
    h.room.hostSeatId = host.seatId;
    h.logic.startRound(h.room); // t = 0, deadline 1000
    h.clock.advance(1000); // pause
    h.logic.startRound(h.room); // t = 1000, deadline 2000

    expect(h.room.phase).toBe("playing");
    expect(h.room.roundNumber).toBe(2);
    expect(h.room.deadline).toBe(2000);
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
});

describe("hostless rooms", () => {
  test("a hostless pause with a present spectator ends the room as no-players", () => {
    const h = makeHarness();
    const host = h.addSeat("Hansi");
    const spectator = h.addSeat("Sepp");
    spectator.role = "spectator";
    h.room.hostSeatId = host.seatId;
    h.room.phase = "intermission";
    h.sent.length = 0;

    h.logic.releaseSeat(h.room, host);

    expect(h.room.hostSeatId).toBe(-1);
    expect(h.expired).toEqual(["no-players"]);
  });

  test("a hostless playing room waits for the round to end, then ends as no-players", () => {
    const h = makeHarness();
    const host = h.addSeat("Hansi");
    const spectator = h.addSeat("Sepp");
    spectator.role = "spectator";
    h.room.hostSeatId = host.seatId;
    h.room.phase = "playing";
    h.room.roundNumber = 1;
    h.room.deadline = 1000;
    h.sent.length = 0;

    h.logic.releaseSeat(h.room, host);
    expect(h.expired).toEqual([]); // the round finishes first

    h.logic.endRound(h.room);
    expect(h.expired).toEqual(["no-players"]);
  });

  test("a fully empty hostless room keeps its empty grace", () => {
    const h = makeHarness({ roomEmptyGraceMs: 300 });
    const host = h.addSeat("Hansi");
    h.room.hostSeatId = host.seatId;
    h.room.phase = "intermission";

    h.logic.releaseSeat(h.room, host);
    expect(h.expired).toEqual([]);

    h.clock.advance(300);
    expect(h.expired).toEqual(["expired"]);
  });

  test("a connecting player becomes host when the room has none", () => {
    const h = makeHarness();
    const player = h.addSeat("Gretl");
    h.room.hostSeatId = -1;
    h.sent.length = 0;

    h.logic.adoptHostIfMissing(h.room, player);

    expect(h.room.hostSeatId).toBe(player.seatId);
    expect(h.sent).toEqual([{ type: "host-changed", hostSeatId: player.seatId }]);
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

describe("join", () => {
  test("a live token reclaims its seat: present, absence cleared, silent, scoreboard refreshed", () => {
    const h = makeHarness();
    const returning = h.addSeat("Hansi");
    h.room.hostSeatId = returning.seatId;
    returning.token = "live-token";
    returning.present = false;
    returning.absentRound = 2;
    h.room.phase = "playing";
    h.room.roundNumber = 4;
    h.clock.advance(25);
    h.sent.length = 0;

    // The nickname is invalid on purpose: the reclaim is checked before any name rule.
    const verdict = h.logic.join(h.room, { token: "live-token", nickname: " " });
    h.logic.announceJoin(h.room, verdict);

    expect(verdict.kind).toBe("reconnected");
    if (verdict.kind !== "reconnected") throw new Error("expected a reconnect");
    expect(verdict.seat).toBe(returning);
    expect(verdict.announceScores).toBe(true);
    expect(returning.present).toBe(true);
    expect(returning.absentRound).toBeNull();
    expect(h.room.seats.size).toBe(1);
    expect(h.room.lastActivity).toBe(25);
    expect(types(h.sent)).not.toContain("player-joined");
  });

  test("a stale token degrades to a new seat instead of refusing", () => {
    const h = makeHarness();
    const holder = h.addSeat("Hansi");
    h.room.hostSeatId = holder.seatId;
    holder.token = "live-token";
    h.sent.length = 0;

    const verdict = h.logic.join(h.room, { token: "dead-token", nickname: "Neu" });

    expect(verdict.kind).toBe("joined");
    if (verdict.kind !== "joined") throw new Error("expected a new join");
    expect(verdict.seat).not.toBe(holder);
    expect(verdict.seat.seatId).not.toBe(holder.seatId);
    expect(verdict.seat.nickname).toBe("Neu");
    expect(h.room.seats.size).toBe(2);
  });

  test("a stale token still degrades to new-player rules, so a reserved name is taken", () => {
    const h = makeHarness();
    const holder = h.addSeat("Hansi");
    h.room.hostSeatId = holder.seatId;
    holder.token = "live-token";
    holder.present = false;

    const verdict = h.logic.join(h.room, { token: "dead-token", nickname: "hansi" });

    expect(verdict).toMatchObject({ kind: "rejected", code: "nickname-taken" });
  });

  test("an invalid nickname is refused before a taken one, with its detail", () => {
    const h = makeHarness();
    const holder = h.addSeat("Hansi");
    h.room.hostSeatId = holder.seatId;
    h.sent.length = 0;

    const verdict = h.logic.join(h.room, { nickname: "   " });

    expect(verdict).toMatchObject({
      kind: "rejected",
      code: "invalid-message",
      detail: "nickname invalid",
    });
    expect(h.room.seats.size).toBe(1);
    expect(h.sent).toEqual([]);
  });

  test("a taken name is folded across all seats, reserved absent ones included", () => {
    const h = makeHarness();
    const host = h.addSeat("Hansi");
    const reserved = h.addSeat("Änne");
    h.room.hostSeatId = host.seatId;
    reserved.present = false;
    reserved.absentRound = 1;
    h.room.phase = "intermission";
    h.room.roundNumber = 1;
    h.sent.length = 0;

    // Trimmed, case-folded and NFC-normalized: "A" + combining diaeresis is "Ä".
    const verdict = h.logic.join(h.room, { nickname: "  a\u0308NNE " });

    expect(verdict).toMatchObject({ kind: "rejected", code: "nickname-taken" });
    expect(h.room.seats.size).toBe(2);
    expect(h.sent).toEqual([]);
  });

  test("a full lobby refuses a new join", () => {
    const h = makeHarness({ maxPlayers: 2 });
    const host = h.addSeat("Hansi");
    h.addSeat("Gretl");
    h.room.hostSeatId = host.seatId;
    h.sent.length = 0;

    const verdict = h.logic.join(h.room, { nickname: "Drei" });

    expect(verdict).toMatchObject({ kind: "rejected", code: "room-full" });
    expect(h.room.seats.size).toBe(2);
    expect(h.sent).toEqual([]);
  });

  test("a playing room admits a mid-round joiner as an uncapped Spectator", () => {
    const h = makeHarness({ maxPlayers: 2 });
    const host = h.addSeat("Hansi");
    h.addSeat("Gretl");
    h.room.hostSeatId = host.seatId;
    h.room.phase = "playing";
    h.room.roundNumber = 1;
    h.sent.length = 0;

    const verdict = h.logic.join(h.room, { nickname: "Drei" });
    h.logic.announceJoin(h.room, verdict);

    expect(verdict.kind).toBe("joined");
    if (verdict.kind !== "joined") throw new Error("expected a new join");
    expect(verdict.seat.role).toBe("spectator");
    expect(verdict.announceScores).toBe(false);
    expect(types(h.sent)).toEqual(["player-joined"]);
  });

  test("the join role table: lobby and intermission joiners are players, only a mid-round joiner is a Spectator", () => {
    for (const phase of ["lobby", "intermission"] as const) {
      const h = makeHarness();
      const host = h.addSeat("Hansi");
      h.room.hostSeatId = host.seatId;
      h.room.phase = phase;
      h.room.roundNumber = phase === "intermission" ? 1 : 0;

      const verdict = h.logic.join(h.room, { nickname: "Neu" });

      expect(verdict.kind).toBe("joined");
      if (verdict.kind !== "joined") throw new Error("expected a new join");
      expect(verdict.seat.role).toBe("player");
    }

    const h = makeHarness();
    const host = h.addSeat("Hansi");
    h.room.hostSeatId = host.seatId;
    h.room.phase = "playing";
    h.room.roundNumber = 1;

    const verdict = h.logic.join(h.room, { nickname: "Neu" });

    expect(verdict.kind).toBe("joined");
    if (verdict.kind !== "joined") throw new Error("expected a new join");
    expect(verdict.seat.role).toBe("spectator");
  });

  test("a lobby join announces player-joined exactly once and asks for no scoreboard", () => {
    const h = makeHarness();
    const host = h.addSeat("Hansi");
    h.room.hostSeatId = host.seatId;
    h.sent.length = 0;

    const verdict = h.logic.join(h.room, { nickname: "Gretl" });
    h.logic.announceJoin(h.room, verdict);

    expect(verdict.kind).toBe("joined");
    if (verdict.kind !== "joined") throw new Error("expected a new join");
    expect(verdict.seat.role).toBe("player");
    expect(verdict.announceScores).toBe(false);
    expect(h.sent).toEqual([
      {
        type: "player-joined",
        player: {
          seatId: verdict.seat.seatId,
          nickname: "Gretl",
          role: "player",
          cumulativeScore: 0,
          connected: true,
        },
      },
    ]);
  });

  test("an intermission join asks for the scoreboard so the newcomer sees the standings", () => {
    const h = makeHarness();
    const host = h.addSeat("Hansi");
    h.room.hostSeatId = host.seatId;
    h.room.phase = "intermission";
    h.room.roundNumber = 1;
    h.sent.length = 0;

    const verdict = h.logic.join(h.room, { nickname: "Spät" });
    h.logic.announceJoin(h.room, verdict);

    expect(verdict).toMatchObject({ kind: "joined", announceScores: true });
    expect(types(h.sent)).toEqual(["player-joined"]);
  });

  test("a new join adopts a missing host before announcing itself", () => {
    const h = makeHarness();
    h.room.hostSeatId = -1;
    h.sent.length = 0;

    const verdict = h.logic.join(h.room, { nickname: "Gretl" });
    h.logic.announceJoin(h.room, verdict);

    expect(verdict.kind).toBe("joined");
    if (verdict.kind !== "joined") throw new Error("expected a new join");
    expect(h.room.hostSeatId).toBe(verdict.seat.seatId);
    expect(types(h.sent)).toEqual(["host-changed", "player-joined"]);
  });

  test("a reconnect adopts a missing host without announcing a join", () => {
    const h = makeHarness();
    const returning = h.addSeat("Hansi");
    returning.token = "live-token";
    returning.present = false;
    h.room.hostSeatId = -1;
    h.sent.length = 0;

    const verdict = h.logic.join(h.room, { token: "live-token", nickname: "Hansi" });
    h.logic.announceJoin(h.room, verdict);

    expect(verdict).toMatchObject({ kind: "reconnected", announceScores: true });
    expect(h.room.hostSeatId).toBe(returning.seatId);
    expect(types(h.sent)).toEqual(["host-changed"]);
  });

  test("a join clears the empty-grace timer that was already running", () => {
    const h = makeHarness({ roomEmptyGraceMs: 300 });
    h.logic.touch(h.room);
    h.logic.maybeScheduleEmptyGrace(h.room); // due at t = 300
    h.clock.advance(100);

    const verdict = h.logic.join(h.room, { nickname: "Hansi" });
    if (verdict.kind !== "joined") throw new Error("expected a new join");
    h.clock.advance(50);
    h.logic.disconnect(h.room, verdict.seat); // empty again; a fresh grace is due at 450

    h.clock.advance(250); // t = 400: the stale 300ms timer must not fire
    expect(h.expired).toEqual([]);

    h.clock.advance(50); // t = 450: only the fresh grace fires
    expect(h.expired).toEqual(["expired"]);
  });
});

describe("submission", () => {
  const BOARD = ["t", "e", "s", "t", "w", "o", "r", "t", "z", "z", "a", "a", "b", "b", "c", "c"];

  function playingHarness(over: Partial<ServerConfig> = {}) {
    const h = makeHarness({
      generateBoard: () => ({ board: BOARD, words: [] }),
      dictionary: { isValid: (w) => ["test", "wort"].includes(w) },
      scoreWord: (word, seatId) => word.length * 10 + seatId,
      ...over,
    });
    const seat = h.addSeat("Hansi");
    h.room.hostSeatId = seat.seatId;
    h.logic.startRound(h.room);
    h.sent.length = 0;
    return { h, seat };
  }

  test("an accepted word records and prices it for this seat, and a repeat is a duplicate", () => {
    const { h, seat } = playingHarness();
    h.clock.advance(10);

    const verdict = h.logic.submitWord(h.room, seat, "  WORT ");

    expect(verdict).toEqual({ kind: "accepted", word: "wort", points: 40 + seat.seatId });
    expect(seat.roundWords).toEqual(new Set(["wort"]));
    expect(seat.roundScore).toBe(40 + seat.seatId);
    expect(seat.cumulativeScore).toBe(40 + seat.seatId);
    expect(h.room.wordsBySeat.get(seat.seatId)).toEqual(["wort"]);
    expect(h.room.lastActivity).toBe(h.clock.now());

    const again = h.logic.submitWord(h.room, seat, "wort");
    expect(again).toMatchObject({ kind: "rejected", code: "word-duplicate", detail: "wort" });
    expect(seat.roundScore).toBe(40 + seat.seatId);
    expect(h.room.wordsBySeat.get(seat.seatId)).toEqual(["wort"]);
  });

  test("the duplicate scope is one seat: another seat may submit the same word", () => {
    const { h, seat } = playingHarness();
    const other = h.addSeat("Gretl");
    h.logic.submitWord(h.room, seat, "wort");

    const verdict = h.logic.submitWord(h.room, other, "wort");

    expect(verdict).toMatchObject({ kind: "accepted", word: "wort" });
  });

  test("round-over wins at the deadline, before not-playing and duplicate", () => {
    const { h, seat } = playingHarness();
    h.room.deadline = h.clock.now(); // exactly at the boundary
    seat.role = "spectator";
    seat.roundWords.add("wort");

    const verdict = h.logic.submitWord(h.room, seat, "wort");

    expect(verdict).toEqual({ kind: "rejected", code: "round-over" });
  });

  test("a submission after the round ended is round-over, not a silent drop", () => {
    const { h, seat } = playingHarness();
    h.clock.advance(1000);
    expect(h.room.phase).toBe("intermission");

    expect(h.logic.submitWord(h.room, seat, "wort")).toEqual({
      kind: "rejected",
      code: "round-over",
    });
  });

  test("a spectator is refused as not playing before the word is inspected", () => {
    const { h, seat } = playingHarness();
    seat.role = "spectator";

    expect(h.logic.submitWord(h.room, seat, "x")).toEqual({
      kind: "rejected",
      code: "not-playing",
    });
  });

  test("a word shorter than three letters is invalid as too short, before duplicate", () => {
    const { h, seat } = playingHarness();
    seat.roundWords.add("ab");

    expect(h.logic.submitWord(h.room, seat, "  Ab ")).toEqual({
      kind: "rejected",
      code: "invalid-word",
      detail: "too short",
    });
  });

  test("the duplicate check runs before placeability and dictionary lookup", () => {
    const { h, seat } = playingHarness();
    seat.roundWords.add("saat"); // neither formable nor known

    expect(h.logic.submitWord(h.room, seat, "saat")).toEqual({
      kind: "rejected",
      code: "word-duplicate",
      detail: "saat",
    });
  });

  test("a known word that the board cannot form is not placeable", () => {
    const { h, seat } = playingHarness({ dictionary: { isValid: () => true } });

    expect(h.logic.submitWord(h.room, seat, "saat")).toEqual({
      kind: "rejected",
      code: "invalid-word",
      detail: "not placeable",
    });
  });

  test("a placeable word outside the dictionary is invalid and carries the word", () => {
    const { h, seat } = playingHarness({ dictionary: { isValid: () => false } });

    expect(h.logic.submitWord(h.room, seat, "TEST")).toEqual({
      kind: "rejected",
      code: "invalid-word",
      detail: "test",
    });
  });

  test("acceptance followed by announceScores broadcasts the scored totals", () => {
    const { h, seat } = playingHarness();
    const other = h.addSeat("Gretl");

    h.logic.submitWord(h.room, seat, "wort");
    h.logic.announceScores(h.room);

    expect(h.sent).toEqual([
      {
        type: "score-update",
        roundNumber: 1,
        scores: [
          { seatId: seat.seatId, nickname: "Hansi", roundScore: 40, cumulativeScore: 40 },
          { seatId: other.seatId, nickname: "Gretl", roundScore: 0, cumulativeScore: 0 },
        ],
      },
    ]);
  });
});

describe("scoreboard announcement", () => {
  test("announceScores broadcasts exactly one score-update with every seat's scores", () => {
    const h = makeHarness();
    const hansi = h.addSeat("Hansi");
    const gretl = h.addSeat("Gretl");
    hansi.roundScore = 5;
    hansi.cumulativeScore = 12;
    gretl.roundScore = 0;
    gretl.cumulativeScore = 3;
    h.room.roundNumber = 2;
    h.sent.length = 0;

    h.logic.announceScores(h.room);

    expect(h.sent).toEqual([
      {
        type: "score-update",
        roundNumber: 2,
        scores: [
          { seatId: hansi.seatId, nickname: "Hansi", roundScore: 5, cumulativeScore: 12 },
          { seatId: gretl.seatId, nickname: "Gretl", roundScore: 0, cumulativeScore: 3 },
        ],
      },
    ]);
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
