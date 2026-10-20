import { afterEach, describe, expect, test } from "vitest";
import { fullCfg } from "./scene.js";
import { startServer, type Logger } from "../src/index.js";
import type { SnapshotMsg } from "@wortschatz/shared";
import { connect } from "./test-client.js";

function capturingLog(): { lines: Array<Record<string, unknown>>; logger: Logger } {
  const lines: Array<Record<string, unknown>> = [];
  const push = (obj: Record<string, unknown>) => lines.push(obj);
  return {
    lines,
    logger: { info: push, warn: push, error: push },
  };
}

async function poll(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  expect(pred()).toBe(true);
}

describe("observability", () => {
  test("room lifecycle, connects and disconnects are structured JSON log lines", async () => {
    const { logger, lines } = capturingLog();
    const handle = await startServer(
      fullCfg({
        log: logger,
        roundMs: 300,
        tickIntervalMs: 100,
        roomEmptyGraceMs: 30_000,
      })
    );
    try {
      const a = await connect(handle.port);
      a.send({ type: "create-room", nickname: "Hansi", reqId: 1 });
      const snap = (await a.expect((m) => m.type === "snapshot")) as unknown as SnapshotMsg;
      const b = await connect(handle.port);
      b.send({ type: "join", code: snap.room.code, nickname: "Gretl", reqId: 2 });
      const bSnap = (await b.expect((m) => m.type === "snapshot")) as unknown as SnapshotMsg;

      a.send({ type: "start-round", reqId: 3 });
      await a.expect((m) => m.type === "round-start");
      await a.expect((m) => m.type === "round-end");

      const events = lines.map((l) => l.event);
      expect(events).toContain("room-created");
      expect(events).toContain("join");
      expect(events).toContain("round-start");
      expect(events).toContain("round-end");

      await b.close();
      await poll(() => lines.some((l) => l.event === "disconnect" && l.seat === 1));
      const disc = lines.find((l) => l.event === "disconnect");
      expect(disc).toMatchObject({ room: snap.room.code, seat: 1 });

      const b2 = await connect(handle.port);
      b2.send({ type: "join", code: snap.room.code, nickname: "Gretl", token: bSnap.self.token, reqId: 3 });
      await b2.expect((m) => m.type === "snapshot");
      await poll(() => lines.some((l) => l.event === "reconnect" && l.seat === 1));

      a.send({ type: "close-room", reqId: 8 });
      await a.waitForClose();
      await poll(() => lines.some((l) => l.event === "room-closed"));
      expect(lines.map((l) => l.event)).toContain("room-closed");

      for (const line of lines) {
        expect(typeof line.event).toBe("string");
      }
      void b2;
    } finally {
      await handle.stop();
    }
  });

  test("protocol errors (join with unresolvable code) are logged", async () => {
    const { logger, lines } = capturingLog();
    const handle = await startServer(fullCfg({ log: logger }));
    try {
      const c = await connect(handle.port);
      c.send({ type: "join", code: "QQQQQ", nickname: "X", reqId: 1 });
      await c.expect((m) => m.type === "error");
      const rej = lines.find((l) => l.event === "join-rejected");
      expect(rej).toMatchObject({ reason: "room-not-found" });
      await c.close();
    } finally {
      await handle.stop();
    }
  });
});
