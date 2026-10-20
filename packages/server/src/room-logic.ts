/**
 * Room phase and roster rules, decoupled from sockets. A `RoomLogic` receives
 * an injected `Clock` and an injected broadcast function, so the deadline,
 * tick and roster-announcement rules run in tests without real timers or
 * WebSockets. The `Rooms` class owns the sockets, greeting and message
 * dispatch and supplies the two seams.
 */
import type { RoomEndReason, ServerMessage } from "@wortschatz/shared";
import type { ServerConfigResolved } from "./config.js";
import type { Room, Seat } from "./state.js";

/** Injectable time source. Production uses `Date.now` and the Node timers;
 *  tests drive a manual clock and never wait on a real timer. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

/** An opaque scheduled-task handle; only the originating clock interprets it. */
export type TimerHandle = unknown;

/** The production clock: wall time and the process timers. */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

export interface RoomLogicDeps {
  cfg: ServerConfigResolved;
  clock: Clock;
  /** Fan a server message out to every socket seated in the room. */
  broadcast(room: Room, msg: ServerMessage): void;
  /** Send one promoted seat its fresh full snapshot (a wire concern). */
  snapshot(room: Room, seat: Seat): void;
  /** The clock says the room is over; its owner tears down the sockets. */
  expire(room: Room, reason: RoomEndReason): void;
}

/**
 * Phase and roster rules for every room. All timing goes through the injected
 * clock and all announcements through the injected broadcast, so the rules can
 * be exercised directly with a manual clock and a captured broadcast.
 */
export class RoomLogic {
  /** Timer handles, kept separate per kind and keyed by room code. */
  private phaseTimers = new Map<string, TimerHandle>();
  private tickTimers = new Map<string, TimerHandle>();
  private emptyTimers = new Map<string, TimerHandle>();
  private idleChecks = new Map<string, TimerHandle>();

  constructor(private readonly deps: RoomLogicDeps) {}

  /* ------------------------------------------------------------------ */
  /* Roster                                                              */
  /* ------------------------------------------------------------------ */

  /** A new player seat, joined now; the caller binds sockets and sets the token. */
  newSeat(room: Room, nickname: string): Seat {
    const seat: Seat = {
      seatId: room.nextSeatId++,
      nickname,
      role: "player",
      cumulativeScore: 0,
      token: "",
      present: true,
      sockets: new Set(),
      joinedAt: this.deps.clock.now(),
      absentRound: null,
      autoReleased: false,
      roundWords: new Set(),
      roundScore: 0,
    };
    room.seats.set(seat.seatId, seat);
    return seat;
  }

  findSeatByToken(room: Room, token: string): Seat | null {
    for (const seat of room.seats.values()) {
      if (seat.token === token) return seat;
    }
    return null;
  }

  isHost(room: Room, seat: Seat): boolean {
    return room.hostSeatId === seat.seatId;
  }

  /** A returning holder: present again, with its absence clock reset. */
  markPresent(seat: Seat): void {
    seat.present = true;
    seat.absentRound = null;
  }

  /**
   * The roster half of a socket drop. A seat whose last socket is gone is
   * reserved (not released): marked absent, announced, and — when it was the
   * host — handed to a successor.
   */
  disconnect(room: Room, seat: Seat): void {
    if (seat.sockets.size !== 0 || !seat.present) return;
    seat.present = false;
    if (room.phase === "lobby") {
      seat.absentRound = 0;
    } else if (seat.absentRound == null) {
      seat.absentRound = room.roundNumber;
    }
    this.deps.cfg.log.info({ event: "disconnect", room: room.code, seat: seat.seatId });
    this.deps.broadcast(room, {
      type: "player-disconnected",
      seatId: seat.seatId,
      nickname: seat.nickname,
    });
    if (room.hostSeatId === seat.seatId) {
      this.moveHostToSuccessor(room);
    }
    this.afterRosterChange(room);
  }

  /**
   * The one emission point for a seat leaving the roster. It removes the seat
   * and announces the departure in a fixed order — the successor host first
   * (`host-changed`, when the departing seat was host), then the roster removal
   * (`player-left`) — so leave, kick and auto-release cannot disagree and each
   * change is announced exactly once.
   */
  releaseSeat(room: Room, seat: Seat): void {
    const wasHost = room.hostSeatId === seat.seatId;
    room.seats.delete(seat.seatId);
    seat.autoReleased = true;
    if (wasHost) {
      this.moveHostToSuccessor(room);
    }
    this.deps.broadcast(room, { type: "player-left", seatId: seat.seatId, nickname: seat.nickname });
    this.afterRosterChange(room);
  }

  /**
   * A disconnected seat auto-releases once its holder has missed a full
   * round plus intermission. Evaluated at each round start: a seat absent
   * since a round strictly older than the previous one had a complete round
   * and intermission to return.
   */
  autoReleaseStaleSeats(room: Room): void {
    for (const seat of [...room.seats.values()]) {
      if (seat.present || seat.autoReleased) continue;
      if (seat.absentRound == null) {
        seat.absentRound = room.roundNumber;
        continue;
      }
      const missedRounds = room.roundNumber - seat.absentRound;
      if (missedRounds >= 2) {
        this.deps.cfg.log.info({
          event: "seat-released",
          room: room.code,
          seat: seat.seatId,
          missedRounds,
        });
        this.releaseSeat(room, seat);
      }
    }
  }

  /** Explicit hand-off; the caller has validated the target is a player. */
  setHost(room: Room, targetSeatId: number): void {
    room.hostSeatId = targetSeatId;
    this.deps.broadcast(room, { type: "host-changed", hostSeatId: room.hostSeatId });
  }

  /** Host self-heal: a seat connecting into a hostless room claims the role,
   *  so a room can never be stranded without a host while anyone is present. */
  claimHostIfVacant(room: Room, seat: Seat): void {
    if (room.hostSeatId !== -1) return;
    room.hostSeatId = seat.seatId;
    this.deps.broadcast(room, { type: "host-changed", hostSeatId: room.hostSeatId });
  }

  /** Host duties move to the longest-connected remaining connected player. */
  private moveHostToSuccessor(room: Room): void {
    const candidates = [...room.seats.values()]
      .filter((s) => s.present && s.role === "player")
      .sort((a, b) => a.joinedAt - b.joinedAt || a.seatId - b.seatId);
    if (candidates.length === 0) {
      room.hostSeatId = -1;
      return;
    }
    room.hostSeatId = candidates[0]!.seatId;
    this.deps.broadcast(room, { type: "host-changed", hostSeatId: room.hostSeatId });
  }

  /** Connected player seats: the promotion cap at round start counts only
   *  players who are actually present. */
  playerCount(room: Room): number {
    let n = 0;
    for (const s of room.seats.values()) if (s.role === "player" && s.present) n++;
    return n;
  }

  hasPresentOccupant(room: Room): boolean {
    return [...room.seats.values()].some((s) => s.present);
  }

  /**
   * After any roster change that could strip a non-playing room of its host,
   * the pause cannot go on: it ends. An empty room keeps its empty grace
   * instead, so a room everyone left still lingers for a reconnect.
   */
  private afterRosterChange(room: Room): void {
    if (this.endDeadPause(room)) return;
    this.maybeScheduleEmptyGrace(room);
  }

  /** A non-playing room with no host and someone still present ends now. */
  private endDeadPause(room: Room): boolean {
    if (room.phase === "playing") return false;
    if (room.hostSeatId !== -1) return false;
    if (!this.hasPresentOccupant(room)) return false;
    this.deps.cfg.log.info({ event: "room-expired", room: room.code, reason: "no-players" });
    this.deps.expire(room, "no-players");
    return true;
  }

  touch(room: Room): void {
    room.lastActivity = this.deps.clock.now();
  }

  /* ------------------------------------------------------------------ */
  /* Expiry timers                                                       */
  /* ------------------------------------------------------------------ */

  maybeScheduleEmptyGrace(room: Room): void {
    if (this.hasPresentOccupant(room)) return;
    if (this.emptyTimers.has(room.code)) return;
    this.emptyTimers.set(
      room.code,
      this.deps.clock.setTimeout(() => {
        this.emptyTimers.delete(room.code);
        if (!room.closing && !this.hasPresentOccupant(room)) {
          this.deps.cfg.log.info({ event: "room-expired", room: room.code, reason: "empty-grace" });
          this.deps.expire(room, "expired");
        }
      }, this.deps.cfg.roomEmptyGraceMs)
    );
  }

  clearEmptyTimer(room: Room): void {
    const t = this.emptyTimers.get(room.code);
    if (t !== undefined) this.deps.clock.clearTimeout(t);
    this.emptyTimers.delete(room.code);
  }

  scheduleIdleCheck(room: Room): void {
    if (this.idleChecks.has(room.code)) return;
    const interval = Math.max(1, Math.floor(Math.min(this.deps.cfg.roomIdleMs / 4, 60_000)));
    let handle: TimerHandle;
    handle = this.deps.clock.setInterval(() => {
      if (room.closing) {
        this.deps.clock.clearInterval(handle);
        this.idleChecks.delete(room.code);
        return;
      }
      if (this.deps.clock.now() - room.lastActivity > this.deps.cfg.roomIdleMs) {
        this.deps.clock.clearInterval(handle);
        this.idleChecks.delete(room.code);
        this.deps.cfg.log.info({ event: "room-expired", room: room.code, reason: "idle" });
        this.deps.expire(room, "expired");
      }
    }, interval);
    this.idleChecks.set(room.code, handle);
  }

  /* ------------------------------------------------------------------ */
  /* Phase machine                                                       */
  /* ------------------------------------------------------------------ */

  /** The round's clock still admits submissions: playing, before the deadline. */
  acceptsSubmissions(room: Room): boolean {
    return room.phase === "playing" && this.deps.clock.now() < room.deadline;
  }

  startRound(room: Room): void {
    room.roundNumber += 1;
    room.phase = "playing";
    const seed = this.deps.cfg.seedSource();
    const generated = this.deps.cfg.generateBoard(seed);
    room.seed = seed;
    room.board = generated.board;
    room.words = generated.words;
    room.deadline = this.deps.clock.now() + this.deps.cfg.roundMs;
    room.reveal = null;
    room.wordsBySeat = new Map();
    for (const seat of room.seats.values()) {
      seat.roundWords = new Set();
      seat.roundScore = 0;
      room.wordsBySeat.set(seat.seatId, []);
    }
    // Spectators are promoted to players exactly at round-start, in join
    // order, until the player cap is reached.
    let players = this.playerCount(room);
    const promoted: Seat[] = [];
    for (const seat of [...room.seats.values()].sort((a, b) => a.seatId - b.seatId)) {
      if (seat.role === "spectator" && players < this.deps.cfg.maxPlayers) {
        seat.role = "player";
        promoted.push(seat);
        players += 1;
      }
    }
    this.autoReleaseStaleSeats(room);
    this.armPhaseTimer(room);
    this.armTickLoop(room);
    this.deps.cfg.log.info({
      event: "round-start",
      room: room.code,
      round: room.roundNumber,
      seed: room.seed.toString(),
    });
    this.deps.broadcast(room, {
      type: "round-start",
      round: { roundNumber: room.roundNumber, board: room.board, deadline: room.deadline },
    });
    this.deps.broadcast(room, {
      type: "tick",
      remaining: room.deadline - this.deps.clock.now(),
      deadline: room.deadline,
    });
    // Every promoted seat is told its new role through a full snapshot
    // (a snapshot always supersedes deltas): the client flips the game
    // screen's input affordance on without a resync round-trip.
    for (const seat of promoted) {
      this.deps.snapshot(room, seat);
    }
  }

  endRound(room: Room): void {
    room.phase = "intermission";
    // The pause has no clock: `deadline` only ever means the playing round.
    room.deadline = 0;
    room.reveal = this.deps.cfg.reveal({
      words: room.words,
      wordsBySeat: room.wordsBySeat,
      // #6 prices a word identically for every seat, so the reveal shows the
      // shared word price: priced ownerless, via the engine's "no seat" id.
      points: (word) => this.deps.cfg.scoreWord(word, -1),
    });
    this.deps.cfg.log.info({ event: "round-end", room: room.code, round: room.roundNumber });
    this.deps.broadcast(room, {
      type: "round-end",
      roundNumber: room.roundNumber,
      reveal: room.reveal,
    });
    // The round clock is over: stop both of its timers. The pause is
    // host-paced — nothing here advances the room on its own.
    this.clearPhaseTimer(room);
    this.clearTickLoop(room);
    // The pause may have lost its host before it began: end it now if so.
    this.endDeadPause(room);
  }

  private armPhaseTimer(room: Room): void {
    this.clearPhaseTimer(room);
    const remain = Math.max(0, room.deadline - this.deps.clock.now());
    this.phaseTimers.set(
      room.code,
      this.deps.clock.setTimeout(() => this.onPhaseDeadline(room), remain)
    );
  }

  /** Fired at (about) the absolute deadline; re-arms when fired early. The
   *  only armed phase timer is the round clock. */
  private onPhaseDeadline(room: Room): void {
    if (room.phase === "closed" || room.closing) return;
    const now = this.deps.clock.now();
    if (now < room.deadline - 25) {
      this.armPhaseTimer(room); // coalesced early fire: re-arm for the remainder
      return;
    }
    if (room.phase === "playing") {
      this.endRound(room);
    }
  }

  /** The round clock's 1 Hz re-anchor; armed by `startRound`, stopped by
   *  `endRound`. A tick never carries the pause. */
  private armTickLoop(room: Room): void {
    this.clearTickLoop(room);
    const fire = () => {
      if (room.closing || room.phase !== "playing") return;
      const remaining = Math.max(0, room.deadline - this.deps.clock.now());
      this.deps.broadcast(room, { type: "tick", remaining, deadline: room.deadline });
      this.tickTimers.set(room.code, this.deps.clock.setTimeout(fire, this.deps.cfg.tickIntervalMs));
    };
    this.tickTimers.set(room.code, this.deps.clock.setTimeout(fire, this.deps.cfg.tickIntervalMs));
  }

  private clearTickLoop(room: Room): void {
    const t = this.tickTimers.get(room.code);
    if (t !== undefined) this.deps.clock.clearTimeout(t);
    this.tickTimers.delete(room.code);
  }

  private clearPhaseTimer(room: Room): void {
    const t = this.phaseTimers.get(room.code);
    if (t !== undefined) this.deps.clock.clearTimeout(t);
    this.phaseTimers.delete(room.code);
  }

  /* ------------------------------------------------------------------ */
  /* Room end                                                            */
  /* ------------------------------------------------------------------ */

  /** Stop every timer this room owns; the room is leaving the map. */
  destroy(room: Room): void {
    this.clearPhaseTimer(room);
    this.clearTickLoop(room);
    this.clearEmptyTimer(room);
    const idle = this.idleChecks.get(room.code);
    if (idle !== undefined) this.deps.clock.clearInterval(idle);
    this.idleChecks.delete(room.code);
  }
}
