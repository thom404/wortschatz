// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@wortschatz/shared";
import { SoloConnection, type SoloClock, type SoloOptions } from "../src/solo.js";
import { mountHarness, type Mounted } from "./harness.js";

const BOARD = ["h", "a", "u", "s", "t", "e", "s", "t", "w", "o", "r", "t", "z", "z", "a", "a"];
const WORDS = ["haus", "test", "wort", "ort"];

const dictionary: SoloOptions["dictionary"] = {
  isValid: (word) => WORDS.includes(word.normalize("NFC").toLowerCase()),
  findWords: () => [...WORDS],
};

/** A deterministic manual clock for the local authority. */
class FakeClock implements SoloClock {
  private time = 0;
  private nextId = 1;
  private timers = new Map<number, { due: number; fn: () => void }>();
  now(): number {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { due: this.time + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(Number(handle));
  }
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, t]) => t.due <= target)
        .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.time = timer.due;
      timer.fn();
    }
    this.time = target;
  }
}

function solo(clock: FakeClock, listener: (msg: ServerMessage) => void): SoloConnection {
  return new SoloConnection({
    dictionary,
    clock,
    seedSource: () => 1n,
    generateBoard: () => ({ board: [...BOARD], words: [...WORDS] }),
    listener,
    onStatus: () => {},
    onClose: () => {},
  });
}

function mountSolo(clock: FakeClock): Mounted {
  return mountHarness(
    async () => (opts) =>
      new SoloConnection({
        ...opts,
        dictionary,
        clock,
        seedSource: () => 1n,
        generateBoard: () => ({ board: [...BOARD], words: [...WORDS] }),
      })
  );
}

afterEach(() => {
  document.body.textContent = "";
  window.history.pushState({}, "", "/");
});

describe("local solo authority", () => {
  it("starts immediately with a solo snapshot, round-start, tick and one player", () => {
    const clock = new FakeClock();
    const messages: ServerMessage[] = [];
    const conn = solo(clock, (m) => messages.push(m));
    conn.start();

    expect(messages.map((m) => m.type)).toEqual(["snapshot", "round-start", "tick", "score-update"]);
    const snap = messages[0] as Extract<ServerMessage, { type: "snapshot" }>;
    expect(snap.room.code).toBe("");
    expect(snap.self.nickname).toBe("Du");
    expect(snap.players).toHaveLength(1);
    expect(snap.self.token).toBeUndefined();
    conn.stop();
  });

  it("accepts a known word, refuses a duplicate and ends at the absolute deadline", () => {
    const clock = new FakeClock();
    const messages: ServerMessage[] = [];
    const conn = solo(clock, (m) => messages.push(m));
    conn.start();
    conn.request({ type: "submit-word", word: "haus" });
    const accepted = messages.find((m) => m.type === "word-accepted");
    expect(accepted).toMatchObject({ type: "word-accepted", word: "haus", points: 5 });

    conn.request({ type: "submit-word", word: "HAUS" });
    expect(messages.at(-1)).toMatchObject({
      type: "error",
      code: "word-duplicate",
      message: "haus",
    });

    clock.advance(120_000);
    const end = messages.at(-1) as Extract<ServerMessage, { type: "round-end" }>;
    expect(end.type).toBe("round-end");
    expect(end.reveal.groups.flatMap((g) => g.words).find((w) => w.word === "haus")).toMatchObject({
      points: 5,
      foundBy: [1],
    });
    conn.stop();
  });

  it("starts the next round from the pause and keeps a cumulative score", () => {
    const clock = new FakeClock();
    const messages: ServerMessage[] = [];
    const conn = solo(clock, (m) => messages.push(m));
    conn.start();
    conn.request({ type: "submit-word", word: "haus" });
    clock.advance(120_000);
    conn.request({ type: "start-round" });
    const start = messages.at(-3) as Extract<ServerMessage, { type: "round-start" }>;
    expect(start.round.roundNumber).toBe(2);
    conn.request({ type: "submit-word", word: "wort" });
    const scores = messages.filter((m) => m.type === "score-update").at(-1) as Extract<
      ServerMessage,
      { type: "score-update" }
    >;
    expect(scores.scores[0]).toMatchObject({ roundScore: 7, cumulativeScore: 12 });
    conn.stop();
  });
});

describe("solo mode through the app shell", () => {
  it("keeps Home while loading, then plays, shows the solo pause and returns Home", async () => {
    const clock = new FakeClock();
    const app = mountSolo(clock);
    try {
      app.root.querySelector<HTMLButtonElement>("#solo-btn")!.click();
      await vi.waitFor(() => expect(app.root.querySelector("#board")).toBeTruthy());

      expect(app.root.querySelector("h1")!.textContent).toBe("Runde 1");
      expect(app.root.querySelector("#board .tile")).toBeTruthy();
      expect(app.root.querySelector("#players")).toBeNull();
      expect(app.root.querySelector("#leave-btn")!.getAttribute("aria-label")).toBe("Spiel beenden");
      expect(window.location.pathname).toBe("/");

      app.conn().request({ type: "submit-word", word: "haus" });
      expect(app.root.querySelector("#found")!.textContent).toContain("haus");
      expect(app.root.querySelector("#round-score")!.textContent).toBe("5 P");

      clock.advance(120_000);
      await vi.waitFor(() => expect(app.root.querySelector("#screen h1")!.textContent).toBe("Pause"));
      expect(app.root.querySelector("#players")).toBeNull();
      expect(app.root.querySelector("#reveal")!.textContent).toContain("haus");
      expect(app.root.querySelector("#reveal .rw-link")).toBeNull();
      expect(app.root.querySelector(".area-score h2")!.textContent).toBe("Deine Punkte");
      expect(app.root.querySelector("#start-btn")!.textContent).toBe("Nächste Runde");
      expect(app.root.querySelector(".next-round-hint")).toBeNull();

      app.root.querySelector<HTMLButtonElement>("#start-btn")!.click();
      await vi.waitFor(() => expect(app.root.querySelector("#screen h1")!.textContent).toBe("Runde 2"));
      app.root.querySelector<HTMLButtonElement>("#leave-btn")!.click();
      expect(app.root.querySelector("#screen h1")!.textContent).toBe("Wortschatz");
      expect(app.root.querySelectorAll(".home-actions button")).toHaveLength(3);
    } finally {
      app.unmount();
    }
  });

  it("shows the German loading state and a retryable error while keeping Home usable", async () => {
    let reject: ((error: Error) => void) | undefined = undefined;
    let calls = 0;
    const app = mountHarness(() => {
      calls += 1;
      if (calls === 1) return new Promise((_resolve, fail) => (reject = fail));
      return Promise.resolve((() => {
        throw new Error("unused");
      }) as never);
    });
    try {
      const button = app.root.querySelector<HTMLButtonElement>("#solo-btn")!;
      button.click();
      button.click();
      expect(app.root.querySelector("#notice-status")!.textContent).toBe("Wörterbuch wird geladen …");
      expect(calls).toBe(1);
      reject!(new Error("missing"));
      await vi.waitFor(() =>
        expect(app.root.querySelector("#notice-error")!.textContent).toBe(
          "Das Wörterbuch konnte nicht geladen werden. Versuche es erneut."
        )
      );
      expect(app.root.querySelector("h1")!.textContent).toBe("Wortschatz");
      app.root.querySelector<HTMLButtonElement>("#solo-btn")!.click();
      expect(calls).toBe(2);
    } finally {
      app.unmount();
    }
  });
});
