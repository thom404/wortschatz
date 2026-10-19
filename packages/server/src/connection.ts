import type { WebSocket } from "ws";
import type { ClientMessage, ErrorCode, ServerErrorMsg, ServerMessage } from "@wortschatz/shared";
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
      // Sustained breach: tear down into the normal disconnect path, so the
      // seat sees the usual present/disconnected bookkeeping.
      this.deps.gone(this.ws);
      this.terminate();
      return;
    }

    const buf = Array.isArray(data)
      ? Buffer.concat(data as Buffer[])
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer);
    if (buf.byteLength > this.deps.cfg.maxPayloadBytes) {
      this.send(errorReply("invalid-message", "payload too large"));
      return;
    }
    if (isBinary) {
      this.send(errorReply("invalid-message", "binary frames rejected"));
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(buf.toString("utf8"));
    } catch {
      this.send(errorReply("invalid-message", "unparseable JSON"));
      return;
    }

    const msg = this.validate(parsed);
    if (!msg) return;

    if (action === "warn") {
      this.send(errorReply("rate-limited", "too many messages"));
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
    const isRecord = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    const rec = (isRecord ? parsed : {}) as Record<string, unknown>;
    const reqId = readReqId(rec);
    if (!isRecord) return this.reject(reqId, "not an object");

    const type = rec["type"];
    if (typeof type !== "string") return this.reject(reqId, "missing type");

    const spec = MESSAGE_SPECS.get(type);
    if (!spec) return this.reject(reqId, `unknown type: ${String(type)}`);

    const msg: Record<string, unknown> = { type };
    for (const field of spec.fields) {
      const result = readField(rec, field);
      if (result.error !== undefined) return this.reject(reqId, result.error);
      if (result.value !== undefined) msg[field.key] = result.value;
    }
    if (reqId !== undefined) msg.reqId = reqId;
    return msg as unknown as ClientMessage;
  }

  /** Every rejection goes through the one reply shape. */
  private reject(reqId: number | undefined, message: string): null {
    this.send(errorReply("invalid-message", message, reqId));
    return null;
  }

  private send(msg: ServerMessage): void {
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* socket gone */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Validation field specifications                                     */
/* ------------------------------------------------------------------ */

type FieldKind = "string" | "integer";

interface FieldSpec {
  key: string;
  kind: FieldKind;
  /** Optional fields omit a missing or wrong-typed value instead of rejecting. */
  optional?: boolean;
  /** A required string must also be non-empty. */
  nonEmpty?: boolean;
  /** Detail on the one error reply when a required field fails. */
  message: string;
}

interface MessageSpec {
  fields: readonly FieldSpec[];
}

/** The wire shape of every client message, one row per type. */
const MESSAGE_SPECS: ReadonlyMap<string, MessageSpec> = new Map<string, MessageSpec>([
  ["create-room", { fields: [{ key: "nickname", kind: "string", message: "nickname required" }] }],
  [
    "join",
    {
      fields: [
        { key: "code", kind: "string", nonEmpty: true, message: "code required" },
        { key: "nickname", kind: "string", nonEmpty: true, message: "nickname required" },
        { key: "token", kind: "string", optional: true, message: "token must be a string" },
      ],
    },
  ],
  ["submit-word", { fields: [{ key: "word", kind: "string", message: "word required" }] }],
  ["start-round", { fields: [] }],
  ["skip", { fields: [] }],
  ["leave", { fields: [] }],
  ["close-room", { fields: [] }],
  ["resync", { fields: [] }],
  ["kick", { fields: [{ key: "seatId", kind: "integer", message: "integer seatId required" }] }],
  ["transfer-host", { fields: [{ key: "seatId", kind: "integer", message: "integer seatId required" }] }],
]);

interface FieldRead {
  value?: string | number;
  error?: string;
}

function readField(rec: Record<string, unknown>, spec: FieldSpec): FieldRead {
  const raw = rec[spec.key];
  if (spec.kind === "string") {
    if (typeof raw !== "string") return spec.optional ? {} : { error: spec.message };
    if (!spec.optional && spec.nonEmpty && raw === "") return { error: spec.message };
    return { value: raw };
  }
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return spec.optional ? {} : { error: spec.message };
  }
  return { value: raw };
}

/** The one error-reply builder: `type`, echoed `reqId`, code and detail. */
export function errorReply(code: ErrorCode, message: string, reqId?: number): ServerErrorMsg {
  return {
    type: "error",
    ...(reqId !== undefined ? { reqId } : {}),
    code,
    message,
  };
}

export function readReqId(rec: Record<string, unknown>): number | undefined {
  const v = rec["reqId"];
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.trunc(v);
}
