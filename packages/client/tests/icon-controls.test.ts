// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
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

function enterLobby(): void {
  click("#create-btn");
  app!.root.querySelector<HTMLInputElement>("#mk-nick")!.value = "Lena";
  click("#mk-btn");
  app!.conn().feed(lobbySnapshot({ code: "LAG4T", nickname: "Lena" }));
}

function expectLeaveButton(): void {
  const button = app!.root.querySelector<HTMLButtonElement>("#leave-btn")!;
  expect(button.getAttribute("aria-label")).toBe("Raum verlassen");
  expect(button.getAttribute("data-tip")).toBe("Raum verlassen");
  expect(button.hasAttribute("aria-describedby")).toBe(false);
  expect(button.textContent).toBe("");
  const svg = button.querySelector("svg")!;
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.getAttribute("stroke")).toBe("currentColor");
}

describe("icon-only controls (#174)", () => {
  it("names and tooltips every leave control with the same string", () => {
    enterLobby();
    expectLeaveButton();

    app!.conn().feed(
      playingSnapshot({
        code: "LAG4T",
        selfSeatId: 1,
        nickname: "Lena",
        role: "player",
        board: BOARD,
      })
    );
    expectLeaveButton();

    app!.conn().feed(roundEnded(1, { groups: [] }));
    expectLeaveButton();
  });

  it("keeps the outcome action as an icon plus visible text", () => {
    enterLobby();
    app!.conn().feed({ type: "room-ended", reason: "host-closed" });

    const button = app!.root.querySelector<HTMLButtonElement>("#home-btn")!;
    expect(button.textContent?.trim()).toBe("Zur Startseite");
    expect(button.hasAttribute("data-tip")).toBe(false);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    const svg = button.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
  });

  it("leaves the sort control's accessible name and pressed state on the buttons", () => {
    click("#join-btn");
    app!.root.querySelector<HTMLInputElement>("#jn-code")!.value = "ABC12";
    app!.root.querySelector<HTMLInputElement>("#jn-nick")!.value = "Ben";
    click("#jn-btn");
    app!.conn().feed(
      intermissionSnapshot({
        code: "ABC12",
        selfSeatId: 2,
        nickname: "Ben",
        board: BOARD,
        reveal: { groups: [{ length: 3, words: [{ word: "ast", points: 3, foundBy: [1] }] }] },
      })
    );

    const buttons = [...app!.root.querySelectorAll<HTMLButtonElement>("#reveal-sort button")];
    expect(buttons.map((b) => [b.getAttribute("aria-label"), b.getAttribute("data-tip")])).toEqual([
      ["Nach Länge sortieren", "Nach Länge sortieren"],
      ["Nach Punkten sortieren", "Nach Punkten sortieren"],
      ["Alphabetisch sortieren", "Alphabetisch sortieren"],
    ]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);

    buttons[1]!.click();
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  });
});
