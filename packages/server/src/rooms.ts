import { WebSocket } from "ws";
import type { ClientMessage, PlayerInfo, ScoreEntry, ServerMessage, SnapshotMsg } from "@wordament/shared";
import type { ServerConfigResolved } from "./config.js";
import { Connection } from "./connection.js";
import { Pinger } from "./hardening.js";
import { makeRoomCode, makeToken, type Room, type Seat } from "./state.js";
interface ConnState {
  conn: Connection;
  roomId: string | null;
  seatId: number | null;
}
/** Per-room timer handles, keyed separately per kind. */
export class Rooms {
  readonly rooms = new Map<string, Room>();
  private conns = new Map<WebSocket, ConnState>();
  private pingers = new Map<WebSocket, Pinger>();
  private phaseTimers = new Map<string, NodeJS.Timeout>();
  private tickTimers = new Map<string, NodeJS.Timeout>();
  private emptyTimers = new Map<string, NodeJS.Timeout>();
  private idleChecks = new Map<string, NodeJS.Timeout>();
  constructor(private cfg: ServerConfigResolved) {}
  /* ------------------------------------------------------------------ */
  /* Socket attachment / teardown                                        */
  /* ------------------------------------------------------------------ */
  attach(ws: WebSocket): void {
    const conn = new Connection(ws, {
      cfg: this.cfg,
      authenticate: (msg, sock) => this.authenticate(msg, sock),
      dispatch: (msg, sock) => this.dispatch(msg, sock),
      gone: (sock) => this.onSocketGone(sock),
    });
    const pinger = new Pinger(ws, this.cfg.pongGraceMs, () => conn.terminate());

    this.pingers.set(ws, pinger);
    this.conns.set(ws, { conn, roomId: null, seatId: null });
  }
  pingAll(): void {
    const now = Date.now();
    for (const p of this.pingers.values()) p.tick(now);
  }
  private onSocketGone(ws: WebSocket): void {
    const state = this.conns.get(ws);
    if (!state) return;
    this.conns.delete(ws);
    this.pingers.delete(ws);
    if (!state.roomId || state.seatId == null) return;
    const room = this.rooms.get(state.roomId);
    const seat = room?.seats.get(state.seatId);
    if (!room || !seat) return;
    seat.sockets.delete(ws);
    if (seat.sockets.size === 0 && seat.present) {
      seat.present = false;
      if (room.phase === "lobby") {
        seat.absentRound = 0;
      } else if (seat.absentRound == null) {
        seat.absentRound = room.roundNumber;
      }
      this.cfg.log.info({ event: "disconnect", room: room.code, seat: seat.seatId });
      this.broadcast(room, {
        type: "player-disconnected",
        seatId: seat.seatId,
        nickname: seat.nickname,
      });
      if (room.hostSeatId === seat.seatId) {
        this.transferHost(room);
      }
      this.maybeScheduleEmptyGrace(room);
    }
  }
  /* ------------------------------------------------------------------ */
  /* Greeting: exactly one create-room or join                           */
  /* ------------------------------------------------------------------ */
  private authenticate(msg: ClientMessage, ws: WebSocket): void {
    if (msg.type === "create-room") {
      this.handleCreateRoom(msg, ws);
      return;
    }
    if (msg.type === "join") {
      this.handleJoin(msg, ws);
      return;
    }
    this.sendTo(ws, {
      type: "error",
      code: "invalid-message",
      message: "first message must be create-room or join",
    });
  }
  private handleCreateRoom(msg: Extract<ClientMessage, { type: "create-room" }>, ws: WebSocket): void {
    if (this.rooms.size >= this.cfg.maxRooms) {
      this.sendTo(ws, {
        type: "error",
        reqId: msg.reqId,
        code: "server-full",
        message: "room capacity reached",
      });
      return;
    }
    const nickname = normalizeNickname(msg.nickname);
    if (!validNickname(nickname)) {
      this.sendTo(ws, {
        type: "error",
        reqId: msg.reqId,
        code: "invalid-message",
        message: "nickname invalid",
      });
      return;
    }
    const code = this.mintCode();
    const room: Room = {
      code,
      phase: "lobby",
      hostSeatId: -1,
      roundNumber: 0,
      board: [],
      deadline: 0,
      seats: new Map(),
      nextSeatId: 0,
      reveal: null,
      wordsBySeat: new Map(),
      lastActivity: Date.now(),
      closing: false,
    };
    this.rooms.set(code, room);
    const seat = this.newSeat(room, nickname);
    room.hostSeatId = seat.seatId;
    seat.token = makeToken();
    this.bindConn(ws, room, seat);
    this.scheduleIdleCheck(room);
    this.cfg.log.info({ event: "room-created", room: code, seat: seat.seatId });
    this.sendSnapshot(ws, room, seat, msg.reqId, seat.token);
  }
  private handleJoin(msg: Extract<ClientMessage, { type: "join" }>, ws: WebSocket): void {
    const code = normalizeCode(msg.code);
    const room = this.rooms.get(code);
    // Unresolvable code / expired room: one generic outcome, zero probing.
    if (!room || room.phase === "closed" || room.closing) {
      this.sendTo(ws, { type: "error", reqId: msg.reqId, code: "room-not-found" });
      this.cfg.log.info({ event: "join-rejected", room: code, reason: "room-not-found" });
      return;
    }
    // Token reclaim first: opaque, room-lifetime; a stale token is never an
    // error — it silently degrades to new-player semantics.
    const seat = msg.token ? this.findSeatByToken(room, msg.token) : null;
    if (seat) {
      this.bindConn(ws, room, seat);
      seat.present = true;
      seat.absentRound = null;
      this.touch(room);
      this.clearEmptyTimer(room);
      this.cfg.log.info({ event: "reconnect", room: room.code, seat: seat.seatId });
      this.sendSnapshot(ws, room, seat, msg.reqId, seat.token);
      // Reconnect repair: room-wide scoreboard refresh that also carries
      // the reclaimed seat back into everyone's view.
      this.broadcastScores(room);
      this.tryAutoAdvance(room);
      return;
    }
    const nickname = normalizeNickname(msg.nickname);
    if (!validNickname(nickname)) {
      this.sendTo(ws, {
        type: "error",
        reqId: msg.reqId,
        code: "invalid-message",
        message: "nickname invalid",
      });
      return;
    }
    const taken = [...room.seats.values()].some((s) => fold(s.nickname) === fold(nickname));
    if (taken) {
      this.sendTo(ws, { type: "error", reqId: msg.reqId, code: "nickname-taken" });
      return;
    }
    if (room.seats.size >= this.cfg.maxPlayers) {
      this.sendTo(ws, { type: "error", reqId: msg.reqId, code: "room-full" });
      return;
    }
    const created = this.newSeat(room, nickname);
    created.token = makeToken();
    if (room.phase === "playing") created.role = "spectator";
    this.bindConn(ws, room, created);
    this.touch(room);
    this.clearEmptyTimer(room);
    this.cfg.log.info({
      event: "join",
      room: room.code,
      seat: created.seatId,
      role: created.role,
    });
    this.broadcast(room, { type: "player-joined", player: seatInfo(created) });
    this.sendSnapshot(ws, room, created, msg.reqId, created.token);
    this.tryAutoAdvance(room);
  }
  private findSeatByToken(room: Room, token: string): Seat | null {
    for (const seat of room.seats.values()) {
      if (seat.token === token) return seat;
    }
    return null;
  }
  private newSeat(room: Room, nickname: string): Seat {
    const seat: Seat = {
      seatId: room.nextSeatId++,
      nickname,
      role: "player",
      cumulativeScore: 0,
      token: "",
      present: true,
      sockets: new Set(),
      joinedAt: Date.now(),
      absentRound: null,
      autoReleased: false,
      roundWords: new Set(),
      roundScore: 0,
    };
    room.seats.set(seat.seatId, seat);
    return seat;
  }
  private mintCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const code = makeRoomCode(this.cfg.roomCodeLength);
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("room code space exhausted");
  }
  private bindConn(ws: WebSocket, room: Room, seat: Seat): void {
    const state = this.conns.get(ws);
    if (state) {
      state.roomId = room.code;
      state.seatId = seat.seatId;
    }
    seat.sockets.add(ws);
    seat.present = true;
  }
  /* ------------------------------------------------------------------ */
  /* Dispatch after greeting                                             */
  /* ------------------------------------------------------------------ */
  private dispatch(msg: ClientMessage, ws: WebSocket): void {
    const state = this.conns.get(ws);
    if (!state || state.roomId == null || state.seatId == null) {
      // A rejected greet (e.g. nickname-taken) leaves the socket reusable:
      // create-room / join may be tried again.
      if (msg.type === "create-room" || msg.type === "join") {
        this.authenticate(msg, ws);
        return;
      }
      this.sendTo(ws, {
        type: "error",
        reqId: msg.reqId,
        code: "invalid-message",
        message: "not bound to a room",
      });
      return;
    }
    const room = this.rooms.get(state.roomId);
    const seat = room?.seats.get(state.seatId);
    if (!room || !seat) {
      this.sendTo(ws, { type: "error", reqId: msg.reqId, code: "room-not-found" });
      return;
    }
    switch (msg.type) {
      case "submit-word":
        this.handleSubmitWord(room, seat, msg);
        break;
      case "start-round":
        this.handleStartRound(room, seat, msg.reqId);
        break;
      case "skip":
        this.handleSkip(room, seat, msg.reqId);
        break;
      case "kick":
        this.handleKick(room, seat, msg.seatId, msg.reqId);
        break;
      case "transfer-host":
        this.handleTransferHost(room, seat, msg.seatId, msg.reqId);
        break;
      case "close-room":
        this.handleCloseRoom(room, seat, msg.reqId);
        break;
      case "leave":
        this.handleLeave(room, seat);
        break;
      case "resync":
        this.sendSnapshot(ws, room, seat, msg.reqId, seat.token);
        break;
      default:
        // Room-bound for its lifetime; switching rooms means a fresh socket.
        this.sendTo(ws, {
          type: "error",
          reqId: msg.reqId,
          code: "invalid-message",
          message: "already bound to a room",
        });
        break;
    }
  }
  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */
  private handleSubmitWord(
    room: Room,
    seat: Seat,
    msg: Extract<ClientMessage, { type: "submit-word" }>
  ): void {
    // Playing-only; submissions after the boundary are explicitly round-over.
    if (room.phase !== "playing" || Date.now() >= room.deadline) {
      this.sendToSeat(seat, { type: "error", reqId: msg.reqId, code: "round-over" });
      return;
    }
    if (seat.role === "spectator") {
      this.sendToSeat(seat, { type: "error", reqId: msg.reqId, code: "not-playing" });
      return;
    }
    const word = normalizeWord(msg.word);
    if (word.length < 3) {
      this.sendToSeat(seat, { type: "error", reqId: msg.reqId, code: "invalid-word", message: "too short" });
      return;
    }
    if (seat.roundWords.has(word)) {
      this.sendToSeat(seat, { type: "error", reqId: msg.reqId, code: "word-duplicate", message: word });
      return;
    }
    if (!this.cfg.dictionary.isValid(word)) {
      this.sendToSeat(seat, { type: "error", reqId: msg.reqId, code: "invalid-word", message: word });
      return;
    }
    const placeable = this.cfg.dictionary.isPathable?.(word, room.board) ?? true;
    if (!placeable) {
      this.sendToSeat(seat, {
        type: "error",
        reqId: msg.reqId,
        code: "invalid-word",
        message: "not placeable",
      });
      return;
    }
    seat.roundWords.add(word);
    const points = this.cfg.scoreWord(word, seat.seatId);
    seat.roundScore += points;
    seat.cumulativeScore += points;
    const list = room.wordsBySeat.get(seat.seatId);
    if (list) list.push(word);
    this.touch(room);
    this.sendToSeat(seat, { type: "word-accepted", reqId: msg.reqId, word, points });
    this.broadcastScores(room);
  }
  private requireHost(room: Room, seat: Seat, reqId?: number): boolean {
    if (room.hostSeatId !== seat.seatId) {
      this.sendToSeat(seat, { type: "error", reqId, code: "not-host" });
      return false;
    }
    return true;
  }
  private handleStartRound(room: Room, seat: Seat, reqId?: number): void {
    if (!this.requireHost(room, seat, reqId)) return;
    if (room.phase !== "lobby" && room.phase !== "intermission") {
      this.sendToSeat(seat, { type: "error", reqId, code: "invalid-phase" });
      return;
    }
    if (this.playerCount(room) < 2) {
      this.sendToSeat(seat, { type: "error", reqId, code: "need-players" });
      return;
    }
    this.touch(room);
    this.startRound(room);
  }
  private handleSkip(room: Room, seat: Seat, reqId?: number): void {
    if (!this.requireHost(room, seat, reqId)) return;
    if (room.phase !== "intermission") {
      this.sendToSeat(seat, { type: "error", reqId, code: "invalid-phase" });
      return;
    }
    // Skipping is expressed by pulling the intermission deadline forward —
    // the same clock fabric, never an extension.
    room.deadline = Date.now();
    this.armPhaseTimer(room);
    this.broadcast(room, {
      type: "tick",
      phase: "intermission",
      remaining: 0,
      deadline: room.deadline,
    });
    this.touch(room);
  }
  private handleKick(room: Room, host: Seat, targetSeatId: number, reqId?: number): void {
    if (!this.requireHost(room, host, reqId)) return;
    if (targetSeatId === room.hostSeatId) {
      this.sendToSeat(host, {
        type: "error",
        reqId,
        code: "invalid-message",
        message: "cannot kick the host",
      });
      return;
    }
    const target = room.seats.get(targetSeatId);
    if (!target || target.autoReleased) {
      this.sendToSeat(host, { type: "error", reqId, code: "invalid-message", message: "no such seat" });
      return;
    }
    this.cfg.log.info({ event: "kick", room: room.code, seat: targetSeatId });
    const sockets = [...target.sockets];
    this.releaseSeat(room, target);
    this.broadcast(room, { type: "player-left", seatId: target.seatId, nickname: target.nickname });
    for (const sock of sockets) {
      this.sendTo(sock, { type: "kicked" });
      this.conns.get(sock)?.conn.close(1000, "kicked");
    }
  }
  private handleCloseRoom(room: Room, seat: Seat, reqId?: number): void {
    if (!this.requireHost(room, seat, reqId)) return;
    this.cfg.log.info({ event: "room-closed", room: room.code, by: seat.seatId });
    this.endRoom(room, "host-closed", 1000);
  }
  private handleTransferHost(room: Room, seat: Seat, targetSeatId: number, reqId?: number): void {
    if (!this.requireHost(room, seat, reqId)) return;
    const target = room.seats.get(targetSeatId);
    if (!target || !target.present || target.role !== "player") {
      this.sendToSeat(seat, {
        type: "error",
        reqId,
        code: "invalid-message",
        message: "target must be a connected player",
      });
      return;
    }
    if (targetSeatId === room.hostSeatId) {
      this.sendToSeat(seat, { type: "error", reqId, code: "invalid-message", message: "already host" });
      return;
    }
    room.hostSeatId = targetSeatId;
    this.touch(room);
    this.broadcast(room, { type: "host-changed", hostSeatId: room.hostSeatId });
  }
  private handleLeave(room: Room, seat: Seat): void {
    this.cfg.log.info({ event: "leave", room: room.code, seat: seat.seatId });
    const sockets = [...seat.sockets];
    const seatId = seat.seatId;
    const nickname = seat.nickname;
    const wasHost = room.hostSeatId === seatId;
    this.releaseSeat(room, seat);
    for (const s of room.seats.values()) {
      for (const sock of s.sockets) {
        this.sendTo(sock, { type: "player-left", seatId, nickname });
      }
    }
    for (const sock of sockets) {
      const st = this.conns.get(sock);
      if (st) {
        st.roomId = null;
        st.seatId = null;
      }
      this.conns.get(sock)?.conn.close(1000, "leave");
    }
    if (wasHost && room.hostSeatId !== -1) {
      this.broadcast(room, { type: "host-changed", hostSeatId: room.hostSeatId });
    }
  }
  /* ------------------------------------------------------------------ */
  /* Phase machine                                                       */
  /* ------------------------------------------------------------------ */
  private startRound(room: Room): void {
    room.roundNumber += 1;
    room.phase = "playing";
    room.board = this.cfg.generateBoard(room.roundNumber);
    room.deadline = Date.now() + this.cfg.roundMs;
    room.reveal = null;
    room.wordsBySeat = new Map();
    for (const seat of room.seats.values()) {
      seat.role = "player"; // spectators are promoted exactly at round-start
      seat.roundWords = new Set();
      seat.roundScore = 0;
      room.wordsBySeat.set(seat.seatId, []);
    }
    this.autoReleaseStaleSeats(room);
    this.clearPhaseTimer(room);
    this.armPhaseTimer(room);
    this.armTickLoop(room);
    this.cfg.log.info({ event: "round-start", room: room.code, round: room.roundNumber });
    this.broadcast(room, {
      type: "round-start",
      round: { roundNumber: room.roundNumber, board: room.board, deadline: room.deadline },
    });
    this.broadcast(room, {
      type: "tick",
      phase: "playing",
      remaining: room.deadline - Date.now(),
      deadline: room.deadline,
    });
  }
  private armPhaseTimer(room: Room): void {
    this.clearPhaseTimer(room);
    const remain = Math.max(0, room.deadline - Date.now());
    const timer = setTimeout(() => this.onPhaseDeadline(room), remain);
    this.phaseTimers.set(room.code, timer);
  }
  /** Fired at (about) the absolute deadline; re-arms when fired early. */
  private onPhaseDeadline(room: Room): void {
    if (room.phase === "closed" || room.closing) return;
    const now = Date.now();
    if (now < room.deadline - 25) {
      this.armPhaseTimer(room); // coalesced early fire: re-arm for the remainder
      return;
    }
    if (room.phase === "playing") {
      this.endRound(room);
    } else if (room.phase === "intermission") {
      if (!this.autoAdvance(room)) {
        // Under the 2-player gate: wait (ticks at remaining 0) for players.
        // The tick loop retries the advance every interval.
      }
    }
  }
  private endRound(room: Room): void {
    room.phase = "intermission";
    room.deadline = Date.now() + this.cfg.intermissionMs;
    room.reveal = this.cfg.reveal({
      board: room.board,
      roundNumber: room.roundNumber,
      wordsBySeat: room.wordsBySeat,
    });
    this.cfg.log.info({ event: "round-end", room: room.code, round: room.roundNumber });
    this.broadcast(room, {
      type: "round-end",
      roundNumber: room.roundNumber,
      reveal: room.reveal,
    });
    this.armPhaseTimer(room);
    this.broadcast(room, {
      type: "tick",
      phase: "intermission",
      remaining: room.deadline - Date.now(),
      deadline: room.deadline,
    });
  }
  /** Auto-advance; waits (ticks at remaining 0) while under 2 players. */
  private autoAdvance(room: Room): boolean {
    if (this.playerCount(room) < 2) return false;
    this.touch(room);
    this.startRound(room);
    return true;
  }
  private tryAutoAdvance(room: Room): void {
    if (room.phase === "intermission" && room.deadline <= Date.now()) {
      this.autoAdvance(room);
    }
  }
  private armTickLoop(room: Room): void {
    this.clearTickLoop(room);
    const fire = () => {
      if (room.closing || room.phase === "closed" || !this.rooms.has(room.code)) return;
      if (room.phase !== "playing" && room.phase !== "intermission") return;
      const phase = room.phase;
      const remaining = Math.max(0, room.deadline - Date.now());
      this.broadcast(room, { type: "tick", phase, remaining, deadline: room.deadline });
      if (phase === "intermission" && remaining === 0) {
        if (this.autoAdvance(room)) return; // round-start replaced the loop
      }
      this.tickTimers.set(room.code, setTimeout(fire, this.cfg.tickIntervalMs));
    };
    this.tickTimers.set(room.code, setTimeout(fire, this.cfg.tickIntervalMs));
  }
  private clearTickLoop(room: Room): void {
    const t = this.tickTimers.get(room.code);
    if (t) clearTimeout(t);
    this.tickTimers.delete(room.code);
  }
  private clearPhaseTimer(room: Room): void {
    const t = this.phaseTimers.get(room.code);
    if (t) clearTimeout(t);
    this.phaseTimers.delete(room.code);
  }
  /* ------------------------------------------------------------------ */
  /* Seat release / host transfer / room expiry                          */
  /* ------------------------------------------------------------------ */
  /**
   * A disconnected seat auto-releases once its holder has missed a full
   * round plus intermission. Evaluated at each round start: a seat absent
   * since a round strictly older than the previous one had a complete round
   * and intermission to return.
   */
  private autoReleaseStaleSeats(room: Room): void {
    for (const seat of [...room.seats.values()]) {
      if (seat.present || seat.autoReleased) continue;
      if (seat.absentRound == null) {
        seat.absentRound = room.roundNumber;
        continue;
      }
      const missedRounds = room.roundNumber - seat.absentRound;
      if (missedRounds >= 2) {
        this.cfg.log.info({
          event: "seat-released",
          room: room.code,
          seat: seat.seatId,
          missedRounds,
        });
        this.releaseSeat(room, seat);
        this.broadcast(room, { type: "player-left", seatId: seat.seatId, nickname: seat.nickname });
      }
    }
  }
  private releaseSeat(room: Room, seat: Seat): void {
    const wasHost = room.hostSeatId === seat.seatId;
    room.seats.delete(seat.seatId);
    seat.autoReleased = true;
    if (wasHost) {
      this.transferHost(room);
    }
    this.maybeScheduleEmptyGrace(room);
  }
  /** Host duties move to the longest-connected remaining connected player. */
  private transferHost(room: Room): void {
    const candidates = [...room.seats.values()]
      .filter((s) => s.present && s.role === "player")
      .sort((a, b) => a.joinedAt - b.joinedAt || a.seatId - b.seatId);
    if (candidates.length === 0) {
      room.hostSeatId = -1;
      return;
    }
    room.hostSeatId = candidates[0]!.seatId;
    this.broadcast(room, { type: "host-changed", hostSeatId: room.hostSeatId });
  }
  private maybeScheduleEmptyGrace(room: Room): void {
    if (this.hasPresentOccupant(room)) return;
    if (this.emptyTimers.has(room.code)) return;
    this.emptyTimers.set(
      room.code,
      setTimeout(() => {
        this.emptyTimers.delete(room.code);
        const r = this.rooms.get(room.code);
        if (r && !r.closing && !this.hasPresentOccupant(r)) {
          this.cfg.log.info({ event: "room-expired", room: r.code, reason: "empty-grace" });
          this.endRoom(r, "expired", 1001);
        }
      }, this.cfg.roomEmptyGraceMs)
    );
  }
  private clearEmptyTimer(room: Room): void {
    const t = this.emptyTimers.get(room.code);
    if (t) clearTimeout(t);
    this.emptyTimers.delete(room.code);
  }
  private hasPresentOccupant(room: Room): boolean {
    return [...room.seats.values()].some((s) => s.present);
  }
  private playerCount(room: Room): number {
    let n = 0;
    for (const s of room.seats.values()) if (s.role === "player") n++;
    return n;
  }
  private touch(room: Room): void {
    room.lastActivity = Date.now();
  }
  private scheduleIdleCheck(room: Room): void {
    if (this.idleChecks.has(room.code)) return;
    const interval = Math.max(1, Math.floor(Math.min(this.cfg.roomIdleMs / 4, 60_000)));
    const t = setInterval(() => {
      const r = this.rooms.get(room.code);
      if (!r) {
        clearInterval(t);
        this.idleChecks.delete(room.code);
        return;
      }
      if (Date.now() - r.lastActivity > this.cfg.roomIdleMs) {
        clearInterval(t);
        this.idleChecks.delete(room.code);
        this.cfg.log.info({ event: "room-expired", room: r.code, reason: "idle" });
        this.endRoom(r, "expired", 1001);
      }
    }, interval);
    this.idleChecks.set(room.code, t);
  }
  /* ------------------------------------------------------------------ */
  /* Room end                                                            */
  /* ------------------------------------------------------------------ */
  private endRoom(room: Room, reason: string, closeCode: number): void {
    room.closing = true;
    for (const s of room.seats.values()) {
      for (const sock of s.sockets) {
        this.sendTo(sock, { type: "room-ended", reason });
        this.conns.get(sock)?.conn.close(closeCode, "room-ended");
      }
      s.sockets.clear();
    }
    for (const [ws, state] of this.conns) {
      if (state.roomId === room.code) {
        state.roomId = null;
        state.seatId = null;
      }
    }
    this.destroyRoom(room);
  }
  private destroyRoom(room: Room): void {
    this.clearPhaseTimer(room);
    this.clearTickLoop(room);
    this.clearEmptyTimer(room);
    const idle = this.idleChecks.get(room.code);
    if (idle) clearInterval(idle);
    this.idleChecks.delete(room.code);
    this.rooms.delete(room.code);
  }
  /* ------------------------------------------------------------------ */
  /* Snapshots / broadcasts                                              */
  /* ------------------------------------------------------------------ */
  private sendSnapshot(ws: WebSocket, room: Room, seat: Seat, reqId?: number, token?: string): void {
    const snap: SnapshotMsg = {
      type: "snapshot",
      ...(reqId !== undefined ? { reqId } : {}),
      room: {
        code: room.code,
        phase: room.phase,
        hostSeatId: room.hostSeatId,
        roundNumber: room.roundNumber,
      },
      self: {
        seatId: seat.seatId,
        nickname: seat.nickname,
        role: seat.role,
        cumulativeScore: seat.cumulativeScore,
        ...(token !== undefined ? { token } : {}),
      },
      players: [...room.seats.values()].map(seatInfo),
    };
    if (room.phase === "playing") {
      snap.round = {
        roundNumber: room.roundNumber,
        board: room.board,
        deadline: room.deadline,
      };
    }
    if (room.phase === "intermission" && room.reveal != null) {
      snap.finishedRound = {
        roundNumber: room.roundNumber,
        board: room.board,
        reveal: room.reveal,
      };
    }
    this.sendTo(ws, snap);
  }
  private broadcastScores(room: Room): void {
    const scores: ScoreEntry[] = [...room.seats.values()].map((s) => ({
      seatId: s.seatId,
      nickname: s.nickname,
      roundScore: s.roundScore,
      cumulativeScore: s.cumulativeScore,
    }));
    this.broadcast(room, {
      type: "score-update",
      roundNumber: room.roundNumber,
      scores,
    });
  }
  private broadcast(room: Room, msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const seat of room.seats.values()) {
      for (const sock of seat.sockets) {
        try {
          sock.send(payload);
        } catch {
          /* socket gone; close path handles cleanup */
        }
      }
    }
  }
  private sendToSeat(seat: Seat, msg: ServerMessage): void {
    for (const sock of seat.sockets) {
      try {
        sock.send(JSON.stringify(msg));
      } catch {
        /* gone */
      }
    }
  }
  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* gone */
    }
  }
  /* ------------------------------------------------------------------ */
  /* Ops surface                                                         */
  /* ------------------------------------------------------------------ */
  teardownAll(reason: string): void {
    for (const room of [...this.rooms.values()]) {
      this.endRoom(room, reason, 1001);
    }
  }
}
/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function fold(s: string): string {
  return s.normalize("NFC").toLowerCase();
}
function normalizeNickname(n: string): string {
  return n.normalize("NFC").trim().slice(0, 24);
}
function validNickname(n: string): boolean {
  return n.length > 0;
}
export function normalizeWord(w: string): string {
  return w.normalize("NFC").toLowerCase().trim();
}
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}
function seatInfo(s: Seat): PlayerInfo {
  return {
    seatId: s.seatId,
    nickname: s.nickname,
    role: s.role,
    cumulativeScore: s.cumulativeScore,
    connected: s.present,
  };
}
