import { WebSocket } from "ws";
import type { ClientMessage, RoomEndReason, ServerMessage, SnapshotMsg } from "@wortschatz/shared";
import type { ServerConfigResolved } from "./config.js";
import { Connection, errorReply } from "./connection.js";
import { Pinger } from "./hardening.js";
import { makeRoom, makeRoomCode, makeToken, seatInfo, type Room, type Seat } from "./state.js";
import { RoomLogic, systemClock, type Clock } from "./room-logic.js";
import { normalizeCode } from "./text.js";

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
    this.sendTo(ws, errorReply("invalid-message", "first message must be create-room or join"));
  }
  private handleCreateRoom(msg: Extract<ClientMessage, { type: "create-room" }>, ws: WebSocket): void {
    if (this.rooms.size >= this.cfg.maxRooms) {
      this.sendTo(ws, errorReply("server-full", "room capacity reached", msg.reqId));
      return;
    }
    const code = this.mintCode();
    const room = makeRoom(code);
    this.rooms.set(code, room);
    const verdict = this.logic.createSeat(room, { nickname: msg.nickname });
    if (verdict.kind === "rejected") {
      this.rooms.delete(code);
      this.sendTo(ws, errorReply(verdict.code, verdict.detail, msg.reqId));
      return;
    }
    const seat = verdict.seat;
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
      this.sendTo(ws, errorReply("room-not-found", undefined, msg.reqId));
      this.cfg.log.info({ event: "join-rejected", room: code, reason: "room-not-found" });
      return;
    }
    const verdict = this.logic.join(room, {
      ...(msg.token !== undefined ? { token: msg.token } : {}),
      nickname: msg.nickname,
    });
    if (verdict.kind === "rejected") {
      this.sendTo(ws, errorReply(verdict.code, verdict.detail, msg.reqId));
      return;
    }
    const seat = verdict.seat;
    if (verdict.kind === "joined") seat.token = makeToken();
    this.bindConn(ws, room, seat);
    this.logic.announceJoin(room, verdict);
    this.cfg.log.info(
      verdict.kind === "reconnected"
        ? { event: "reconnect", room: room.code, seat: seat.seatId }
        : { event: "join", room: room.code, seat: seat.seatId, role: seat.role }
    );
    this.sendSnapshot(ws, room, seat, msg.reqId, seat.token);
    if (verdict.announceScores) this.logic.announceScores(room);
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
      this.sendTo(ws, errorReply("invalid-message", "not bound to a room", msg.reqId));
      return;
    }
    const room = this.rooms.get(state.roomId);
    const seat = room?.seats.get(state.seatId);
    if (!room || !seat) {
      this.sendTo(ws, errorReply("room-not-found", undefined, msg.reqId));
      return;
    }
    switch (msg.type) {
      case "submit-word":
        this.handleSubmitWord(room, seat, msg);
        break;
      case "start-round":
        this.handleStartRound(room, seat, msg.reqId);
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
        this.sendTo(ws, errorReply("invalid-message", "already bound to a room", msg.reqId));
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
    const verdict = this.logic.submitWord(room, seat, msg.word, msg.alternate);
    if (verdict.kind === "rejected") {
      this.sendToSeat(seat, errorReply(verdict.code, verdict.detail, msg.reqId));
      return;
    }
    this.sendToSeat(seat, {
      type: "word-accepted",
      reqId: msg.reqId,
      word: verdict.word,
      points: verdict.points,
    });
    this.logic.announceScores(room);
  }
  private handleStartRound(room: Room, seat: Seat, reqId?: number): void {
    const verdict = this.logic.startRound(room, seat);
    if (verdict.kind === "rejected") {
      this.sendToSeat(seat, errorReply(verdict.code, verdict.detail, reqId));
    }
  }
  private handleKick(room: Room, host: Seat, targetSeatId: number, reqId?: number): void {
    const verdict = this.logic.kick(room, host, targetSeatId);
    if (verdict.kind === "rejected") {
      this.sendToSeat(host, errorReply(verdict.code, verdict.detail, reqId));
      return;
    }
    const sockets = [...verdict.seat.sockets];
    for (const sock of sockets) {
      this.sendTo(sock, { type: "kicked" });
      this.conns.get(sock)?.conn.close(1000, "kicked");
    }
  }
  private handleCloseRoom(room: Room, seat: Seat, reqId?: number): void {
    const verdict = this.logic.close(room, seat);
    if (verdict.kind === "rejected") {
      this.sendToSeat(seat, errorReply(verdict.code, verdict.detail, reqId));
      return;
    }
    this.endRoom(room, "host-closed", 1000);
  }
  private handleTransferHost(room: Room, seat: Seat, targetSeatId: number, reqId?: number): void {
    const verdict = this.logic.transferHost(room, seat, targetSeatId);
    if (verdict.kind === "rejected") {
      this.sendToSeat(seat, errorReply(verdict.code, verdict.detail, reqId));
    }
  }
  private handleLeave(room: Room, seat: Seat): void {
    const { seat: leaving } = this.logic.leave(room, seat);
    const sockets = [...leaving.sockets];
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
        ...(room.wikiLinks ? { links: room.wikiLinks } : {}),
        deadline: room.deadline,
      };
    }
    this.sendTo(ws, snap);
  }
  /** A promoted spectator's fresh full snapshot, to every socket on its seat. */
  private sendSeatSnapshot(room: Room, seat: Seat): void {
    for (const sock of seat.sockets) this.sendSnapshot(sock, room, seat);
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
