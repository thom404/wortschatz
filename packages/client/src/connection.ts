import type { ClientMessage, GreetingMsg, RoomEndReason, ServerMessage } from "@wortschatz/shared";

/**
 * The one client-side connection seam. This module owns:
 * - the app-facing `RoomConn` port and its factory,
 * - the transport-agnostic `ConnectionCore` (Greeting, reqId allocation,
 *   send gating, Snapshot side effects, Close outcome derivation and the
 *   retry-attempt count),
 * - per-room session storage.
 *
 * It imports no WebSocket, no `location` and no DOM. The WebSocket adapter
 * (`websocket.ts`) and the scripted test adapter supply transport I/O only,
 * so both drive the same message-handling path.
 */
export type ServerListener = (msg: ServerMessage) => void;

/** Builds the one greeting a connection sends once its transport is up:
 *  create-room, or join with a stored session token. */
export type GreetFn = () => GreetingMsg | null;

export type ConnStatus = "connecting" | "open" | "retrying";

/** The single way a room connection ends. The connection derives it from
 *  the server's end frame or from an orderly transport close, so the app
 *  handles one outcome rather than a status followed by a frame. */
export type CloseOutcome =
  { kind: "kicked" } | { kind: "room-ended"; reason: RoomEndReason } | { kind: "connection-lost" };

export interface StoredSession {
  token: string;
  nickname: string;
  seatId: number;
}

const TOKEN_NS = "wordament:session:";

export function loadSession(code: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(TOKEN_NS + code.toLowerCase());
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(code: string, s: StoredSession): void {
  try {
    localStorage.setItem(TOKEN_NS + code.toLowerCase(), JSON.stringify(s));
  } catch {
    /* storage may be unavailable */
  }
}

export function clearSession(code: string): void {
  try {
    localStorage.removeItem(TOKEN_NS + code.toLowerCase());
  } catch {
    /* ignore */
  }
}

/** The app-facing surface of a room connection. The production WebSocket
 *  adapter and the scripted test adapter both declare `implements RoomConn`,
 *  so the compiler catches a copy that loses or renames a method. */
export interface RoomConn {
  start(): void;
  request<T extends Omit<ClientMessage, "reqId">>(msg: T): number;
  send(msg: Omit<ClientMessage, "reqId"> & { reqId?: number }): void;
  resync(): void;
  stop(): void;
}

/** How a room connection comes to be. The factory receives the greeting
 *  builder, the status callback and the one close-outcome callback; it
 *  returns an unstarted connection the app then `start()`s. */
export type ConnFactory = (opts: ConnectionOptions) => RoomConn;

export interface ConnectionOptions {
  greet: GreetFn;
  listener: ServerListener;
  onStatus: (status: ConnStatus) => void;
  onClose: (outcome: CloseOutcome) => void;
}

/** The three transport operations a core needs. An adapter reports back
 *  through `ConnectionCore.transportUp()`, `receive()` and
 *  `transportClosed()`. */
export interface ConnTransport {
  /** Opens the transport. */
  open(): void;
  /** Writes one typed client frame. */
  write(msg: ClientMessage): void;
  /** Closes the transport without surfacing a status or outcome. */
  close(): void;
}

/** One transport-agnostic connection: the Wire protocol behaviour every
 *  adapter shares, with timing and sockets left to the adapter. */
export class ConnectionCore implements RoomConn {
  private nextReqId = 1;
  private retries = 0;
  private up = false;
  private started = false;
  private finished = false;

  private readonly greet: GreetFn;
  private readonly listener: ServerListener;
  private readonly onStatus: (status: ConnStatus) => void;
  private readonly onClose: (outcome: CloseOutcome) => void;
  private readonly transport: ConnTransport;

  constructor(opts: ConnectionOptions & { transport: ConnTransport }) {
    this.greet = opts.greet;
    this.listener = opts.listener;
    this.onStatus = opts.onStatus;
    this.onClose = opts.onClose;
    this.transport = opts.transport;
  }

  /** Starts this connection once: status `connecting`, then the transport. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.openTransport();
  }

  /** Reopens the transport after an unexpected close. The WebSocket
   *  adapter's retry timer calls this; the status stays core-owned. */
  reconnect(): void {
    if (!this.started || this.finished) return;
    this.openTransport();
  }

  private openTransport(): void {
    this.up = false;
    this.onStatus("connecting");
    this.transport.open();
  }

  /** Reports an open transport: greet with the next monotonic reqId. */
  transportUp(): void {
    if (this.finished) return;
    this.up = true;
    const msg = this.greet();
    if (!msg) return;
    this.transport.write({ ...msg, reqId: this.nextReqId++ });
  }

  /** Handles one parsed server frame. Frames after finish or stop are
   *  ignored; an end frame reaches the listener before its outcome. */
  receive(msg: ServerMessage): void {
    if (this.finished) return;
    if (msg.type === "snapshot") {
      this.retries = 0;
      const sess: StoredSession = {
        token: msg.self.token ?? "",
        nickname: msg.self.nickname,
        seatId: msg.self.seatId,
      };
      // Sessions live per room code (the connection contract): the
      // server's code, not the greeting key — creating a room greets with
      // the nickname and is named by the snapshot.
      if (sess.token) saveSession(msg.room.code, sess);
      this.onStatus("open");
    }
    this.listener(msg);
    if (msg.type === "kicked") {
      this.finish({ kind: "kicked" });
    } else if (msg.type === "room-ended") {
      this.finish({ kind: "room-ended", reason: msg.reason });
    }
  }

  /** Reports a transport close. An orderly close with no end frame yields
   *  one `connection-lost`; an unexpected close yields `retrying` and the
   *  retry-attempt index to schedule, or `null` when it must stay silent. */
  transportClosed(orderly: boolean): number | null {
    if (this.finished) return null;
    this.up = false;
    if (orderly) {
      this.finish({ kind: "connection-lost" });
      return null;
    }
    this.onStatus("retrying");
    const attempt = this.retries;
    this.retries += 1;
    return attempt;
  }

  /** Typed send with reqId echo correlation. Refuses writes before the
   *  transport is up and after the connection finishes. */
  send(msg: Omit<ClientMessage, "reqId"> & { reqId?: number }): void {
    if (this.up && !this.finished) this.transport.write(msg as ClientMessage);
  }

  request<T extends Omit<ClientMessage, "reqId">>(msg: T): number {
    const reqId = this.nextReqId++;
    this.send({ ...msg, reqId });
    return reqId;
  }

  /** Explicit resync: one request away from a fresh snapshot. */
  resync(): void {
    this.request({ type: "resync" });
  }

  /** Client-initiated close: silent, with no status and no outcome. */
  stop(): void {
    if (this.finished) return;
    this.finished = true;
    this.up = false;
    try {
      this.transport.close();
    } catch {
      /* gone */
    }
  }

  /** Emits exactly one close outcome, after the end frame has reached the
   *  listener so the app's state already names the room. */
  private finish(outcome: CloseOutcome): void {
    if (this.finished) return;
    this.finished = true;
    this.up = false;
    try {
      this.transport.close();
    } catch {
      /* gone */
    }
    this.onClose(outcome);
  }
}
