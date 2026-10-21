// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  intermissionSnapshot,
  lobbySnapshot,
  mountHarness,
  roundEnded,
  roundStarted,
  seat,
  type Mounted,
  type PlayerInfo,
} from "./harness.js";
import type { RevealPayload, RevealWord } from "@wortschatz/shared";

/**
 * The intermission's local reveal ordering (#140): three modes over the same
 * server payload, defaulting to the untouched length grouping. Assertions
 * live on rendered DOM and boundary messages only.
 */

const BOARD = ["H", "A", "U", "S", "T", "I", "R", "E", "B", "U", "M", "S", "K", "A", "T", "Z"];

function word(word: string, points: number, foundBy: number[] = []): RevealWord {
  return { word, points, foundBy };
}

/** Server groups ascend by length; the words inside each group are
 *  deliberately not alphabetical, so the default can prove it preserves the
 *  server's order. */
const GROUPED: RevealPayload = {
  groups: [
    {
      length: 3,
      words: [word("zur", 2, [1]), word("ass", 7), word("ärz", 5, [2])],
    },
    {
      length: 4,
      words: [word("zelt", 9, [1, 2]), word("ofen", 1, [2])],
    },
  ],
};

/** Equal points must fall back to German collation: ö before t; then the
 *  five-point words a, ä, z. */
const POINTS: RevealPayload = {
  groups: [
    { length: 4, words: [word("test", 9, [1]), word("ölen", 9, [2])] },
    {
      length: 5,
      words: [word("zunge", 5), word("ärger", 5, [2]), word("apfel", 5, [1, 2])],
    },
  ],
};

/** German collation places ä near a, ö near o, ü near u, and ß after ss —
 *  not after z. */
const ALPHABET: RevealPayload = {
  groups: [
    { length: 4, words: [word("ölen", 1), word("über", 1)] },
    { length: 5, words: [word("zunge", 1), word("ärger", 1), word("apfel", 1)] },
    { length: 6, words: [word("straße", 1)] },
    { length: 7, words: [word("strasse", 1)] },
  ],
};

let app: Mounted | null = null;

beforeEach(() => {
  window.history.pushState({}, "", "/");
  app = mountHarness();
});

afterEach(() => {
  app?.unmount();
  app = null;
});

function typeInto(sel: string, value: string): void {
  app!.root.querySelector<HTMLInputElement>(sel)!.value = value;
}

function click(sel: string): void {
  app!.root.querySelector<HTMLButtonElement>(sel)!.click();
}

/** Home → lobby → round one, with a two-player roster for finder chips. */
function driveToRoundOne(code = "LAG4T"): void {
  const roster: PlayerInfo[] = [seat({ seatId: 1, nickname: "Lena" }), seat({ seatId: 2, nickname: "Ben" })];
  typeInto("#mk-nick", roster[0]!.nickname);
  click("#mk-btn");
  app!.conn().feed(lobbySnapshot({ code, nickname: roster[0]!.nickname, players: roster }));
  click("#start-btn");
  app!.conn().feed(roundStarted(BOARD));
}

function sortButton(mode: "length" | "points" | "alphabet"): HTMLButtonElement {
  return app!.root.querySelector<HTMLButtonElement>(`#reveal-sort button[data-sort="${mode}"]`)!;
}

function pressed(): Record<string, string | null> {
  const modes = ["length", "points", "alphabet"] as const;
  return Object.fromEntries(modes.map((mode) => [mode, sortButton(mode).getAttribute("aria-pressed")]));
}

function words(): string[] {
  return [...app!.root.querySelectorAll<HTMLElement>("#reveal .rw-word")].map((el) => el.textContent ?? "");
}

function revealText(): string {
  return (app!.root.querySelector("#reveal")?.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("intermission reveal sorting (#140)", () => {
  it("defaults to Länge and renders exactly the server's grouped view", () => {
    driveToRoundOne();
    app!.conn().feed(roundEnded(1, GROUPED));

    const group = app!.root.querySelector<HTMLElement>("#reveal-sort")!;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("Sortieren nach");
    expect(group.textContent).toContain("Sortieren nach");
    const buttons = [...group.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((b) => b.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
    expect(buttons.map((b) => b.textContent)).toEqual(["Länge", "Punkte", "Alphabet"]);
    expect(pressed()).toEqual({ length: "true", points: "false", alphabet: "false" });

    // Same headings, same server word order inside each group.
    const headings = [...app!.root.querySelectorAll<HTMLElement>("#reveal dt")];
    expect(headings.map((dt) => dt.textContent)).toEqual(["3 Buchstaben", "4 Buchstaben"]);
    expect(words()).toEqual(["zur", "ass", "ärz", "zelt", "ofen"]);

    // Points, found-by chips and the dimmed missed treatment survive.
    const zur = [...app!.root.querySelectorAll<HTMLElement>("#reveal .rw")].find(
      (el) => el.querySelector(".rw-word")!.textContent === "zur"
    )!;
    expect(zur.querySelector(".rw-pts")!.textContent).toBe("+2");
    expect([...zur.querySelectorAll<HTMLElement>(".fby")].map((el) => el.textContent)).toEqual(["Lena"]);
    const missed = [...app!.root.querySelectorAll<HTMLElement>("#reveal .rw")].find(
      (el) => el.querySelector(".rw-word")!.textContent === "ass"
    )!;
    expect(missed.classList.contains("missed")).toBe(true);
    expect(missed.querySelectorAll(".fby")).toHaveLength(0);
  });

  it("Punkte flattens across lengths, orders points descending, and breaks ties in German order", () => {
    driveToRoundOne();
    app!.conn().feed(roundEnded(1, POINTS));

    sortButton("points").click();

    expect(pressed()).toEqual({ length: "false", points: "true", alphabet: "false" });
    expect(app!.root.querySelectorAll("#reveal dt")).toHaveLength(0);
    expect(app!.root.querySelectorAll("#reveal dd")).toHaveLength(1);
    expect(words()).toEqual(["ölen", "test", "apfel", "ärger", "zunge"]);

    // Every word still carries its points and finder chips; the missed word
    // is still present and dimmed.
    const rendered = [...app!.root.querySelectorAll<HTMLElement>("#reveal .rw")];
    const byWord = (name: string) =>
      rendered.find((el) => el.querySelector(".rw-word")!.textContent === name)!;
    expect(rendered.map((el) => el.querySelector(".rw-pts")!.textContent)).toEqual([
      "+9",
      "+9",
      "+5",
      "+5",
      "+5",
    ]);
    expect([...byWord("apfel").querySelectorAll(".fby")].map((el) => el.textContent)).toEqual([
      "Lena",
      "Ben",
    ]);
    expect(byWord("zunge").classList.contains("missed")).toBe(true);
  });

  it("Alphabet flattens into German A–Z order, including ä, ö, ü and ß", () => {
    driveToRoundOne();
    app!.conn().feed(roundEnded(1, ALPHABET));

    sortButton("alphabet").click();

    expect(pressed()).toEqual({ length: "false", points: "false", alphabet: "true" });
    expect(app!.root.querySelectorAll("#reveal dt")).toHaveLength(0);
    expect(words()).toEqual(["apfel", "ärger", "ölen", "strasse", "straẞe", "über", "zunge"]);
  });

  it("keeps the chosen mode across consecutive intermissions in the same room", () => {
    driveToRoundOne();
    app!.conn().feed(roundEnded(1, POINTS));
    sortButton("points").click();
    expect(pressed().points).toBe("true");

    // The host starts the next round and it ends again: no snapshot, so the
    // room-scoped choice rides along.
    app!.conn().feed(roundStarted(BOARD, 2));
    app!.conn().feed(roundEnded(2, POINTS));

    expect(pressed()).toEqual({ length: "false", points: "true", alphabet: "false" });
    expect(words()).toEqual(["ölen", "test", "apfel", "ärger", "zunge"]);
  });

  it("resets to Länge on a reconnect snapshot and on a fresh mount", () => {
    driveToRoundOne();
    app!.conn().feed(roundEnded(1, GROUPED));
    sortButton("alphabet").click();
    expect(pressed().alphabet).toBe("true");

    // Reconnect/resync snapshot for the same room: back to the grouped view.
    app!.conn().feed(
      intermissionSnapshot({
        code: "LAG4T",
        selfSeatId: 1,
        nickname: "Lena",
        board: BOARD,
        reveal: GROUPED,
        roundNumber: 1,
      })
    );
    expect(pressed()).toEqual({ length: "true", points: "false", alphabet: "false" });
    expect(app!.root.querySelectorAll("#reveal dt")).toHaveLength(2);

    // A fresh mount starts over too.
    app!.unmount();
    app = mountHarness();
    typeInto("#jn-code", "LAG4T");
    typeInto("#jn-nick", "Lena");
    click("#jn-btn");
    app!.conn().feed(
      intermissionSnapshot({
        code: "LAG4T",
        selfSeatId: 1,
        nickname: "Lena",
        board: BOARD,
        reveal: GROUPED,
        roundNumber: 1,
      })
    );
    expect(pressed()).toEqual({ length: "true", points: "false", alphabet: "false" });
  });

  it("resets to Länge when joining a different room", () => {
    driveToRoundOne();
    app!.conn().feed(roundEnded(1, GROUPED));
    sortButton("alphabet").click();
    expect(pressed().alphabet).toBe("true");

    click("#leave-btn");
    typeInto("#jn-code", "NEU42");
    typeInto("#jn-nick", "Ben");
    click("#jn-btn");
    app!.conn().feed(
      intermissionSnapshot({
        code: "NEU42",
        selfSeatId: 2,
        nickname: "Ben",
        hostSeatId: 1,
        board: BOARD,
        reveal: GROUPED,
        roundNumber: 1,
      })
    );

    expect(pressed()).toEqual({ length: "true", points: "false", alphabet: "false" });
    expect(app!.root.querySelectorAll("#reveal dt")).toHaveLength(2);
  });

  it("hides the control and keeps the empty state when the reveal has no words", () => {
    driveToRoundOne();
    app!.conn().feed(roundEnded(1, { groups: [] }));

    expect(app!.root.querySelector("#reveal-sort")).toBeNull();
    expect(revealText()).toContain("Ergebnisse");
    expect(revealText()).toContain("—");

    // Groups that merely exist but hold no words are empty too.
    app!.conn().feed(roundEnded(2, { groups: [{ length: 3, words: [] }] }));
    expect(app!.root.querySelector("#reveal-sort")).toBeNull();
    expect(revealText()).toContain("Ergebnisse");
  });

  it("switching modes sends no wire message and leaves the board and reveal element in place", () => {
    driveToRoundOne();
    app!.conn().feed(roundEnded(1, POINTS));

    const board = app!.root.querySelector("#board");
    const reveal = app!.root.querySelector("#reveal");
    const sentBefore = app!.conn().sent().length;

    sortButton("points").click();

    expect(app!.conn().sent()).toHaveLength(sentBefore);
    expect(app!.root.querySelector("#board")).toBe(board);
    expect(app!.root.querySelector("#reveal")).toBe(reveal);
    // The pause has no timer; switching never conjures one.
    expect(app!.root.querySelector("#timer")).toBeNull();

    // Selecting the already-active mode is a no-op.
    const html = reveal!.innerHTML;
    sortButton("points").click();
    expect(reveal!.innerHTML).toBe(html);
    expect(app!.conn().sent()).toHaveLength(sentBefore);
  });

  it("shows the control to spectators, who can use it", () => {
    typeInto("#jn-code", "ABC12");
    typeInto("#jn-nick", "Ben");
    click("#jn-btn");
    app!.conn().feed(
      intermissionSnapshot({
        code: "ABC12",
        selfSeatId: 2,
        nickname: "Ben",
        role: "spectator",
        hostSeatId: 1,
        board: BOARD,
        reveal: POINTS,
      })
    );

    expect(app!.root.querySelector("#reveal-sort")).toBeTruthy();
    sortButton("alphabet").click();
    expect(pressed().alphabet).toBe("true");
    expect(words()).toEqual(["apfel", "ärger", "ölen", "test", "zunge"]);
  });
});
