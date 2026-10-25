/**
 * Room phase and roster rules, decoupled from sockets. A `RoomLogic` receives
 * an injected `Clock` and an injected broadcast function, so the deadline,
 * tick and roster-announcement rules run in tests without real timers or
 * WebSockets. The `Rooms` class owns the sockets, greeting and message
 * dispatch and supplies the two seams.
 */
import type { ErrorCode, RoomEndReason, ScoreEntry, ServerMessage } from "@wortschatz/shared";
import type { ServerConfigResolved } from "./config.js";
import { isFormable } from "./boardgen/index.js";
import { seatInfo, type Room, type Seat } from "./state.js";
import { fold, normalizeNickname, normalizeWord, validNickname } from "./text.js";

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

/** A raw join request: the rule normalizes and checks it itself. */
export interface JoinRequest {
  token?: string;
  nickname: string;
}

/**
 * What the join rule decided. Only a refusal carries an error code; a
 * reconnect or join carries the seat and the rule's answer to whether the
 * room-wide scoreboard must follow the adapter's snapshot.
 */
export type JoinVerdict =
  | { kind: "reconnected"; seat: Seat; announceScores: true }
  | { kind: "joined"; seat: Seat; announceScores: boolean }
  | { kind: "rejected"; code: ErrorCode; detail?: string };

/** What the submission rule decided: a priced acceptance or a refusal. */
export type SubmitVerdict =
  { kind: "accepted"; word: string; points: number } | { kind: "rejected"; code: ErrorCode; detail?: string };

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
    this.maybeScheduleEmptyGrace(room);
    this.maybeEndHostlessNonPlayingRoom(room);
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
    this.maybeScheduleEmptyGrace(room);
    this.maybeEndHostlessNonPlayingRoom(room);
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

  /** A room without a host adopts the connecting seat, so a hostless room
   *  can recover on the next arrival instead of dead-ending. */
  adoptHostIfMissing(room: Room, seat: Seat): void {
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

  /** Connected player seats, used to cap spectator promotion at round start. */
  playerCount(room: Room): number {
    let n = 0;
    for (const s of room.seats.values()) if (s.role === "player" && s.present) n++;
    return n;
  }

  hasPresentOccupant(room: Room): boolean {
    return [...room.seats.values()].some((s) => s.present);
  }

  touch(room: Room): void {
    room.lastActivity = this.deps.clock.now();
  }

  /* ------------------------------------------------------------------ */
  /* Join                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * The one decision about entering a live room, in precedence order: reclaim
   * a seat by token, then validate the nickname, then refuse a folded
   * duplicate across every seat (reserved absent ones included), then refuse
   * a full lobby when the room is not playing. A mid-round admission is a
   * Spectator. The rule marks presence and clears the absence and the empty
   * grace; the adapter mints the token, binds the socket, then calls
   * `announceJoin` so the newcomer is bound before the room-wide frames.
   */
  join(room: Room, request: JoinRequest): JoinVerdict {
    const returning = request.token ? this.findSeatByToken(room, request.token) : null;
    if (returning) {
      this.markPresent(returning);
      this.enterSeat(room);
      return { kind: "reconnected", seat: returning, announceScores: true };
    }
    const nickname = normalizeNickname(request.nickname);
    if (!validNickname(nickname)) {
      return { kind: "rejected", code: "invalid-message", detail: "nickname invalid" };
    }
    const taken = [...room.seats.values()].some((s) => fold(s.nickname) === fold(nickname));
    if (taken) {
      return { kind: "rejected", code: "nickname-taken" };
    }
    // Player seats are capped; a mid-round joiner is a spectator and waits for
    // the next round-start (promotion is capped out in join order there).
    if (room.phase !== "playing" && room.seats.size >= this.deps.cfg.maxPlayers) {
      return { kind: "rejected", code: "room-full" };
    }
    const seat = this.newSeat(room, nickname);
    if (room.phase === "playing") seat.role = "spectator";
    this.enterSeat(room);
    return { kind: "joined", seat, announceScores: room.phase === "intermission" };
  }

  /**
   * The room-wide half of a join, called after the adapter bound the socket so
   * the newcomer receives the same frames as everyone else: adopt a missing
   * host first (`host-changed`), then announce a new seat (`player-joined`).
   * A reconnect only announces the adoption, because its seat never left the
   * roster.
   */
  announceJoin(room: Room, verdict: JoinVerdict): void {
    if (verdict.kind === "rejected") return;
    this.adoptHostIfMissing(room, verdict.seat);
    if (verdict.kind === "joined") {
      this.deps.broadcast(room, { type: "player-joined", player: seatInfo(verdict.seat) });
    }
  }

  /** The seat-entry sequence shared by a reclaim and a new join. Host adoption
   *  stays in `announceJoin`, after the adapter has bound the socket. */
  private enterSeat(room: Room): void {
    this.touch(room);
    this.clearEmptyTimer(room);
  }

  /**
   * The one decision about a submitted word. The seat's raw input is
   * normalized and checked here; an acceptance records the word for this
   * seat, prices it for this seat and adds it to the round and cumulative
   * scores and the round's word list. The adapter echoes the reply and then
   * asks for the room-wide scoreboard.
   */
  submitWord(room: Room, seat: Seat, rawWord: string): SubmitVerdict {
    if (!this.acceptsSubmissions(room)) {
      return { kind: "rejected", code: "round-over" };
    }
    if (seat.role === "spectator") {
      return { kind: "rejected", code: "not-playing" };
    }
    const word = normalizeWord(rawWord);
    if (word.length < 3) {
      return { kind: "rejected", code: "invalid-word", detail: "too short" };
    }
    if (seat.roundWords.has(word)) {
      return { kind: "rejected", code: "word-duplicate", detail: word };
    }
    if (!isFormable(word, room.board)) {
      return { kind: "rejected", code: "invalid-word", detail: "not placeable" };
    }
    if (!this.deps.cfg.dictionary.isValid(word)) {
      return { kind: "rejected", code: "invalid-word", detail: word };
    }
    const points = this.deps.cfg.scoreWord(word, seat.seatId);
    seat.roundWords.add(word);
    seat.roundScore += points;
    seat.cumulativeScore += points;
    const list = room.wordsBySeat.get(seat.seatId);
    if (list) list.push(word);
    this.touch(room);
    return { kind: "accepted", word, points };
  }

  /** The one room-wide scoreboard projection: the moved `score-update` fan-out. */
  announceScores(room: Room): void {
    const scores: ScoreEntry[] = [...room.seats.values()].map((s) => ({
      seatId: s.seatId,
      nickname: s.nickname,
      roundScore: s.roundScore,
      cumulativeScore: s.cumulativeScore,
    }));
    this.deps.broadcast(room, { type: "score-update", roundNumber: room.roundNumber, scores });
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
    room.wikiLinks = null;
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

  /** Enter the host-paced pause: no clock, no timer, no tick — the next
   *  round starts only when the host asks for it. */
  endRound(room: Room): void {
    room.phase = "intermission";
    room.deadline = 0;
    room.wikiLinks = null;
    room.reveal = this.deps.cfg.reveal({
      words: room.words,
      wordsBySeat: room.wordsBySeat,
      // #6 prices a word identically for every seat, so the reveal shows the
      // shared word price: priced ownerless, via the engine's "no seat" id.
      points: (word) => this.deps.cfg.scoreWord(word, -1),
    });
    this.clearPhaseTimer(room);
    this.clearTickLoop(room);
    this.deps.cfg.log.info({ event: "round-end", room: room.code, round: room.roundNumber });
    this.deps.broadcast(room, {
      type: "round-end",
      roundNumber: room.roundNumber,
      reveal: room.reveal,
    });
    // The outbound lookup starts only after the reveal is on the wire: a
    // slow dictionary can never delay the end of a round.
    void this.resolveWikiLinks(room, room.roundNumber);
    this.maybeEndHostlessNonPlayingRoom(room);
  }

  /** Fill the finished round's exact-form dictionary links, then announce
   *  them. A failure (including an injected lookup's rejection) is simply
   *  "no icons this round"; a stale result for a later round is dropped. */
  private async resolveWikiLinks(room: Room, roundNumber: number): Promise<void> {
    const words = [...new Set(room.reveal?.groups.flatMap((g) => g.words.map((w) => w.word)) ?? [])];
    if (words.length === 0) return;
    let links: Map<string, string>;
    try {
      links = await this.deps.cfg.lookupWikiLinks(words);
    } catch {
      return;
    }
    if (room.closing || room.phase !== "intermission" || room.roundNumber !== roundNumber) return;
    if (links.size === 0) return;
    room.wikiLinks = Object.fromEntries(links);
    this.deps.broadcast(room, {
      type: "wiki-links",
      roundNumber,
      links: room.wikiLinks,
    });
  }

  private armPhaseTimer(room: Room): void {
    this.clearPhaseTimer(room);
    const remain = Math.max(0, room.deadline - this.deps.clock.now());
    this.phaseTimers.set(
      room.code,
      this.deps.clock.setTimeout(() => this.onPhaseDeadline(room), remain)
    );
  }

  /** Fired at (about) the absolute deadline; re-arms when fired early. */
  private onPhaseDeadline(room: Room): void {
    if (room.phase === "closed" || room.closing) return;
    const now = this.deps.clock.now();
    if (now < room.deadline - 25) {
      this.armPhaseTimer(room); // coalesced early fire: re-arm for the remainder
      return;
    }
    if (room.phase === "playing") this.endRound(room);
  }

  /** The tick loop carries the round clock only; the pause has no clock. */
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

  /**
   * A non-playing room left without a host and with someone still present has
   * no way forward: end it cleanly instead of hanging. A fully empty room
   * keeps its existing grace period, and a hostless `playing` room finishes
   * its round first — this check then fires on entry to the pause.
   */
  private maybeEndHostlessNonPlayingRoom(room: Room): void {
    if (room.phase === "playing" || room.phase === "closed" || room.closing) return;
    if (room.hostSeatId !== -1) return;
    if (!this.hasPresentOccupant(room)) return;
    this.deps.cfg.log.info({
      event: "room-ended",
      room: room.code,
      reason: "no-players",
    });
    this.deps.expire(room, "no-players");
  }

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
