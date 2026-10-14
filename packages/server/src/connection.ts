import type { WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@wordament/shared";
import { RateLimiter } from "./hardening.js";
import type { ServerConfigResolved } from "./config.js";

export interface ConnDeps {
  cfg: ServerConfigResolved;
  /** Exactly-once first message: create-room or join. */
  authenticate(first: ClientMessage, ws: WebSocket): void;
  /** Every well-formed message after a successful greeting. */
  dispatch(msg: ClientMessage, ws: WebSocket): void;
  /** Socket is gone (close or error) without a voluntary message. */
  gone(ws: WebSocket): void;
}

/**
 * Per-socket gate: JSON text frames only, capped at maxPayloadBytes; flood
 * hits the sliding quota (first breach typed `rate-limited`, sustained
 * breach tears the socket down into the normal disconnect path); close and
 * error events funnel into `gone`.
 */
export class Connection {
  private limiter: RateLimiter;
  private greeted = false;
  private closing = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly deps: ConnDeps
  ) {
    this.limiter = new RateLimiter(deps.cfg.quotaWindowMs, deps.cfg.quotaMaxMessages);
    ws.on("message", (data, isBinary) => this.onMessage(data, isBinary));
    ws.on("close", () => {
      if (!this.closing) this.deps.gone(this.ws);
    });
    ws.on("error", () => {
      if (!this.closing) this.deps.gone(this.ws);
    });
  }

  /** Server-initiated close; suppresses the `gone` callback. */
  close(code: number, reason: string): void {
    if (this.closing) return;
    this.closing = true;
    try {
      this.ws.close(code, reason);
    } catch {
      try {
        this.ws.terminate();
      } catch {
        /* gone */
      }
    }
  }

  terminate(): void {
    this.closing = true;
    try {
      this.ws.terminate();
    } catch {
      /* gone */
    }
  }

  private onMessage(data: unknown, isBinary: boolean): void {
    const now = Date.now();
    const action = this.limiter.hit(now);
    if (action === "teardown") {
      this.terminate();
      return;
    }

    const buf = Array.isArray(data)
      ? Buffer.concat(data as Buffer[])
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer);
    if (buf.byteLength > this.deps.cfg.maxPayloadBytes) {
      this.send({ type: "error", code: "invalid-message", message: "payload too large" });
      return;
    }
    if (isBinary) {
      this.send({ type: "error", code: "invalid-message", message: "binary frames rejected" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(buf.toString("utf8"));
    } catch {
      this.send({ type: "error", code: "invalid-message", message: "unparseable JSON" });
      return;
    }

    const msg = this.validate(parsed);
    if (!msg) return;

    if (action === "warn") {
      this.send({ type: "error", code: "rate-limited", message: "too many messages" });
    }

    if (!this.greeted) {
      this.greeted = true;
      this.deps.authenticate(msg, this.ws);
      return;
    }
    this.deps.dispatch(msg, this.ws);
  }

  /** Shape validation beyond JSON-parse; null ⇒ an error was already sent. */
  private validate(parsed: unknown): ClientMessage | null {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      this.send({ type: "error", code: "invalid-message", message: "not an object" });
      return null;
    }
    const rec = parsed as Record<string, unknown>;
    const type = rec["type"];
    if (typeof type !== "string") {
      this.send({ type: "error", code: "invalid-message", message: "missing type" });
      return null;
    }
    const reqId = readReqId(rec);

    switch (type) {
      case "create-room": {
        const nickname = readString(rec, "nickname");
        if (nickname === null) {
          this.send({ type: "error", code: "invalid-message", message: "nickname required" });
          return null;
        }
        return { type, nickname, ...(reqId !== undefined ? { reqId } : {}) };
      }
      case "join": {
        const code = readString(rec, "code");
        const nickname = readString(rec, "nickname");
        if (code === null || code === "") {
          this.send({ type: "error", code: "invalid-message", message: "code required" });
          return null;
        }
        if (nickname === null || nickname === "") {
          this.send({ type: "error", code: "invalid-message", message: "nickname required" });
          return null;
        }
        const token = readOptionalString(rec, "token");
        return {
          type,
          code,
          nickname,
          ...(token !== undefined ? { token } : {}),
          ...(reqId !== undefined ? { reqId } : {}),
        };
      }
      case "submit-word": {
        const word = readString(rec, "word");
        if (word === null) {
          this.send({ type: "error", code: "invalid-message", message: "word required" });
          return null;
        }
        return { type, word, ...(reqId !== undefined ? { reqId } : {}) };
      }
      case "start-round":
      case "skip":
      case "leave":
      case "close-room":
      case "resync":
        return { type, ...(reqId !== undefined ? { reqId } : {}) };
      case "kick":
      case "transfer-host": {
        const seatId = rec["seatId"];
        if (typeof seatId !== "number" || !Number.isInteger(seatId)) {
          this.send({ type: "error", code: "invalid-message", message: "integer seatId required" });
          return null;
        }
        return { type, seatId, ...(reqId !== undefined ? { reqId } : {}) };
      }
      default:
        this.send({
          type: "error",
          ...(reqId !== undefined ? { reqId } : {}),
          code: "invalid-message",
          message: `unknown type: ${String(type)}`,
        });
        return null;
    }
  }

  private send(msg: ServerMessage): void {
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* socket gone */
    }
  }
}

function readString(rec: Record<string, unknown>, key: string): string | null {
  const v = rec[key];
  return typeof v === "string" ? v : null;
}
function readOptionalString(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === "string" ? v : undefined;
}
export function readReqId(rec: Record<string, unknown>): number | undefined {
  const v = rec["reqId"];
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.trunc(v);
}
