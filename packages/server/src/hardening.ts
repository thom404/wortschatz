import type { WebSocket } from "ws";

/**
 * Per-connection sliding-window quota: first breach is a typed
 * `rate-limited` error, a sustained breach tears the socket down into the
 * normal disconnect path.
 */
export class RateLimiter {
  private events: number[] = [];
  private breachedOnce = false;

  constructor(
    private readonly windowMs: number,
    private readonly maxMessages: number
  ) {}

  /** Record one inbound message; return the action to take. */
  hit(now: number): "ok" | "warn" | "teardown" {
    this.events = this.events.filter((t) => now - t < this.windowMs);
    this.events.push(now);
    if (this.events.length <= this.maxMessages) return "ok";
    if (!this.breachedOnce) {
      this.breachedOnce = true;
      return "warn";
    }
    return "teardown";
  }
}

/** Sends a WS ping and tracks the connection's pong liveness. */
export class Pinger {
  private lastPong: number | null = null;

  constructor(
    private readonly ws: WebSocket,
    private readonly graceMs: number,
    private readonly teardown: (reason: string) => void
  ) {
    ws.on("pong", () => {
      this.lastPong = Date.now();
    });
  }

  tick(now: number): void {
    // The first tick baseline: a fresh connection sent nothing weird yet.
    this.lastPong = this.lastPong ?? now;
    if (now - (this.lastPong as number) > this.graceMs) {
      this.teardown("pong-timeout");
      return;
    }
    try {
      this.ws.ping();
    } catch {
      /* socket already closing */
    }
  }
}
