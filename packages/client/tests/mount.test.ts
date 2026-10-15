// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  lobbySnapshot,
  mountHarness,
  playerJoined,
  roundStarted,
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
    // heading's round counter only refreshes on snapshots — a round-start
    // delta never bumps it (pinned current behavior).
    app!.conn().feed(roundStarted(BOARD));
    expect(app!.root.querySelector("h1")!.textContent).toContain("Runde 0");
    const tiles = tileEls(app!.root);
    expect(tiles.map((t) => t.textContent)).toEqual(BOARD.map((letter, i) => `${letter}${i}`));
    expect(app!.root.querySelector<HTMLElement>("#countdown")!.textContent).toBe("2:00");

    // A typed word goes out trimmed; the verdict comes back and renders.
    app!.root.querySelector<HTMLInputElement>("#word-input")!.value = "  HAUS  ";
    app!.root
      .querySelector<HTMLFormElement>("#word-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(app!.conn().sent()).toEqual([
      { type: "create-room", nickname: "Lena", reqId: 1 },
      { type: "start-round", reqId: 2 },
      { type: "submit-word", word: "HAUS", reqId: 3 },
    ]);
    expect(app!.root.querySelector<HTMLInputElement>("#word-input")!.value).toBe("");
    app!.conn().feed({ type: "word-accepted", word: "HAUS", points: 4 });
    expect(app!.root.textContent).toContain("Gefunden: HAUS");
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

    // A drag touches no boundary: nothing new was sent, screen untouched.
    expect(app!.conn().sentTypes()).toEqual(["create-room", "start-round"]);
    expect(app!.root.querySelector("h1")!.textContent).toContain("Runde 0");
    expect(app!.root.querySelector<HTMLElement>("#countdown")!.textContent).toBe("2:00");
    expect(tileEls(app!.root).map((t) => t.textContent)).toEqual(BOARD.map((letter, i) => `${letter}${i}`));
  });
});
