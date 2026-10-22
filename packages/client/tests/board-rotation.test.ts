// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  firePointerEvent,
  intermissionSnapshot,
  lobbySnapshot,
  mountHarness,
  playerJoined,
  playingSnapshot,
  roundEnded,
  roundStarted,
  seat,
  tick,
  tileEls,
  type Mounted,
  type PlayerInfo,
} from "./harness.js";

/**
 * Player-local board rotation (#151): a client-only view transform. The
 * board data, wire messages and score never change; only which cell each
 * upright tile occupies.
 *
 * The assertions are on rendered tiles and the scripted boundary, never on
 * the private arrangement helper. The synthetic tile geometry in the
 * harness is the same one the app's point→tile hit-test answers from, so a
 * drag pins the rotated arrangement end to end.
 */

const BOARD = ["H", "A", "U", "S", "T", "I", "R", "E", "B", "U", "M", "S", "K", "A", "T", "Z"];

/** The server board laid clockwise over the grid. */
const CLOCKWISE_90 = ["K", "B", "T", "H", "A", "U", "I", "A", "T", "M", "R", "U", "Z", "S", "E", "S"];
const CLOCKWISE_180 = ["Z", "T", "A", "K", "S", "M", "U", "B", "E", "R", "I", "T", "S", "U", "A", "H"];
const CLOCKWISE_270 = ["S", "E", "S", "Z", "U", "R", "M", "T", "A", "I", "U", "A", "H", "T", "B", "K"];

const NO_WORDS = { groups: [] };

let app: Mounted | null = null;

beforeEach(() => {
  window.history.pushState({}, "", "/");
  app = mountHarness();
});

afterEach(() => {
  app?.unmount();
  app = null;
});

/** Enter Create from the Home landing (ADR-0021). */
function openCreate(): void {
  if (!app!.root.querySelector("#mk-nick")) click("#create-btn");
}

/** Enter Join from the Home landing (ADR-0021). */
function openJoin(): void {
  if (!app!.root.querySelector("#jn-code")) click("#join-btn");
}

/** A form helper walks the landing first when its field is not on screen. */
function ensureEntryScreen(sel: string): void {
  if (app!.root.querySelector(sel)) return;
  if (sel === "#mk-nick" || sel === "#mk-btn") openCreate();
  else if (sel.startsWith("#jn-")) openJoin();
}

function click(sel: string): void {
  ensureEntryScreen(sel);
  app!.root.querySelector<HTMLButtonElement>(sel)!.click();
}

function typeInto(sel: string, value: string): void {
  ensureEntryScreen(sel);
  app!.root.querySelector<HTMLInputElement>(sel)!.value = value;
}

/** Home → lobby → round one. */
function driveToRoundOne(code = "LAG4T"): void {
  typeInto("#mk-nick", "Lena");
  click("#mk-btn");
  app!.conn().feed(lobbySnapshot({ code, nickname: "Lena" }));
  click("#start-btn");
  app!.conn().feed(roundStarted(BOARD));
}

function rotationButton(): HTMLButtonElement {
  return app!.root.querySelector<HTMLButtonElement>("#board-rotation")!;
}

/** The board's live, machine-readable quarter turn (never the control name). */
function rotation(): string {
  return app!.root.querySelector<HTMLElement>("#board")!.dataset.rotation ?? "";
}

/** One press per quarter turn, in the control's clockwise cycle. */
function turn(times: number): void {
  for (let press = 0; press < times; press += 1) rotationButton().click();
}

/** Each rendered tile's visible letters (the text before its corner value). */
function letters(): string[] {
  return tileEls(app!.root).map((tile) => tile.firstChild?.textContent ?? "");
}

/** Each rendered tile's letters paired with its visible corner value. */
function tiles(): { letters: string; points: string }[] {
  return tileEls(app!.root).map((tile) => ({
    letters: tile.firstChild?.textContent ?? "",
    points: tile.querySelector(".pts")?.textContent ?? "",
  }));
}

function traceText(): string {
  return app!.root.querySelector("#trace")?.textContent ?? "";
}

describe("board rotation (#151)", () => {
  it("offers one icon-only button whose stable name is its tooltip and cycles 0→90→180→270→0", () => {
    driveToRoundOne();
    const button = rotationButton();
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe("Spielfeld um 90° drehen");
    expect(button.getAttribute("data-tip")).toBe("Spielfeld um 90° drehen");
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    expect(button.textContent).toBe("");
    expect(app!.root.querySelector("#board-rotation [role='group']")).toBeNull();
    expect(app!.root.querySelector("#board-rotation .rotate-label")).toBeNull();

    const svg = button.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("stroke-width")).toBe("2");
    expect(svg.getAttribute("aria-hidden")).toBe("true");

    expect(rotation()).toBe("0");
    expect(letters()).toEqual(BOARD);

    button.click();
    expect(rotation()).toBe("90");
    expect(letters()).toEqual(CLOCKWISE_90);

    button.click();
    expect(rotation()).toBe("180");
    expect(letters()).toEqual(CLOCKWISE_180);

    button.click();
    expect(rotation()).toBe("270");
    expect(letters()).toEqual(CLOCKWISE_270);

    button.click();
    expect(rotation()).toBe("0");
    expect(letters()).toEqual(BOARD);
  });

  it("permutes the same sixteen upright tiles and keeps every point value in its corner", () => {
    driveToRoundOne();
    const base = tiles();
    expect(base).toHaveLength(16);

    for (const [step, expected] of [
      [90, CLOCKWISE_90],
      [180, CLOCKWISE_180],
      [270, CLOCKWISE_270],
    ] as const) {
      turn(1);
      const rendered = tiles();
      expect(rendered.map((t) => t.letters)).toEqual(expected);
      // The same tile/painter pair moves as one: letters and points never
      // split, and every tile still carries a visible corner value.
      expect(rendered).toHaveLength(16);
      expect(new Set(rendered.map((t) => `${t.letters}:${t.points}`))).toEqual(
        new Set(base.map((t) => `${t.letters}:${t.points}`))
      );
      // No rigid board rotation: the rendered tiles are plain, upright cells.
      expect(app!.root.querySelector<HTMLElement>("#board")!.style.transform).toBe("");
      expect(rotation()).toBe(String(step));
    }
  });

  it("resolves a point to the rotated cell and submits the word those tiles spell", () => {
    driveToRoundOne();
    turn(1);

    const rotated = tileEls(app!.root);
    // Clockwise 90°: cell 3 = H, cell 7 = A, cell 2 = T — one 8-way path.
    expect([rotated[3], rotated[7], rotated[2]].map((tile) => tile!.firstChild?.textContent)).toEqual([
      "H",
      "A",
      "T",
    ]);

    const seen: string[] = [];
    firePointerEvent(rotated[3]!, "pointerdown");
    seen.push(traceText());
    firePointerEvent(rotated[7]!, "pointermove");
    seen.push(traceText());
    firePointerEvent(rotated[2]!, "pointermove");
    seen.push(traceText());
    firePointerEvent(rotated[2]!, "pointerup");

    expect(seen).toEqual(["H", "HA", "HAT"]);
    expect(traceText()).toBe("Wische über die Felder, um ein Wort zu bilden.");
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HAT", reqId: 3 });
  });

  it("keeps the chosen arrangement through live updates and structural re-renders, and shows it on that round's intermission", () => {
    driveToRoundOne();
    turn(2);

    // A play-time delta updates live regions in place.
    app!.conn().feed(tick(100_000));
    expect(letters()).toEqual(CLOCKWISE_180);
    expect(rotation()).toBe("180");

    // A structural delta rebuilds the screen from the same app state.
    app!.conn().feed(playerJoined(2, "Ben"));
    expect(letters()).toEqual(CLOCKWISE_180);
    expect(rotation()).toBe("180");

    // The pause shows the board exactly as the round was played.
    app!.conn().feed(roundEnded(1, NO_WORDS));
    expect(app!.root.querySelector("h1")!.textContent).toBe("Pause");
    expect(letters()).toEqual(CLOCKWISE_180);
    expect(rotation()).toBe("180");
  });

  it("resets to 0° when the next board starts", () => {
    driveToRoundOne();
    turn(1);
    app!.conn().feed(roundEnded(1, NO_WORDS));
    expect(letters()).toEqual(CLOCKWISE_90);
    expect(rotation()).toBe("90");

    app!.conn().feed(roundStarted(BOARD, 2));
    expect(letters()).toEqual(BOARD);
    expect(rotation()).toBe("0");
  });

  it("starts a fresh mount at 0°", () => {
    driveToRoundOne();
    turn(3);
    expect(rotation()).toBe("270");

    app!.unmount();
    app = mountHarness();
    typeInto("#jn-code", "LAG4T");
    typeInto("#jn-nick", "Lena");
    click("#jn-btn");
    app!.conn().feed(
      playingSnapshot({
        code: "LAG4T",
        selfSeatId: 1,
        nickname: "Lena",
        role: "player",
        board: BOARD,
      })
    );

    expect(letters()).toEqual(BOARD);
    expect(rotation()).toBe("0");
  });

  it("keeps the step across a reconnect snapshot for the same board and resets it for a different board", () => {
    driveToRoundOne();
    turn(1);

    app!.conn().feed(
      playingSnapshot({
        code: "LAG4T",
        selfSeatId: 1,
        nickname: "Lena",
        role: "player",
        board: BOARD,
      })
    );
    expect(rotation()).toBe("90");
    expect(letters()).toEqual(CLOCKWISE_90);

    const NEXT = ["Z", "U", "R", "F", "E", "L", "D", "A", "M", "I", "S", "T", "K", "O", "N", "G"];
    app!.conn().feed(
      playingSnapshot({
        code: "LAG4T",
        selfSeatId: 1,
        nickname: "Lena",
        role: "player",
        board: NEXT,
        roundNumber: 2,
      })
    );
    expect(rotation()).toBe("0");
    expect(letters()).toEqual(NEXT);
  });

  it("sends no wire message and changes neither the board data nor the score", () => {
    driveToRoundOne();
    app!.conn().feed({
      type: "score-update",
      roundNumber: 1,
      scores: [{ seatId: 1, nickname: "Lena", roundScore: 7, cumulativeScore: 7 }],
    });
    const sentBefore = app!.conn().sent().length;
    const score = app!.root.querySelector("#round-score")!.textContent;
    const board = app!.root.querySelector("#board");

    turn(3);

    expect(app!.conn().sent()).toHaveLength(sentBefore);
    expect(app!.root.querySelector("#round-score")!.textContent).toBe(score);
    expect(app!.root.querySelector("#board")).toBe(board);
    expect(letters()).toEqual(CLOCKWISE_270);
  });

  it("gives spectators the same control", () => {
    typeInto("#jn-code", "ABC12");
    typeInto("#jn-nick", "Ben");
    click("#jn-btn");
    app!.conn().feed(
      playingSnapshot({
        code: "ABC12",
        selfSeatId: 2,
        nickname: "Ben",
        role: "spectator",
        board: BOARD,
        players: [seat({ seatId: 1, nickname: "Lena" }), seat({ seatId: 2, nickname: "Ben" })],
      })
    );

    expect(app!.root.querySelector("#board-rotation")).toBeTruthy();
    turn(2);
    expect(letters()).toEqual(CLOCKWISE_180);
    expect(rotation()).toBe("180");
  });

  it("ends an in-progress drag without submitting it", () => {
    driveToRoundOne();
    const tilesNow = tileEls(app!.root);
    firePointerEvent(tilesNow[0]!, "pointerdown");
    firePointerEvent(tilesNow[1]!, "pointermove");
    expect(traceText()).toBe("HA");

    turn(1);
    expect(traceText()).toBe("Wische über die Felder, um ein Wort zu bilden.");
    expect(letters()).toEqual(CLOCKWISE_90);

    // The old gesture is gone: releasing now submits nothing.
    firePointerEvent(tileEls(app!.root)[0]!, "pointerup");
    expect(app!.conn().sentTypes()).toEqual(["create-room", "start-round"]);
    expect(traceText()).toBe("Wische über die Felder, um ein Wort zu bilden.");
  });

  it("shows the control on an intermission snapshot too", () => {
    typeInto("#jn-code", "LATE5");
    typeInto("#jn-nick", "Ben");
    click("#jn-btn");
    const roster: PlayerInfo[] = [
      seat({ seatId: 1, nickname: "Lena" }),
      seat({ seatId: 2, nickname: "Ben" }),
    ];
    app!.conn().feed(
      intermissionSnapshot({
        code: "LATE5",
        selfSeatId: 2,
        nickname: "Ben",
        hostSeatId: 1,
        board: BOARD,
        reveal: NO_WORDS,
        players: roster,
      })
    );

    expect(app!.root.querySelector<HTMLElement>("#board-rotation")!.getAttribute("aria-label")).toBe(
      "Spielfeld um 90° drehen"
    );
    turn(1);
    expect(letters()).toEqual(CLOCKWISE_90);
    expect(rotation()).toBe("90");
  });
});
