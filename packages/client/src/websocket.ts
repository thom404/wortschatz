import type { ClientMessage, ServerMessage } from "@wortschatz/shared";
import { ConnectionCore, type ConnectionOptions, type RoomConn } from "./connection.js";

/**
 * The WebSocket adapter: the only client module that touches `WebSocket` or
 * `location`. It supplies socket creation, frame parsing, close-code mapping,
 * capped exponential backoff and the retry timer; every protocol rule lives
 * in `ConnectionCore` (`connection.ts`).
 *
 * One room-bound WebSocket per page life. Handles:
 * - reqId echo correlation (client-chosen monotonic integer),
 * - the greeting (create-room or join, code inside the first message, never the URL),
 * - capped exponential reconnect with the token (0.5 s → 30 s),
 * - full snapshot on every (re)connect; deltas in between; resync escape hatch.
 */
export class RoomConnection implements RoomConn {
  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly core: ConnectionCore;

  constructor(opts: ConnectionOptions) {
    this.core = new ConnectionCore({
      greet: opts.greet,
      listener: opts.listener,
      onStatus: opts.onStatus,
      onClose: opts.onClose,
      transport: {
        open: () => this.open(),
        write: (msg) => {
          const ws = this.ws;
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
        },
        close: () => {
          try {
            this.ws?.close(1000, "leave");
          } catch {
            /* gone */
          }
        },
      },
    });
  }

  /** Opens the socket and greets. Retries with capped exponential backoff. */
  start(): void {
    this.core.start();
  }

  private open(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => this.core.transportUp();
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        this.core.receive(msg);
      } catch {
        /* ignore unparseable server frames */
      }
    };
    this.ws.onclose = (ev) => {
      this.ws = null;
      const orderly = ev.code === 1000 || ev.code === 1001;
      const attempt = this.core.transportClosed(orderly);
      if (attempt !== null) this.scheduleRetry(attempt);
    };
    this.ws.onerror = () => {
      /* close event follows */
    };
  }

  private scheduleRetry(attempt: number): void {
    const delay = Math.min(500 * Math.pow(2, attempt), 30_000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.core.reconnect();
    }, delay);
  }

  send(msg: Omit<ClientMessage, "reqId"> & { reqId?: number }): void {
    this.core.send(msg);
  }

  request<T extends Omit<ClientMessage, "reqId">>(msg: T): number {
    return this.core.request(msg);
  }

  /** Explicit resync: one request away from a fresh snapshot. */
  resync(): void {
    this.core.resync();
  }

  stop(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.core.stop();
  }
}
