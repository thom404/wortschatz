import type {
  ClientMessage,
  GreetingMsg,
  RoomEndReason,
  ServerMessage,
  SnapshotMsg,
} from "@wortschatz/shared";

/**
 * One room-bound WebSocket per page life. Handles:
 * - reqId echo correlation (client-chosen monotonic integer),
 * - the greeting (create-room or join, code inside the first message, never the URL),
 * - session-token persistence per room code,
 * - capped exponential reconnect with the token (0.5 s → 30 s),
 * - full snapshot on every (re)connect; deltas in between; resync escape hatch.
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

export class RoomConnection {
  private ws: WebSocket | null = null;
  private nextReqId = 1;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  readonly code: string;
  private readonly greet: GreetFn;
  private readonly listener: ServerListener;
  private readonly onStatus: (status: ConnStatus) => void;
  private readonly onClose: (outcome: CloseOutcome) => void;

  constructor(
    code: string,
    greet: GreetFn,
    listener: ServerListener,
    onStatus: (status: ConnStatus) => void = () => {},
    onClose: (outcome: CloseOutcome) => void = () => {}
  ) {
    this.code = code;
    this.greet = greet;
    this.listener = listener;
    this.onStatus = onStatus;
    this.onClose = onClose;
  }

  /** Opens the socket and greets. Retries with capped exponential backoff. */
  start(): void {
    this.disposed = false;
    this.open();
  }

  private open(): void {
    if (this.disposed) return;
    this.onStatus("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => this.greetSocket();
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        this.onMessage(msg);
      } catch {
        /* ignore unparseable server frames */
      }
    };
    this.ws.onclose = (ev) => {
      this.ws = null;
      if (this.disposed) return;
      if (ev.code !== 1000 && ev.code !== 1001) {
        this.scheduleRetry();
        return;
      }
      // Orderly close with no end frame ahead: one connection-lost outcome.
      this.finish({ kind: "connection-lost" });
    };
    this.ws.onerror = () => {
      /* close event follows */
    };
  }

  private greetSocket(): void {
    const msg = this.greet();
    if (!msg) return;
    const reqId = this.nextReqId++;
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ...msg, reqId }));
    }
  }

  private scheduleRetry(): void {
    this.onStatus("retrying");
    const delay = Math.min(500 * Math.pow(2, this.retries), 30_000);
    this.retries += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private onMessage(msg: ServerMessage): void {
    if (msg.type === "snapshot") {
      this.retries = 0;
      const sess: StoredSession = {
        token: msg.self.token ?? "",
        nickname: msg.self.nickname,
        seatId: msg.self.seatId,
      };
      // Sessions live per room code (api contract): the server's code,
      // not the greeting key this connection was built with — creating
      // a room greets with the nickname and is named by the snapshot.
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

  /** Emits exactly one close outcome, after the end frame has reached the
   *  listener so the app's state already names the room. */
  private finish(outcome: CloseOutcome): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.ws?.close(1000, "server-outcome");
    } catch {
      /* gone */
    }
    this.onClose(outcome);
  }

  /** Typed send with reqId echo correlation. */
  send(msg: Omit<ClientMessage, "reqId"> & { reqId?: number }): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
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

  stop(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    try {
      this.ws?.close(1000, "leave");
    } catch {
      /* gone */
    }
  }
}
