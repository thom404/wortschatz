import { WebSocket } from "ws";
import type {
  ClientMessage,
  PlayerInfo,
  RoomEndReason,
  ScoreEntry,
  ServerMessage,
  SnapshotMsg,
} from "@wortschatz/shared";
import type { ServerConfigResolved } from "./config.js";
import { Connection } from "./connection.js";
import { Pinger } from "./hardening.js";
import { makeRoom, makeRoomCode, makeToken, type Room, type Seat } from "./state.js";
import { isFormable } from "./boardgen/index.js";
import { RoomLogic, systemClock, type Clock } from "./room-logic.js";
interface ConnState {
  conn: Connection;
  roomId: string | null;
  seatId: number | null;
}
/**
 * The socket-facing half of a room: attachment, greeting, message dispatch and
 * the fan-out of server messages. The phase machine and roster rules live in
 * `RoomLogic`, driven by the injected clock and broadcast seam.
 */
export class Rooms {
  readonly rooms = new Map<string, Room>();
  private conns = new Map<WebSocket, ConnState>();
  private pingers = new Map<WebSocket, Pinger>();
  private readonly logic: RoomLogic;
  constructor(
    private cfg: ServerConfigResolved,
    clock: Clock = systemClock
  ) {
    this.logic = new RoomLogic({
      cfg,
      clock,
      broadcast: (room, msg) => this.broadcast(room, msg),
      snapshot: (room, seat) => this.sendSeatSnapshot(room, seat),
      expire: (room, reason) => this.endRoom(room, reason, 1001),
    });
  }
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
    const pinger = new Pinger(ws, this.cfg.pongGraceMs, () => {
      // A dead socket goes down the normal disconnect path: bookkeeping
      // (seat absent, host transfer, empty grace) before the drop.
      this.onSocketGone(ws);
      conn.terminate();
    });

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
    this.logic.disconnect(room, seat);
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
    const room = makeRoom(code);
    this.rooms.set(code, room);
    this.logic.touch(room);
    const seat = this.logic.newSeat(room, nickname);
    room.hostSeatId = seat.seatId;
    seat.token = makeToken();
    this.bindConn(ws, room, seat);
    this.logic.scheduleIdleCheck(room);
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
    const seat = msg.token ? this.logic.findSeatByToken(room, msg.token) : null;
    if (seat) {
      this.bindConn(ws, room, seat);
      this.logic.markPresent(seat);
      this.logic.touch(room);
      this.logic.clearEmptyTimer(room);
      this.cfg.log.info({ event: "reconnect", room: room.code, seat: seat.seatId });
      this.sendSnapshot(ws, room, seat, msg.reqId, seat.token);
      // Reconnect repair: room-wide scoreboard refresh that also carries
      // the reclaimed seat back into everyone's view.
      this.broadcastScores(room);
      this.logic.tryAutoAdvance(room);
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
    // Player seats are capped; a mid-round joiner is a spectator and waits
    // for the next round-start (promotion is capped out in join order there).
    if (room.phase !== "playing" && room.seats.size >= this.cfg.maxPlayers) {
      this.sendTo(ws, { type: "error", reqId: msg.reqId, code: "room-full" });
      return;
    }
    const created = this.logic.newSeat(room, nickname);
    created.token = makeToken();
    if (room.phase === "playing") created.role = "spectator";
    this.bindConn(ws, room, created);
    this.logic.touch(room);
    this.logic.clearEmptyTimer(room);
    this.cfg.log.info({
      event: "join",
      room: room.code,
      seat: created.seatId,
      role: created.role,
    });
    this.broadcast(room, { type: "player-joined", player: seatInfo(created) });
    this.sendSnapshot(ws, room, created, msg.reqId, created.token);
    // The intermission's screen stays the honest mirror for newcomers too:
    // the finished round never scored the new seat, so a room-wide
    // score-update re-anchors the standings everyone renders (#22).
    if (room.phase === "intermission") this.broadcastScores(room);
    this.logic.tryAutoAdvance(room);
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
    if (!this.logic.acceptsSubmissions(room)) {
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
    if (!isFormable(word, room.board)) {
      this.sendToSeat(seat, {
        type: "error",
        reqId: msg.reqId,
        code: "invalid-word",
        message: "not placeable",
      });
      return;
    }
    if (!this.cfg.dictionary.isValid(word)) {
      this.sendToSeat(seat, { type: "error", reqId: msg.reqId, code: "invalid-word", message: word });
      return;
    }
    seat.roundWords.add(word);
    const points = this.cfg.scoreWord(word, seat.seatId);
    seat.roundScore += points;
    seat.cumulativeScore += points;
    const list = room.wordsBySeat.get(seat.seatId);
    if (list) list.push(word);
    this.logic.touch(room);
    this.sendToSeat(seat, { type: "word-accepted", reqId: msg.reqId, word, points });
    this.broadcastScores(room);
  }
  private requireHost(room: Room, seat: Seat, reqId?: number): boolean {
    if (!this.logic.isHost(room, seat)) {
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
    if (this.logic.playerCount(room) < 2) {
      this.sendToSeat(seat, { type: "error", reqId, code: "need-players" });
      return;
    }
    this.logic.touch(room);
    this.logic.startRound(room);
  }
  private handleSkip(room: Room, seat: Seat, reqId?: number): void {
    if (!this.requireHost(room, seat, reqId)) return;
    if (room.phase !== "intermission") {
      this.sendToSeat(seat, { type: "error", reqId, code: "invalid-phase" });
      return;
    }
    this.logic.skip(room);
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
    this.logic.releaseSeat(room, target);
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
    this.logic.touch(room);
    this.logic.setHost(room, targetSeatId);
  }
  private handleLeave(room: Room, seat: Seat): void {
    this.cfg.log.info({ event: "leave", room: room.code, seat: seat.seatId });
    const sockets = [...seat.sockets];
    this.logic.releaseSeat(room, seat);
    for (const sock of sockets) {
      const st = this.conns.get(sock);
      if (st) {
        st.roomId = null;
        st.seatId = null;
      }
      this.conns.get(sock)?.conn.close(1000, "leave");
    }
  }
  /* ------------------------------------------------------------------ */
  /* Room end                                                            */
  /* ------------------------------------------------------------------ */
  private endRoom(room: Room, reason: RoomEndReason, closeCode: number): void {
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
    this.logic.destroy(room);
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
        deadline: room.deadline,
      };
    }
    this.sendTo(ws, snap);
  }
  /** A promoted spectator's fresh full snapshot, to every socket on its seat. */
  private sendSeatSnapshot(room: Room, seat: Seat): void {
    for (const sock of seat.sockets) this.sendSnapshot(sock, room, seat);
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
  /** The one fan-out primitive: one JSON frame per socket, swallowing a send
   *  on a socket that is already gone (the close path cleans up). */
  private fanOut(sockets: Iterable<WebSocket>, msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const sock of sockets) {
      try {
        sock.send(payload);
      } catch {
        /* socket gone; close path handles cleanup */
      }
    }
  }
  private broadcast(room: Room, msg: ServerMessage): void {
    this.fanOut(roomSockets(room), msg);
  }
  private sendToSeat(seat: Seat, msg: ServerMessage): void {
    this.fanOut(seat.sockets, msg);
  }
  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    this.fanOut([ws], msg);
  }
  /* ------------------------------------------------------------------ */
  /* Ops surface                                                         */
  /* ------------------------------------------------------------------ */
  teardownAll(reason: RoomEndReason, closeCode = 1001): void {
    for (const room of [...this.rooms.values()]) {
      this.endRoom(room, reason, closeCode);
    }
  }
}
/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function* roomSockets(room: Room): Generator<WebSocket> {
  for (const seat of room.seats.values()) {
    yield* seat.sockets;
  }
}
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
