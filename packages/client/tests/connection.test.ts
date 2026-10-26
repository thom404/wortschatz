// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { ClientMessage, ServerMessage } from "@wortschatz/shared";
import {
  ConnectionCore,
  type CloseOutcome,
  type ConnStatus,
  type ConnTransport,
  type GreetFn,
} from "../src/connection.js";
import { BOARD, ROOM_CODE, lobbySnapshot, playingSnapshot } from "./fixtures.js";

/**
 * The connection core (ADR-0026) driven through a recording fake transport:
 * typed frames in, statuses, Close outcomes and the stored session out. No
 * WebSocket, no timer and no DOM geometry — the pure-module model the other
 * client rules use.
 */

/** A transport that records the core's three operations instead of using a
 *  socket. The adapter owns timing; this fake never retries by itself. */
class RecordingTransport implements ConnTransport {
  openCount = 0;
  closeCount = 0;
  readonly frames: ClientMessage[] = [];

  open(): void {
    this.openCount += 1;
  }

  write(msg: ClientMessage): void {
    this.frames.push(msg);
  }

  close(): void {
    this.closeCount += 1;
  }
}

function setup(greet: GreetFn = () => ({ type: "create-room", nickname: "Lena" })) {
  const transport = new RecordingTransport();
  const statuses: ConnStatus[] = [];
  const outcomes: CloseOutcome[] = [];
  const received: ServerMessage[] = [];
  const events: string[] = [];
  const core = new ConnectionCore({
    greet,
    listener: (msg) => {
      received.push(msg);
      events.push(`frame:${msg.type}`);
    },
    onStatus: (status) => statuses.push(status),
    onClose: (outcome) => {
      outcomes.push(outcome);
      events.push(`close:${outcome.kind}`);
    },
    transport,
  });
  return { core, transport, statuses, outcomes, received, events };
}

/** A live connection: started, with its transport reported up. */
function started() {
  const ctx = setup();
  ctx.core.start();
  ctx.core.transportUp();
  return ctx;
}

beforeEach(() => {
  localStorage.clear();
});

describe("Connection core (ADR-0026)", () => {
  it("starts once with the connecting status and greets with reqId 1 once the transport is up", () => {
    const { core, transport, statuses } = setup();

    core.start();
    // Starting opens the transport but sends nothing until it is up.
    expect(statuses).toEqual(["connecting"]);
    expect(transport.openCount).toBe(1);
    expect(transport.frames).toEqual([]);

    // A second start is the same connection, not a second attempt.
    core.start();
    expect(transport.openCount).toBe(1);

    core.transportUp();
    expect(transport.frames).toEqual([{ type: "create-room", nickname: "Lena", reqId: 1 }]);
  });

  it("allocates reqIds monotonically through request and resync", () => {
    const { core, transport } = started();

    expect(core.request({ type: "start-round" })).toBe(2);
    core.resync();
    expect(core.request({ type: "submit-word", word: "HAT" })).toBe(4);

    expect(transport.frames).toEqual([
      { type: "create-room", nickname: "Lena", reqId: 1 },
      { type: "start-round", reqId: 2 },
      { type: "resync", reqId: 3 },
      { type: "submit-word", word: "HAT", reqId: 4 },
    ]);
  });

  it("refuses writes before the transport is up and after the connection finishes", () => {
    const { core, transport } = setup();

    core.send({ type: "leave" });
    core.start();
    core.send({ type: "leave" });
    expect(transport.frames).toEqual([]);

    core.transportUp();
    core.send({ type: "leave" });
    expect(transport.frames.at(-1)).toEqual({ type: "leave" });

    core.receive({ type: "kicked" });
    const afterFinish = transport.frames.length;
    core.send({ type: "resync" });
    expect(transport.frames).toHaveLength(afterFinish);
  });

  it("saves the session under the Snapshot's room code and reports open on every Snapshot", () => {
    const { core, statuses } = started();

    core.receive(lobbySnapshot({ code: "QRS78", nickname: "Lena" }));
    expect(statuses).toEqual(["connecting", "open"]);
    expect(localStorage.getItem("wordament:session:qrs78")).toBe(
      JSON.stringify({ token: "t-1", nickname: "Lena", seatId: 1 })
    );

    core.receive(lobbySnapshot({ code: ROOM_CODE, nickname: "Lena" }));
    expect(statuses).toEqual(["connecting", "open", "open"]);
  });

  it("writes no session key when the Snapshot carries an empty token", () => {
    const { core } = started();

    core.receive(
      playingSnapshot({
        code: "EMPTY1",
        selfSeatId: 1,
        nickname: "Lena",
        role: "player",
        board: BOARD,
      })
    );

    expect(localStorage.getItem("wordament:session:empty1")).toBeNull();
  });

  it("resets the retry count on every Snapshot", () => {
    const { core, statuses } = started();

    expect(core.transportClosed(false)).toBe(0);
    expect(core.transportClosed(false)).toBe(1);
    expect(statuses).toEqual(["connecting", "retrying", "retrying"]);

    core.receive(lobbySnapshot({ code: ROOM_CODE, nickname: "Lena" }));
    expect(statuses.at(-1)).toBe("open");

    // A reconnected player starts at the first delay again.
    expect(core.transportClosed(false)).toBe(0);
  });

  it("delivers an end frame before exactly one Close outcome and ignores the later duplicates", () => {
    const kicked = started();
    kicked.core.receive({ type: "kicked" });
    expect(kicked.events).toEqual(["frame:kicked", "close:kicked"]);
    expect(kicked.outcomes).toEqual([{ kind: "kicked" }]);

    kicked.core.receive({ type: "kicked" });
    kicked.core.receive(lobbySnapshot({ code: ROOM_CODE, nickname: "Lena" }));
    expect(kicked.events).toEqual(["frame:kicked", "close:kicked"]);
    expect(kicked.outcomes).toEqual([{ kind: "kicked" }]);

    const ended = started();
    ended.core.receive({ type: "room-ended", reason: "expired" });
    expect(ended.events).toEqual(["frame:room-ended", "close:room-ended"]);
    expect(ended.outcomes).toEqual([{ kind: "room-ended", reason: "expired" }]);
  });

  it("turns an orderly transport close with no end frame into one connection-lost outcome", () => {
    const { core, statuses, outcomes } = started();

    core.transportClosed(true);

    expect(statuses).toEqual(["connecting"]);
    expect(outcomes).toEqual([{ kind: "connection-lost" }]);
  });

  it("reports an unexpected close as retrying with no outcome, then re-greets on reconnect", () => {
    const { core, transport, statuses, outcomes } = started();

    expect(core.transportClosed(false)).toBe(0);
    expect(statuses).toEqual(["connecting", "retrying"]);
    expect(outcomes).toEqual([]);

    core.reconnect();
    core.transportUp();
    expect(transport.openCount).toBe(2);
    expect(transport.frames).toEqual([
      { type: "create-room", nickname: "Lena", reqId: 1 },
      { type: "create-room", nickname: "Lena", reqId: 2 },
    ]);
  });

  it("stays silent on stop and ignores every later frame", () => {
    const { core, transport, statuses, outcomes } = started();

    core.stop();
    expect(statuses).toEqual(["connecting"]);
    expect(outcomes).toEqual([]);
    expect(transport.closeCount).toBe(1);

    core.send({ type: "leave" });
    core.receive({ type: "kicked" });
    core.transportClosed(true);
    core.transportClosed(false);

    expect(transport.frames).toEqual([{ type: "create-room", nickname: "Lena", reqId: 1 }]);
    expect(statuses).toEqual(["connecting"]);
    expect(outcomes).toEqual([]);
  });
});
