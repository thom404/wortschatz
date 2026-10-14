import { WebSocket } from "ws";

/**
 * Minimal real-WebSocket test client. Tests only observe what a real
 * WebSocket client would: ordered messages, snapshot contents, tick
 * cadence, error codes, socket close codes. No socket mocks anywhere.
 */
export interface TestClient {
  ws: WebSocket;
  send(obj: unknown): void;
  next(timeoutMs?: number): Promise<Record<string, unknown> & { type: string }>;
  /** Wait until a message matching `pred` arrives (drains others). */
  expect(
    pred: (m: Record<string, unknown>) => boolean,
    timeoutMs?: number
  ): Promise<Record<string, unknown> & { type: string }>;
  waitForClose(timeoutMs?: number): Promise<{ code: number; reason: string }>;
  collect(): Promise<void[]>;
  close(): Promise<void>;
}

export async function connect(port: number): Promise<TestClient> {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const queue: (Record<string, unknown> & { type: string })[] = [];
  const waiters: { resolve(m: Record<string, unknown> & { type: string }): void; cancel(): void }[] = [];
  let closed: Promise<{ code: number; reason: string }>;
  let resolveClosed!: (c: { code: number; reason: string }) => void;

  closed = new Promise((resolveOnce) => {
    resolveClosed = resolveOnce;
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString()) as Record<string, unknown> & { type: string };
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(msg);
      else queue.push(msg);
    } catch {
      /* a test asserting malformed input does that itself */
    }
  });
  ws.on("close", (code, reason) => {
    for (const w of waiters.splice(0)) {
      w.cancel();
    }
    resolveClosed({ code, reason: reason.toString() });
  });

  await new Promise<void>((resolveOnce, reject) => {
    ws.once("open", resolveOnce);
    ws.once("error", reject);
  });

  return {
    ws,
    send(obj: unknown) {
      ws.send(JSON.stringify(obj));
    },
    next(timeoutMs = 5000) {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolveOnce, reject) => {
        const t = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
        waiters.push({
          resolve: (m) => {
            clearTimeout(t);
            resolveOnce(m);
          },
          cancel: () => {
            clearTimeout(t);
            // Leave the promise unsettled if the waiter already timed out
            // with its test gone; vitest's own hook timeout surfaces hangs.
          },
        });
      });
    },
    async expect(pred, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const m = await this.next(Math.max(1, deadline - Date.now()));
        if (pred(m)) return m;
      }
    },
    waitForClose(timeoutMs = 5000) {
      return Promise.race([
        closed,
        new Promise<{ code: number; reason: string }>((_, reject) =>
          setTimeout(() => reject(new Error("timed out waiting for close")), timeoutMs)
        ),
      ]);
    },
    async collect() {
      /* drained via next()/expect() */
    },
    close() {
      return new Promise((resolveOnce) => {
        ws.once("close", () => resolveOnce());
        ws.close();
      });
    },
  };
}
