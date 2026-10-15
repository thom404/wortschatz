// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  lobbySnapshot,
  mountHarness,
  playerJoined,
  roundStarted,
  strayTouchMove,
  synthesizePointerDrag,
  synthesizeTouchDrag,
  tileEls,
  type Mounted,
} from "./harness.js";

/**
 * First mount test (#18): the real app, mounted into a test DOM, driven
 * end to end through the scripted connection boundary. Assertions live on
 * rendered DOM and boundary messages only.
 */

const BOARD = ["H", "A", "U", "S", "T", "I", "R", "E", "B", "U", "M", "S", "K", "A", "T", "Z"];
/** A board whose notation carries a multi-letter digram (canonical lowercase). */
const MIXED = ["sch", "T", "E", "R", "H", "A", "U", "S", "Z", "I", "M", "B", "K", "N", "Ö", "D"];

let app: Mounted | null = null;

beforeEach(() => {
  window.history.pushState({}, "", "/");
  app = mountHarness();
});

afterEach(() => {
  app?.unmount();
  app = null;
});

function click(sel: string): void {
  app!.root.querySelector<HTMLButtonElement>(sel)!.click();
}

function typeInto(sel: string, value: string): void {
  app!.root.querySelector<HTMLInputElement>(sel)!.value = value;
}

/** Home → lobby → (host starts) → round one, through the boundary. */
function driveToRoundOne(code: string): void {
  typeInto("#mk-nick", "Lena");
  click("#mk-btn");
  app!.conn().feed(lobbySnapshot({ code, nickname: "Lena" }));
  click("#start-btn");
  app!.conn().feed(roundStarted(BOARD));
}

describe("mountable app", () => {
  it("routes home → lobby → game, fed by snapshot and deltas, through the scripted connection", () => {
    // Home: the mounted app renders its first screen.
    expect(app!.root.querySelector("h1")!.textContent).toBe("WortMeister");

    // Creating a room goes out on the boundary as the connection greets.
    typeInto("#mk-nick", "Lena");
    click("#mk-btn");
    expect(app!.connections()).toHaveLength(1);
    expect(app!.conn().sent()).toEqual([{ type: "create-room", nickname: "Lena", reqId: 1 }]);
    expect(app!.conn().statuses).toEqual(["connecting"]);
    // Nothing but the home screen until the server's first word.
    expect(app!.root.querySelector("h1")!.textContent).toBe("WortMeister");

    // The lobby arrives via a full snapshot; it is what flips the
    // boundary to `open`.
    app!.conn().feed(lobbySnapshot({ code: "LAG4T", nickname: "Lena" }));
    expect(app!.conn().statuses).toEqual(["connecting", "open"]);
    expect(app!.root.querySelector("h1")!.textContent).toBe("Raum LAG4T");
    expect(app!.root.querySelector("#players")!.textContent).toContain("Lena");
    expect(app!.root.querySelector("#start-btn")).toBeTruthy(); // creator is host

    // Further seats arrive as deltas.
    app!.conn().feed(playerJoined(2, "Ben"));
    expect(app!.root.querySelector("#players")!.textContent).toContain("Ben");
    expect(app!.root.textContent).toContain("2 verbunden von max. 8");

    // Starting the round crosses the boundary with the next reqId.
    click("#start-btn");
    expect(app!.conn().sent()).toEqual([
      { type: "create-room", nickname: "Lena", reqId: 1 },
      { type: "start-round", reqId: 2 },
    ]);

    // The game screen: server-owned board and deadline, rendered. The
    // round number comes from the round-start delta itself (server truth
    // through the boundary), and so does the mounted round score value.
    app!.conn().feed(roundStarted(BOARD));
    expect(app!.root.querySelector("h1")!.textContent).toContain("Runde 1");
    const tiles = tileEls(app!.root);
    expect(tiles.map((t) => t.textContent)).toEqual(BOARD.map((letter, i) => `${letter}${i}`));

    // Playing is drag-only: the typed input is gone.
    expect(app!.root.querySelector("#word-input")).toBeNull();
    expect(app!.root.querySelector("#word-form")).toBeNull();
  });

  it("renders the drag surface idle and sizes board fonts on the grid container", () => {
    driveToRoundOne("LAG4T");
    // Idle trace shows the hint that explains dragging.
    const trace = app!.root.querySelector<HTMLElement>("#trace")!;
    expect(trace.classList.contains("hint")).toBe(true);
    expect(trace.textContent).toContain("Ziehe über die Felder");

    // Single-letter board: full base size on the grid container.
    expect(app!.root.querySelector<HTMLElement>("#board")!.style.getPropertyValue("--tile-span")).toBe("1");

    // A board with multi-letter notation widens the span knob; the grid
    // container owns the font sizing (never per-tile `em`).
    app!.conn().feed(roundStarted(MIXED, 2));
    expect(app!.root.querySelector<HTMLElement>("#board")!.style.getPropertyValue("--tile-span")).toBe("3");
  });

  it("prefills a deep-linked room code and greets with a join", () => {
    window.history.pushState({}, "", "/r/abc12");
    const deep = mountHarness();
    try {
      expect(deep.root.querySelector<HTMLInputElement>("#jn-code")!.value).toBe("ABC12");
      expect(deep.root.querySelector<HTMLInputElement>("#jn-nick")!.value).toBe("");
      deep.root.querySelector<HTMLInputElement>("#jn-nick")!.value = "Ben";
      deep.root.querySelector<HTMLButtonElement>("#jn-btn")!.click();
      expect(deep.conn().sent()).toEqual([{ type: "join", code: "ABC12", nickname: "Ben", reqId: 1 }]);
      deep.conn().feed(lobbySnapshot({ code: "ABC12", nickname: "Ben" }));
      expect(deep.root.querySelector("h1")!.textContent).toBe("Raum ABC12");
    } finally {
      deep.unmount();
      window.history.pushState({}, "", "/");
    }
  });

  it("renders an end screen when the server closes the room", () => {
    driveToRoundOne("LAG4T");
    app!.conn().feed({ type: "room-ended", reason: "host closed" });
    // The boundary reports its orderly close before the outcome frame is
    // delivered, and the connection-closed screen wins (pinned current
    // behavior through a RoomConnection-faithful boundary).
    expect(app!.root.querySelector("h1")!.textContent).toBe("Verbindung beendet.");
    expect(app!.conn().stopped).toBe(true);
    expect(app!.conn().statuses).toEqual(["connecting", "open", "closed"]);
    // The real home button works its way back out of the ended screen.
    app!.root.querySelector<HTMLButtonElement>("#home-btn")!.click();
    expect(app!.root.querySelector("h1")!.textContent).toBe("WortMeister");
  });

  it("pointer drags show the live trace and submit it on release", () => {
    driveToRoundOne("LAG4T");
    const tiles = tileEls(app!.root);
    const traceSeen: string[] = [];
    synthesizePointerDrag([tiles[0]!, tiles[1]!, tiles[4]!], "mouse", () => {
      traceSeen.push(app!.root.querySelector("#trace")!.textContent!);
    });

    // The live trace shows what the swipe will submit, step by step, and
    // the hint is gone while dragging.
    expect(traceSeen).toEqual(["H", "HA", "HAT", "Ziehe über die Felder, um ein Wort zu bilden."]);
    const trace = app!.root.querySelector("#trace")!;
    expect(trace.classList.contains("hint")).toBe(true);

    // Release submits the traced string through the boundary, reqId next.
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HAT", reqId: 3 });

    // The synchronous verdict lands as a private chip with its points —
    // immediately, before any broadcast scoreboard update.
    expect(app!.root.querySelector("#error")).toBeNull();
    app!.conn().feed({ type: "word-accepted", word: "HAT", points: 2 });
    const chips = app!.root.querySelectorAll("#found li");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.textContent).toContain("HAT");
    expect(chips[0]!.textContent).toContain("+2");
  });

  it("backtracking unwinds the previous tile and the rest still submits", () => {
    driveToRoundOne("LAG4T");
    const tiles = tileEls(app!.root);
    const traceSeen: string[] = [];
    // H → A → back onto H (deselects A) → T: submits "HT", not "HAHT".
    synthesizePointerDrag([tiles[0]!, tiles[1]!, tiles[0]!, tiles[4]!], "mouse", () => {
      traceSeen.push(app!.root.querySelector("#trace")!.textContent!);
    });
    expect(traceSeen).toEqual(["H", "HA", "H", "HT", "Ziehe über die Felder, um ein Wort zu bilden."]);
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HT", reqId: 3 });
  });

  it("ignores non-adjacent jumps mid-drag", () => {
    driveToRoundOne("LAG4T");
    const tiles = tileEls(app!.root);
    // T (row 1, col 0) → U (row 0, col 2): rows and columns both differ
    // by 2 — not 8-way adjacent, so the jump is ignored.
    const traceSeen: string[] = [];
    synthesizePointerDrag([tiles[4]!, tiles[2]!], "mouse", () => {
      traceSeen.push(app!.root.querySelector("#trace")!.textContent!);
    });
    expect(traceSeen).toEqual(["T", "T", "Ziehe über die Felder, um ein Wort zu bilden."]);
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "T", reqId: 3 });
  });

  it("a resubmitted word surfaces the word-duplicate error and adds nothing", () => {
    driveToRoundOne("LAG4T");
    const tiles = tileEls(app!.root);
    synthesizePointerDrag([tiles[0]!, tiles[1]!, tiles[2]!]); // HAU
    app!.conn().feed({ type: "word-accepted", word: "HAU", points: 3 });
    expect(app!.root.querySelectorAll("#found li")).toHaveLength(1);

    // Same swipe again: the server verdict is word-duplicate; the error
    // renders as the existing typed German error, the chips unchanged.
    synthesizePointerDrag([tiles[0]!, tiles[1]!, tiles[2]!]);
    app!.conn().feed({ type: "error", code: "word-duplicate", message: "HAU" });
    expect(app!.root.querySelector("#error")!.textContent).toContain("Wort schon gefunden.");
    expect(app!.root.querySelectorAll("#found li")).toHaveLength(1);
  });

  it("touch drags resolve through retargeting and claim the gesture from the page", () => {
    driveToRoundOne("LAG4T");
    const tiles = tileEls(app!.root);
    // The browser retargets touchmove to the touchstart tile; capture the
    // event objects to inspect defaultPrevented after each dispatch.
    const moves: TouchEvent[] = [];
    tiles[7]!.addEventListener("touchmove", (ev) => moves.push(ev as TouchEvent));
    synthesizeTouchDrag([tiles[7]!, tiles[11]!, tiles[10]!]);
    // Gesture claimed while dragging: the page never scrolls or zooms.
    expect(moves).toHaveLength(2);
    expect(moves[0]!.defaultPrevented).toBe(true);
    expect(moves[1]!.defaultPrevented).toBe(true);
    // …and it submitted the retargeted finger path E → S → M.
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "ESM", reqId: 3 });

    // After release the drag is idle: a stray touchmove goes unclaimed.
    const afterEnd = strayTouchMove(tiles[7]!);
    expect(afterEnd.defaultPrevented).toBe(false);
  });

  it("clears the found-word chips when the next round starts", () => {
    driveToRoundOne("LAG4T");
    const tiles = tileEls(app!.root);
    synthesizePointerDrag([tiles[0]!, tiles[1]!, tiles[2]!]); // HAU
    app!.conn().feed({ type: "word-accepted", word: "HAU", points: 3 });
    expect(app!.root.querySelectorAll("#found li")).toHaveLength(1);
    // A fresh round resets the private list; the chip of the old round is gone.
    app!.conn().feed(roundStarted(BOARD, 2));
    expect(app!.root.querySelector("#found li.none")!.textContent).toBe("—");
  });

  it("the ring timer shows remaining, round score and the shared low-time look", async () => {
    vi.useFakeTimers();
    try {
      driveToRoundOne("LAG4T");
      const timer = app!.root.querySelector<HTMLElement>("#timer")!;

      // Fresh round: full ring, digits at the deadline, round score reset.
      expect(timer.style.getPropertyValue("--p")).toBe("1.0000");
      expect(app!.root.querySelector("#countdown")!.textContent).toBe("2:00");
      expect(app!.root.querySelector("#round-score")!.textContent).toBe("0 P");
      expect(timer.classList.contains("low")).toBe(false);

      // The synchronous verdict raises the centered round score at once…
      app!.conn().feed({ type: "word-accepted", word: "HAU", points: 5 });
      expect(app!.root.querySelector("#round-score")!.textContent).toBe("5 P");
      // …and a full scoreboard broadcast re-anchors to the server's value.
      app!.conn().feed({
        type: "score-update",
        roundNumber: 1,
        scores: [{ seatId: 1, nickname: "Lena", roundScore: 7, cumulativeScore: 7 }],
      });
      expect(app!.root.querySelector("#round-score")!.textContent).toBe("7 P");

      // A low-time tick: digits and ring take the one shared `low` look,
      // ring fraction shrinking with the interpolated remaining time.
      app!.conn().feed({
        type: "tick",
        phase: "playing",
        remaining: 18_000,
        deadline: Date.now() + 18_000,
      });
      await vi.advanceTimersByTimeAsync(251);
      expect(app!.root.querySelector("#countdown")!.textContent).toBe("0:18");
      const nowTimer = app!.root.querySelector<HTMLElement>("#timer")!;
      expect(nowTimer.classList.contains("low")).toBe(true);
      expect(Number(nowTimer.style.getPropertyValue("--p"))).toBeCloseTo(0.15, 2);
      expect(app!.root.querySelector("#error")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("multi-letter tiles contribute their full spelling to the trace", () => {
    driveToRoundOne("LAG4T");
    app!.conn().feed(roundStarted(MIXED, 2)); // board[0] = "sch"
    const tiles = tileEls(app!.root);
    const traceSeen: string[] = [];
    synthesizePointerDrag([tiles[0]!, tiles[1]!, tiles[2]!], "mouse", () => {
      traceSeen.push(app!.root.querySelector("#trace")!.textContent!);
    });
    // `sch` spells its three letters; singles keep their one.
    expect(traceSeen).toEqual(["sch", "schT", "schTE", "Ziehe über die Felder, um ein Wort zu bilden."]);
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "schTE", reqId: 3 });
  });

  it("synthesizes mouse and touch drags across the rendered tile grid", () => {
    driveToRoundOne("LAG4T");
    const tiles = tileEls(app!.root);
    expect(tiles).toHaveLength(16);

    // Pointer (mouse) synthesis: each tile in the path receives exactly
    // its own pointer events, at the synthetic cell's coordinates.
    const pointerLog: string[] = [];
    tiles.forEach((tile, i) => {
      for (const type of ["pointerdown", "pointermove", "pointerup"] as const) {
        tile.addEventListener(type, (ev) => {
          pointerLog.push(`${type}@${i}:${ev.clientX},${ev.clientY}`);
        });
      }
    });
    synthesizePointerDrag([tiles[0]!, tiles[1]!, tiles[4]!], "mouse");
    expect(pointerLog).toEqual([
      `pointerdown@0:20,20`, // tilePoint(0)
      `pointermove@1:64,20`, // tilePoint(1)
      `pointermove@4:20,64`, // tilePoint(4)
      `pointerup@4:20,64`,
    ]);

    // Touch synthesis retargets: every touch event lands on the
    // touchstart element, carrying the finger's current coordinates.
    const touchLog: string[] = [];
    const touchCoords: string[] = [];
    tiles.forEach((tile, i) => {
      for (const type of ["touchstart", "touchmove", "touchend"] as const) {
        tile.addEventListener(type, (ev) => {
          touchLog.push(`${type}@${i}`);
          const touch = (ev as TouchEvent).changedTouches[0]!;
          touchCoords.push(`${touch.clientX},${touch.clientY}`);
        });
      }
    });
    synthesizeTouchDrag([tiles[7]!, tiles[11]!, tiles[10]!]);
    expect(touchLog).toEqual([
      "touchstart@7", // retargeted: fired on the touchstart tile
      "touchmove@7",
      "touchmove@7",
      "touchend@7",
    ]);
    expect(touchCoords).toEqual([
      `152,64`, // tilePoint(7): col 3, row 1
      `152,108`, // tilePoint(11): col 3, row 2
      `108,108`, // tilePoint(10): col 2, row 2
      `108,108`,
    ]);

    // Both drags crossed the boundary as traced words: "HAT" over the
    // grid, then "ESM" coordinate-resolved through retargeted touch.
    expect(app!.conn().sentTypes()).toEqual(["create-room", "start-round", "submit-word", "submit-word"]);
    expect(app!.conn().sent().slice(-2)).toEqual([
      { type: "submit-word", word: "HAT", reqId: 3 },
      { type: "submit-word", word: "ESM", reqId: 4 },
    ]);
    expect(app!.root.querySelector("h1")!.textContent).toContain("Runde 1");
    expect(tileEls(app!.root).map((t) => t.textContent)).toEqual(BOARD.map((letter, i) => `${letter}${i}`));
  });
});
