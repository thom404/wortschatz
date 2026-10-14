import { describe, expect, test, vi } from "vitest";
import { PROTOCOL } from "@wordament/shared";
import { Pinger, RateLimiter } from "../src/hardening.js";
import type { WebSocket } from "ws";

describe("RateLimiter", () => {
  test("allows up to the window quota", () => {
    const rl = new RateLimiter(10_000, 3);
    expect(rl.hit(0)).toBe("ok");
    expect(rl.hit(1)).toBe("ok");
    expect(rl.hit(2)).toBe("ok");
  });

  test("first breach warns, sustained breach tears down", () => {
    const rl = new RateLimiter(10_000, 2);
    rl.hit(0);
    rl.hit(1);
    expect(rl.hit(2)).toBe("warn");
    expect(rl.hit(3)).toBe("teardown");
  });

  test("window slides: old events expire", () => {
    const rl = new RateLimiter(1_000, 2);
    rl.hit(0);
    rl.hit(10);
    expect(rl.hit(1_200)).toBe("ok");
  });
});

describe("Pinger", () => {
  const makeWs = () => {
    const handlers: Record<string, () => void> = {};
    return {
      on(event: string, cb: () => void) {
        handlers[event] = cb;
      },
      ping: vi.fn(),
      emitPong: () => handlers["pong"]?.(),
    } as unknown as WebSocket & { ping: () => void; emitPong: () => void };
  };

  test("tears down after pong grace without pong", () => {
    const ws = makeWs();
    let torn = "";
    const p = new Pinger(ws, 45_000, (reason) => {
      torn = reason;
    });
    p.tick(0);
    p.tick(60_000);
    expect(torn).toBe("pong-timeout");
  });

  test("stays alive while pongs arrive", () => {
    const ws = makeWs();
    let torn = "";
    const p = new Pinger(ws, 45_000, (reason) => {
      torn = reason;
    });
    p.tick(0);
    ws.emitPong();
    p.tick(50_000);
    expect(torn).toBe("");
  });

  test("pings on each tick", () => {
    const ws = makeWs();
    const p = new Pinger(ws, 45_000, () => {});
    p.tick(0);
    p.tick(1_000);
    expect(ws.ping).toHaveBeenCalledTimes(2);
  });

  test("PROTOCOL defaults documented", () => {
    expect(PROTOCOL.QUOTA_MAX_MESSAGES).toBe(40);
    expect(PROTOCOL.QUOTA_WINDOW_MS).toBe(10_000);
  });
});
