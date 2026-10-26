// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BOARD,
  COPY,
  NO_WORDS,
  ROOM_CODE,
  driveScene,
  intermissionSnapshot,
  lobbySnapshot,
  mountHarness,
  playingSnapshot,
  roundEnded,
  type Mounted,
} from "./harness.js";

/**
 * Icon-only secondary controls (#174): the accessible name is available
 * without hover or a pointer, it is the same single string as the tooltip,
 * and no described-by relationship duplicates the announcement. Icons are
 * decorative SVG; leaving the room and the outcome action are covered here.
 */

let app: Mounted | null = null;

beforeEach(() => {
  window.history.pushState({}, "", "/");
  app = mountHarness();
});

afterEach(() => {
  app?.unmount();
  app = null;
});

function expectLeaveButton(): void {
  const button = app!.root.querySelector<HTMLButtonElement>("#leave-btn")!;
  expect(button.getAttribute("aria-label")).toBe(COPY.lobby.leave);
  expect(button.getAttribute("data-tip")).toBe(COPY.lobby.leave);
  expect(button.hasAttribute("aria-describedby")).toBe(false);
  expect(button.textContent).toBe("");
  const svg = button.querySelector("svg")!;
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.getAttribute("stroke")).toBe("currentColor");
}

describe("icon-only controls (#174)", () => {
  it("names and tooltips every leave control with the same string", () => {
    driveScene(app!, {
      entry: { mode: "create", nickname: "Lena" },
      greeting: [lobbySnapshot({ code: ROOM_CODE, nickname: "Lena" })],
    });
    expectLeaveButton();

    app!.conn().feed(
      playingSnapshot({
        code: ROOM_CODE,
        selfSeatId: 1,
        nickname: "Lena",
        role: "player",
        board: BOARD,
      })
    );
    expectLeaveButton();

    app!.conn().feed(roundEnded(1, NO_WORDS));
    expectLeaveButton();
  });

  it("keeps the outcome action as an icon plus visible text", () => {
    driveScene(app!, {
      entry: { mode: "create", nickname: "Lena" },
      greeting: [lobbySnapshot({ code: ROOM_CODE, nickname: "Lena" })],
    });
    app!.conn().feed({ type: "room-ended", reason: "host-closed" });

    const button = app!.root.querySelector<HTMLButtonElement>("#home-btn")!;
    expect(button.textContent?.trim()).toBe(COPY.outcomes.home);
    expect(button.hasAttribute("data-tip")).toBe(false);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    const svg = button.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
  });

  it("leaves the sort control's accessible name and pressed state on the buttons", () => {
    driveScene(app!, {
      entry: { mode: "join", nickname: "Ben", code: ROOM_CODE },
      greeting: [
        intermissionSnapshot({
          code: ROOM_CODE,
          selfSeatId: 2,
          nickname: "Ben",
          board: BOARD,
          reveal: { groups: [{ length: 3, words: [{ word: "ast", points: 3, foundBy: [1] }] }] },
        }),
      ],
    });

    const buttons = [...app!.root.querySelectorAll<HTMLButtonElement>("#reveal-sort button")];
    expect(buttons.map((b) => [b.getAttribute("aria-label"), b.getAttribute("data-tip")])).toEqual([
      [COPY.intermission.sortLength, COPY.intermission.sortLength],
      [COPY.intermission.sortPoints, COPY.intermission.sortPoints],
      [COPY.intermission.sortAlphabet, COPY.intermission.sortAlphabet],
    ]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);

    buttons[1]!.click();
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  });
});
