// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  intermissionSnapshot,
  lobbySnapshot,
  mountHarness,
  playingSnapshot,
  playerJoined,
  roundEnded,
  roundStarted,
  strayTouchMove,
  synthesizePointerDrag,
  synthesizeTouchDrag,
  firePointerEvent,
  fireTouchEvent,
  seat,
  tick,
  tileAtPoint,
  tileEls,
  tilePoint,
  wikiLinks,
  type Mounted,
  type PlayerInfo,
} from "./harness.js";
import type { ErrorCode, RevealPayload } from "@wortschatz/shared";
import { SKINS } from "../src/skins.js";

/** The #17 reveal wire shape, worked out by hand from the hand-scored words:
 *  ort 4 points, found by both seats; saat missed; test 4 points, Lena only. */
const REVEAL: RevealPayload = {
  groups: [
    { length: 3, words: [{ word: "ort", points: 4, foundBy: [1, 2] }] },
    {
      length: 4,
      words: [
        { word: "saat", points: 4, foundBy: [] },
        { word: "test", points: 4, foundBy: [1] },
      ],
    },
  ],
};

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

/** Enter Create from the Home landing (ADR-0021). */
function openCreate(): void {
  if (!app!.root.querySelector("#mk-nick")) click("#create-btn");
}

/** Enter Join from the Home landing (ADR-0021). */
function openJoin(): void {
  if (!app!.root.querySelector("#jn-code")) click("#join-btn");
}

/** The split entry screens: a form helper walks the landing first when the
 *  field is not already on screen (a deep link is already on Join). */
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

/** The floating layer's non-empty notices, in DOM order (status, then
 *  error) — the external view ADR-0018 tests assert. */
function notices(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("#notifications .notice")].filter(
    (el) => (el.textContent ?? "") !== ""
  );
}

/** One named notice slot's current text. */
function noticeText(root: HTMLElement, slot: "status" | "error"): string {
  return root.querySelector<HTMLElement>(`#notice-${slot}`)?.textContent ?? "";
}

/** The rendered intermission reveal, whitespace-normalized — the identity
 *  mirrored between the round-end delta channel and the snapshot channel. */
function revealText(root: HTMLElement): string {
  return (root.querySelector("#reveal")?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Home → lobby → (host starts) → round one, through the boundary. */
function driveToRoundOne(code: string): void {
  driveToRoundWith(code, [seat({ seatId: 1, nickname: "Lena" })]);
}

/** Home → lobby (with a ready roster) → round one, through the boundary. */
function driveToRoundWith(code: string, roster: PlayerInfo[]): void {
  typeInto("#mk-nick", roster[0]!.nickname);
  click("#mk-btn");
  app!.conn().feed(lobbySnapshot({ code, nickname: roster[0]!.nickname, players: roster }));
  click("#start-btn");
  app!.conn().feed(roundStarted(BOARD));
}

describe("mountable app", () => {
  describe("in-room screens (#20)", () => {
    it("the lobby shows seats as player chips — nickname, host/role badge, connected state — and the host affordance", () => {
      typeInto("#mk-nick", "Lena");
      click("#mk-btn");
      // A lobby can hold a disconnected seat: its holder lost the socket but
      // keeps the reservation (glossary: seat).
      app!.conn().feed(
        lobbySnapshot({
          code: "LAG4T",
          nickname: "Lena",
          players: [
            seat({ seatId: 1, nickname: "Lena" }),
            seat({ seatId: 2, nickname: "Ben" }),
            seat({ seatId: 3, nickname: "Cem", connected: false }),
          ],
        })
      );

      // One chip per person — join order, the self chip highlighted.
      const chips = [...app!.root.querySelectorAll<HTMLElement>("#players .chip.player")];
      expect(chips).toHaveLength(3);
      expect(chips[0]!.classList.contains("me")).toBe(true);
      expect(chips[0]!.textContent).toContain("Lena");
      expect(chips[1]!.textContent).toContain("Ben");
      expect(chips[2]!.textContent).toContain("Cem");

      // Events live on the chips, not as duplicated text: the host badge on
      // my chip only, connected dots on every chip, the disconnected state
      // spelled out in German on Cem's chip.
      expect(chips[0]!.textContent).toContain("Gastgeber");
      expect(chips[1]!.textContent).not.toContain("Gastgeber");
      const dots = chips.map((c) => c.querySelector(".dot"));
      expect(dots).toHaveLength(3);
      expect(chips[0]!.querySelector(".dot.on")).toBeTruthy();
      expect(chips[2]!.querySelector(".dot.off")).toBeTruthy();
      expect(chips[2]!.textContent).toContain("unterbrochen");

      // The host's round-start affordance; a lone host may start.
      expect(app!.root.querySelector("#start-btn")).toBeTruthy();
      expect(app!.root.querySelector("#players")).toBeTruthy();

      // The count line reads the agreed copy, counting connected seats only
      // (Cem is disconnected): "N von 8 verbunden".
      expect(app!.root.querySelector("#players + p")!.textContent).toContain("2 von 8 verbunden");

      // The address bar carries the room's real deep link, not the greeting
      // key the creator pushed before the server named the room.
      expect(window.location.pathname).toBe("/r/LAG4T");
    });

    it("the lobby shows an Einladen QR card whose payload is the same deep link as the text fallback", () => {
      typeInto("#mk-nick", "Lena");
      click("#mk-btn");
      app!.conn().feed(lobbySnapshot({ code: "LAG4T", nickname: "Lena" }));

      // The agreed German copy: heading and camera instruction.
      const panel = app!.root.querySelector<HTMLElement>(".panel.invite")!;
      expect(panel.querySelector("h2")!.textContent).toBe("Einladen");
      expect(panel.querySelector(".note")!.textContent).toBe(
        "Scanne den Code mit der Kamera, um beizutreten."
      );

      // The QR element exists and encodes exactly the text link beside it —
      // origin + /r/<CODE>, code uppercased — so the two can never disagree.
      const qr = app!.root.querySelector<SVGElement>("#qr")!;
      expect(qr).toBeTruthy();
      const expected = `${location.origin}/r/LAG4T`;
      expect(app!.root.querySelector<HTMLElement>("#join-link")!.textContent).toBe(expected);
      expect(qr.getAttribute("data-payload")).toBe(expected);
    });

    it("the QR core keeps its literal dark-on-light colours under both skins", () => {
      typeInto("#mk-nick", "Lena");
      click("#mk-btn");
      app!.conn().feed(lobbySnapshot({ code: "LAG4T", nickname: "Lena" }));

      const standard = app!.root.querySelector("#qr")!.outerHTML;
      expect(standard).toContain('fill="#000000"');
      expect(standard).toContain('fill="#ffffff"');
      expect(standard).not.toContain("var(");

      // Switching the skin app-wide and re-rendering the lobby leaves the QR
      // byte-for-byte identical: its colours never came from the token system.
      document.body.dataset.skin = "arcade";
      app!.conn().feed(playerJoined(2, "Ben"));
      expect(app!.root.querySelector("#qr")!.outerHTML).toBe(standard);
      delete (document.body as { dataset: DOMStringMap }).dataset.skin;
    });

    it("the scoreboard live-updates per score-update: round-score order, ties share a place, join order breaks the tie", () => {
      driveToRoundWith("LAG4T", [
        seat({ seatId: 1, nickname: "Lena" }),
        seat({ seatId: 2, nickname: "Ben" }),
        seat({ seatId: 3, nickname: "Cem", connected: false }),
      ]);

      // One accepted verdict per seat arrives as a room-wide score-update.
      app!.conn().feed({
        type: "score-update",
        roundNumber: 1,
        scores: [
          { seatId: 2, nickname: "Ben", roundScore: 7, cumulativeScore: 7 },
          { seatId: 1, nickname: "Lena", roundScore: 5, cumulativeScore: 5 },
          { seatId: 3, nickname: "Cem", roundScore: 5, cumulativeScore: 5 },
        ],
      });

      // Ben leads alone; Lena and Cem tie on 5 and share second place, shown
      // in join order (seat 1 before seat 3) — Cem keeps her disconnected chip.
      const chips = [...app!.root.querySelectorAll<HTMLElement>("#players .chip.player")];
      const board = chips.map((c) => ({
        nick: c.querySelector(".nick")!.textContent,
        place: c.querySelector(".place")!.textContent,
      }));
      expect(board).toEqual([
        { nick: "Ben", place: "1" },
        { nick: "Lena", place: "2" },
        { nick: "Cem", place: "2" },
      ]);
      expect(chips.filter((c) => c.querySelector(".dot.off"))).toHaveLength(1);

      // The chip carries its round score.
      const scores = chips.map((c) => c.querySelector("small")!.textContent);
      expect(scores).toEqual(["7 P", "5 P", "5 P"]);

      // A later verdict reorders live: Cem's 9 overtakes Ben's 7.
      app!.conn().feed({
        type: "score-update",
        roundNumber: 1,
        scores: [
          { seatId: 3, nickname: "Cem", roundScore: 9, cumulativeScore: 9 },
          { seatId: 2, nickname: "Ben", roundScore: 7, cumulativeScore: 7 },
          { seatId: 1, nickname: "Lena", roundScore: 5, cumulativeScore: 5 },
        ],
      });
      const nowPlaces = [...app!.root.querySelectorAll<HTMLElement>("#players .chip.player .place")];
      expect(nowPlaces.map((c) => c.textContent)).toEqual(["1", "2", "3"]);
      expect(app!.root.querySelector("#players")!.textContent).toContain("Cem");
    });

    it("a new round resets the scoreboard: places from scratch, round scores cleared", () => {
      driveToRoundWith("LAG4T", [
        seat({ seatId: 1, nickname: "Lena" }),
        seat({ seatId: 2, nickname: "Ben" }),
        seat({ seatId: 3, nickname: "Cem" }),
      ]);
      app!.conn().feed({
        type: "score-update",
        roundNumber: 1,
        scores: [
          { seatId: 3, nickname: "Cem", roundScore: 9, cumulativeScore: 9 },
          { seatId: 2, nickname: "Ben", roundScore: 7, cumulativeScore: 7 },
          { seatId: 1, nickname: "Lena", roundScore: 5, cumulativeScore: 5 },
        ],
      });

      // The next round starts: the ranking empties, everyone ties at 0 and
      // the display order is pure join order.
      app!.conn().feed(roundStarted(BOARD, 2));
      const chips = [...app!.root.querySelectorAll<HTMLElement>("#players .chip.player")];
      expect(chips.map((c) => c.querySelector(".nick")!.textContent)).toEqual(["Lena", "Ben", "Cem"]);
      expect(chips.map((c) => c.querySelector(".place")!.textContent)).toEqual(["1", "1", "1"]);
      expect(chips.map((c) => c.querySelector("small")!.textContent)).toEqual(["0 P", "0 P", "0 P"]);
    });

    it("the game screen renders one dashboard DOM with the arranged area hooks and the shared chip vocabulary", () => {
      driveToRoundOne("LAG4T");

      // One arrangement container feeds both breakpoints (ADR-0002: the DOM
      // never differs per breakpoint, only the arrangement does).
      const dashboard = app!.root.querySelector("#dashboard")!;
      expect(dashboard.classList.contains("dashboard")).toBe(true);

      // The four dashboard areas are each a single grid item off that one DOM.
      expect(app!.root.querySelector(".area-title")).toBeTruthy();
      const timer = app!.root.querySelector("#timer")!;
      expect(timer.classList.contains("area-timer")).toBe(true);
      const boardPanel = app!.root.querySelector(".panel:has(#board)")!;
      expect(boardPanel.classList.contains("area-board")).toBe(true);
      const foundPanel = app!.root.querySelector(".panel:has(#found)")!;
      expect(foundPanel.classList.contains("area-found")).toBe(true);
      const scorePanel = app!.root.querySelector(".panel:has(#players)")!;
      expect(scorePanel.classList.contains("area-score")).toBe(true);

      // The agreed German headings: "Spielfeld" for the board, "Deine
      // Wörter" for the private found-word list.
      expect(boardPanel.querySelector("h2")!.textContent).toBe("Spielfeld");
      expect(foundPanel.querySelector("h2")!.textContent).toBe("Deine Wörter");

      // Same component vocabulary as the lobby: panels wrap found-word chips
      // and player chips alike — a first accepted verdict shows the chip form.
      app!.conn().feed({ type: "word-accepted", word: "HAU", points: 3 });
      expect(app!.root.querySelector("#found .chip.find")).toBeTruthy();
      expect(app!.root.querySelector("#players .chip.player")).toBeTruthy();
    });

    it("a spectator watches board and countdown with no input affordance, the eviction note and the scoreboard", () => {
      window.history.pushState({}, "", "/r/ABC12");
      const deep = mountHarness();
      try {
        deep.root.querySelector<HTMLInputElement>("#jn-nick")!.value = "Ben";
        deep.root.querySelector<HTMLButtonElement>("#jn-btn")!.click();
        deep.conn().feed(
          playingSnapshot({
            code: "ABC12",
            selfSeatId: 2,
            nickname: "Ben",
            role: "spectator",
            board: BOARD,
            players: [
              seat({ seatId: 1, nickname: "Lena" }),
              seat({ seatId: 2, nickname: "Ben", role: "spectator" }),
            ],
          })
        );

        // Board and countdown are the show; the scoreboard is visible.
        expect(deep.root.querySelector("#board")).toBeTruthy();
        expect(deep.root.querySelector("#countdown")!.textContent).toBe("2:00");
        expect(deep.root.querySelector("#players .chip.player")).toBeTruthy();

        // No input affordance: no trace line, no found-words panel.
        expect(deep.root.querySelector("#trace")).toBeNull();
        expect(deep.root.querySelector("#found")).toBeNull();

        // The eviction note stands in the word list's place; Ben's own chip
        // wears the spectator badge.
        expect(deep.root.querySelector(".area-found")!.textContent).toContain(
          "Du schaust zu. Ab der nächsten Runde bist du dabei."
        );
        expect(deep.root.querySelector("#players .chip.player.me")!.textContent).toContain("Zuschauer");

        // Dragging the watched board claims nothing and submits nothing.
        const tiles = tileEls(deep.root);
        synthesizePointerDrag([tiles[0]!, tiles[1]!, tiles[4]!], "mouse");
        expect(deep.conn().sentTypes()).toEqual(["join"]);
        expect(strayTouchMove(tiles[0]!).defaultPrevented).toBe(false);
      } finally {
        deep.unmount();
        window.history.pushState({}, "", "/");
      }
    });
    it("cleans tile notation for display: prefix/suffix markers and either/or variants never leak raw onto the grid", () => {
      driveToRoundOne("LAG4T");
      const NOTATED = ["an-", "-s", "e/ä", "H", "qu", "T", "I", "R", "E", "B", "U", "M", "S", "K", "A", "Z"]; // data keeps its markers; display must not
      app!.conn().feed(roundStarted(NOTATED, 2));
      const shown = tileEls(app!.root)
        .slice(0, 5)
        .map((t) => (t.firstChild?.textContent ?? "").trim()); // tile letters only (the value span rides along)
      expect(shown).toEqual(["an", "s", "e/ä", "H", "qu"]);

      // The input still spells the cleaned letters (trace uses the data).
      const tiles = tileEls(app!.root);
      synthesizePointerDrag([tiles[7]!, tiles[11]!], "mouse"); // R → M (8-way adjacent, both singles)
      expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "RM", reqId: 3 });
    });

    it("shows each tile's points where the index used to be, with German labels and a hover title", () => {
      driveToRoundOne("LAG4T");
      // A digram, prefix, suffix, differing either/or, equal either/or and a
      // plain letter, plus fillers — every value rule on one board (#142).
      const VALUED = [
        "sch",
        "an-",
        "-ung",
        "e/ä",
        "o/u",
        "i/e",
        "e",
        "a",
        "b",
        "c",
        "d",
        "f",
        "g",
        "h",
        "i",
        "j",
      ];
      app!.conn().feed(roundStarted(VALUED, 2));

      const tiles = tileEls(app!.root);
      // The corner value occupies the old index footprint; no indices remain.
      expect(tiles.map((t) => t.querySelector(".pts")?.textContent)).toEqual([
        "7",
        "2",
        "4",
        "1/6",
        "2/1",
        "1",
        "1",
        "1",
        "3",
        "4",
        "1",
        "4",
        "2",
        "2",
        "1",
        "6",
      ]);
      expect(app!.root.querySelector("#board .idx")).toBeNull();

      // The visible number is decorative: the tile's label carries the whole
      // announcement, and the same points phrase is the hover title.
      expect(tiles[0]!.getAttribute("aria-label")).toBe("sch, 7 Punkte");
      expect(tiles[0]!.getAttribute("title")).toBe("7 Punkte");
      expect(tiles[0]!.querySelector(".pts")!.getAttribute("aria-hidden")).toBe("true");
      expect(tiles[6]!.getAttribute("aria-label")).toBe("e, 1 Punkt");
      expect(tiles[6]!.getAttribute("title")).toBe("1 Punkt");
      // Either/or pairs read in letter order; equal values collapse.
      expect(tiles[3]!.getAttribute("aria-label")).toBe("e/ä, 1 oder 6 Punkte");
      expect(tiles[4]!.getAttribute("aria-label")).toBe("o/u, 2 oder 1 Punkte");
      expect(tiles[5]!.getAttribute("aria-label")).toBe("i/e, 1 Punkt");

      // Letters still render as before: notation markers and slashes are
      // display-cleaned only.
      expect(tiles.slice(0, 6).map((t) => t.firstChild?.textContent)).toEqual([
        "sch",
        "an",
        "ung",
        "e/ä",
        "o/u",
        "i/e",
      ]);
    });
  });

  describe("intermission screen (#22)", () => {
    it("the round-end reveal renders grouped by length with per-word points, found-by chips and missed words visible", () => {
      driveToRoundWith("LAG4T", [
        seat({ seatId: 1, nickname: "Lena" }),
        seat({ seatId: 2, nickname: "Ben" }),
      ]);
      app!.conn().feed(roundEnded(1, REVEAL));

      expect(app!.root.querySelector("h1")!.textContent).toBe("Pause");
      expect(app!.root.textContent).toContain("Es zählt das Gesamtergebnis der Sitzung.");
      // The finished board stays on screen (the honest, board-anchored
      // intermission).
      expect(tileEls(app!.root)).toHaveLength(16);

      // Groups ascend by word length; every word carries its points.
      const dts = [...app!.root.querySelectorAll<HTMLElement>("#reveal dt")];
      expect(dts.map((d) => d.textContent)).toEqual(["3 Buchstaben", "4 Buchstaben"]);
      const dd = (dt: Element) => dt.nextElementSibling!;
      const ort = dd(dts[0]!).querySelector(".rw:not(.missed)")!;
      expect(ort.querySelector(".rw-word")!.textContent).toBe("ort");
      expect(ort.querySelector(".rw-pts")!.textContent).toBe("+4");
      // Found-by chips: one per finder, the shared credit spelled out.
      const finders = [...ort.querySelectorAll<HTMLElement>(".fby")].map((c) => c.textContent);
      expect(finders).toEqual(["Lena", "Ben"]);

      // Missed words stay visible — dimmed, chip-free, still listed.
      const missed = dd(dts[1]!).querySelector(".rw.missed")!;
      expect(missed.querySelector(".rw-word")!.textContent).toBe("saat");
      expect(missed.querySelectorAll(".fby")).toHaveLength(0);
      // No first-finder credit beyond the chips: the word itself is naked.
      expect(ort.querySelector(".rw-word")!.textContent).not.toContain("Lena");
    });

    it("the intermission board carries the same tile values, labels and titles as the live board", () => {
      driveToRoundOne("LAG4T");
      const VALUED = [
        "sch",
        "an-",
        "-ung",
        "e/ä",
        "o/u",
        "i/e",
        "e",
        "a",
        "b",
        "c",
        "d",
        "f",
        "g",
        "h",
        "i",
        "j",
      ];
      app!.conn().feed(roundStarted(VALUED, 2));
      const livePoints = tileEls(app!.root).map((t) => t.querySelector(".pts")?.textContent);

      app!.conn().feed(roundEnded(2, REVEAL));

      expect(app!.root.querySelector("h1")!.textContent).toBe("Pause");
      const paused = tileEls(app!.root);
      expect(paused.map((t) => t.querySelector(".pts")?.textContent)).toEqual(livePoints);
      expect(paused.map((t) => t.querySelector(".pts")?.textContent)).toEqual([
        "7",
        "2",
        "4",
        "1/6",
        "2/1",
        "1",
        "1",
        "1",
        "3",
        "4",
        "1",
        "4",
        "2",
        "2",
        "1",
        "6",
      ]);
      expect(app!.root.querySelector("#board .idx")).toBeNull();
      expect(paused[3]!.getAttribute("aria-label")).toBe("e/ä, 1 oder 6 Punkte");
      expect(paused[3]!.getAttribute("title")).toBe("1 oder 6 Punkte");
    });

    it("standings show round and cumulative session score side by side, read by cumulative score", () => {
      driveToRoundWith("LAG4T", [
        seat({ seatId: 1, nickname: "Lena" }),
        seat({ seatId: 2, nickname: "Ben" }),
        seat({ seatId: 3, nickname: "Cem" }),
      ]);
      app!.conn().feed({
        type: "score-update",
        roundNumber: 1,
        scores: [
          { seatId: 2, nickname: "Ben", roundScore: 7, cumulativeScore: 8 },
          { seatId: 1, nickname: "Lena", roundScore: 5, cumulativeScore: 25 },
          { seatId: 3, nickname: "Cem", roundScore: 2, cumulativeScore: 40 },
        ],
      });
      app!.conn().feed(roundEnded(1, REVEAL));

      // Session standings: ordered by cumulative score — Cem leads the
      // session despite Ben winning the round — ties settle by join order.
      const chips = [...app!.root.querySelectorAll<HTMLElement>("#players .chip.player")];
      expect(chips.map((c) => c.querySelector(".nick")!.textContent)).toEqual(["Cem", "Lena", "Ben"]);
      expect(chips.map((c) => c.querySelector(".place")!.textContent)).toEqual(["1", "2", "3"]);
      // Both scores ride one chip, side by side: round first, session total
      // second. Each is its own segment so the chip can break between them.
      expect(chips[0]!.textContent).toContain("Runde 2 P");
      expect(chips[0]!.textContent).toContain("Gesamt 40 P");
      expect(chips[1]!.textContent).toContain("Runde 5 P");
      expect(chips[1]!.textContent).toContain("Gesamt 25 P");
      expect(chips[0]!.querySelector(".round-score")!.textContent).toBe("Runde 2 P");
      expect(chips[0]!.querySelector(".cumulative-score")!.textContent).toBe("Gesamt 40 P");
    });

    it("a long host-and-self standing keeps every segment, including both scores, inside its chip (#154)", () => {
      driveToRoundWith("LAG4T", [
        seat({ seatId: 1, nickname: "Thomas-Maximilian Mustermann", cumulativeScore: 128 }),
        seat({ seatId: 2, nickname: "Anne-Sophie Charlotte", role: "spectator", cumulativeScore: 96 }),
        seat({ seatId: 3, nickname: "Maximilian Alexander", connected: false, cumulativeScore: 84 }),
      ]);
      app!.conn().feed({
        type: "score-update",
        roundNumber: 1,
        scores: [
          { seatId: 1, nickname: "Thomas-Maximilian Mustermann", roundScore: 32, cumulativeScore: 128 },
          { seatId: 2, nickname: "Anne-Sophie Charlotte", roundScore: 21, cumulativeScore: 96 },
          { seatId: 3, nickname: "Maximilian Alexander", roundScore: 8, cumulativeScore: 84 },
        ],
      });
      app!.conn().feed(roundEnded(1, REVEAL));

      const chips = [...app!.root.querySelectorAll<HTMLElement>("#players .chip.player")];
      const [self, spectator, disconnected] = chips;

      // The host is also the viewing player: the own-chip halo and the host
      // badge stay in the same wrapping chip as the long nickname.
      expect(self!.classList.contains("me")).toBe(true);
      expect(self!.classList.contains("session")).toBe(true);
      expect(self!.querySelector(".place")!.textContent).toBe("1");
      expect(self!.querySelector(".nick")!.textContent).toBe("Thomas-Maximilian Mustermann");
      expect(self!.querySelector(".badge.host")!.textContent).toBe("Gastgeber");
      expect(self!.querySelector(".round-score")!.textContent).toBe("Runde 32 P");
      expect(self!.querySelector(".cumulative-score")!.textContent).toBe("Gesamt 128 P");
      expect(self!.querySelector(".dot.on")).not.toBeNull();

      // The separator stays part of the sentence between the two separate
      // score segments: the browser may break there.
      expect(self!.querySelector(".round-score")!.nextElementSibling!.textContent).toBe(" · ");
      expect(self!.querySelector(".cumulative-score")!.previousElementSibling!.textContent).toBe(" · ");
      expect(self!.textContent).toContain("Runde 32 P · Gesamt 128 P");

      // A spectator row and a disconnected row keep their role and
      // connection state in the same wrapped layout.
      expect(spectator!.querySelector(".badge.spec")!.textContent).toBe("Zuschauer");
      expect(spectator!.querySelector(".round-score")!.textContent).toBe("Runde 21 P");
      expect(spectator!.querySelector(".cumulative-score")!.textContent).toBe("Gesamt 96 P");
      expect(disconnected!.querySelector(".dot.off")).not.toBeNull();
      expect(disconnected!.querySelector(".away")!.textContent).toBe("unterbrochen");
      expect(disconnected!.querySelector(".round-score")!.textContent).toBe("Runde 8 P");
      expect(disconnected!.querySelector(".cumulative-score")!.textContent).toBe("Gesamt 84 P");
    });

    it("the host button sends start-round to begin the next round", () => {
      driveToRoundOne("LAG4T");
      app!.conn().feed(roundEnded(1, REVEAL));
      const start = app!.root.querySelector<HTMLButtonElement>("#start-btn")!;
      expect(start.textContent).toBe("Nächste Runde starten");
      start.click();
      expect(app!.conn().sent().at(-1)).toEqual({ type: "start-round", reqId: 3 });
    });

    it("a non-host is told the host starts the next round", () => {
      window.history.pushState({}, "", "/r/LATE5");
      typeInto("#jn-code", "LATE5");
      typeInto("#jn-nick", "Ben");
      click("#jn-btn");
      app!.conn().feed(
        intermissionSnapshot({
          code: "LATE5",
          selfSeatId: 2,
          nickname: "Ben",
          hostSeatId: 1,
          board: BOARD,
          reveal: REVEAL,
        })
      );
      expect(app!.root.querySelector("h1")!.textContent).toBe("Pause");
      expect(app!.root.querySelector("#start-btn")).toBeNull();
      expect(app!.root.querySelector(".next-round-hint")!.textContent).toBe(
        "Der Gastgeber startet die nächste Runde."
      );
    });

    it("marks linked words with a quiet Wiktionary anchor and leaves unlinked words unchanged", () => {
      driveToRoundWith("LAG4T", [
        seat({ seatId: 1, nickname: "Lena" }),
        seat({ seatId: 2, nickname: "Ben" }),
      ]);
      app!.conn().feed(roundEnded(1, REVEAL));
      app!.conn().feed(
        wikiLinks(1, {
          test: "https://de.wiktionary.org/wiki/Test",
          saat: "https://de.wiktionary.org/wiki/Saat",
          fremd: "https://de.wiktionary.org/wiki/Fremd",
        })
      );

      const linked = [...app!.root.querySelectorAll<HTMLAnchorElement>("#reveal .rw-link")];
      expect(linked).toHaveLength(2);
      expect(linked.map((a) => a.textContent)).toEqual(["↗", "↗"]);
      for (const anchor of linked) {
        expect(anchor.getAttribute("target")).toBe("_blank");
        expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
        expect(anchor.getAttribute("aria-label")).toBe("Bei Wiktionary nachschlagen");
        expect(anchor.getAttribute("title")).toBe("Bei Wiktionary nachschlagen");
      }
      expect(linked.map((a) => a.getAttribute("href"))).toEqual([
        "https://de.wiktionary.org/wiki/Saat",
        "https://de.wiktionary.org/wiki/Test",
      ]);

      // A word that resolves nothing renders no element at all; a mapping
      // entry for a word outside the reveal adds nothing anywhere.
      const ort = [...app!.root.querySelectorAll<HTMLElement>("#reveal .rw")].find(
        (r) => r.querySelector(".rw-word")!.textContent === "ort"
      )!;
      expect(ort.querySelector(".rw-link")).toBeNull();
      expect(app!.root.querySelector("#reveal")!.textContent).not.toContain("fremd");

      // The missed word is still dimmed; its link inherits that treatment.
      const missed = app!.root.querySelector("#reveal .rw.missed")!;
      expect(missed.querySelector(".rw-word")!.textContent).toBe("saat");
      expect(missed.querySelector(".rw-link")).toBeTruthy();
    });

    it("links arriving after the reveal patch the rows in place, leaving board and standings untouched", () => {
      driveToRoundWith("LAG4T", [
        seat({ seatId: 1, nickname: "Lena" }),
        seat({ seatId: 2, nickname: "Ben" }),
      ]);
      app!.conn().feed(roundEnded(1, REVEAL));
      const board = app!.root.querySelector("#board");
      const players = app!.root.querySelector("#players");
      const standings = players!.innerHTML;

      app!.conn().feed(wikiLinks(1, { ort: "https://de.wiktionary.org/wiki/Ort" }));

      expect(app!.root.querySelector("#board")).toBe(board);
      expect(app!.root.querySelector("#players")).toBe(players);
      expect(players!.innerHTML).toBe(standings);
      expect(app!.root.querySelectorAll("#reveal .rw-link")).toHaveLength(1);
      expect(app!.root.querySelector("#reveal .rw-link")!.getAttribute("href")).toBe(
        "https://de.wiktionary.org/wiki/Ort"
      );
    });

    it("an intermission snapshot carrying links renders the same anchors", () => {
      const links = { ort: "https://de.wiktionary.org/wiki/Ort" };
      window.history.pushState({}, "", "/r/SPAT7");
      typeInto("#jn-code", "SPAT7");
      typeInto("#jn-nick", "Ben");
      click("#jn-btn");
      app!.conn().feed(
        intermissionSnapshot({
          code: "SPAT7",
          selfSeatId: 2,
          nickname: "Ben",
          hostSeatId: 1,
          board: BOARD,
          reveal: REVEAL,
          links,
        })
      );

      const anchors = [...app!.root.querySelectorAll<HTMLAnchorElement>("#reveal .rw-link")];
      expect(anchors).toHaveLength(1);
      expect(anchors[0]!.getAttribute("href")).toBe(links.ort);
    });

    it("shows no countdown on the pause screen — the break is not on a timer", () => {
      driveToRoundOne("LAG4T");
      app!.conn().feed(roundEnded(1, REVEAL));

      expect(app!.root.querySelector("#timer")).toBeNull();
      expect(app!.root.querySelector("#countdown")).toBeNull();
      // The finished board, reveal and standings stay visible for as long as
      // the host holds the pause open.
      expect(tileEls(app!.root)).toHaveLength(16);
      expect(app!.root.querySelector("#reveal")!.textContent).toContain("ort");
      // Even a late tick cannot conjure a countdown back onto the pause.
      app!.conn().feed(tick(12_000));
      expect(app!.root.querySelector("#countdown")).toBeNull();
      expect(app!.root.querySelector("#players")).not.toBeNull();
    });

    it("a reconnecting client lands in the same clockless pause", () => {
      window.history.pushState({}, "", "/r/SPAT7");
      typeInto("#jn-code", "SPAT7");
      typeInto("#jn-nick", "Ben");
      click("#jn-btn");
      app!.conn().feed(
        intermissionSnapshot({
          code: "SPAT7",
          selfSeatId: 2,
          nickname: "Ben",
          hostSeatId: 1,
          board: BOARD,
          reveal: REVEAL,
        })
      );

      expect(app!.root.querySelector("h1")!.textContent).toBe("Pause");
      expect(app!.root.querySelector("#countdown")).toBeNull();
      expect(tileEls(app!.root)).toHaveLength(16);
    });

    it("a snapshot during the intermission renders the same reveal the round-end delta carried", () => {
      driveToRoundWith("LAG4T", [
        seat({ seatId: 1, nickname: "Lena" }),
        seat({ seatId: 2, nickname: "Ben" }),
      ]);
      app!.conn().feed(roundEnded(1, REVEAL));
      const fromRoundEnd = revealText(app!.root);

      // A late joiner arrives through the join panel, per snapshot.
      window.history.pushState({}, "", "/r/SPAT7");
      app!.unmount();
      app = mountHarness();
      app!.root.querySelector<HTMLInputElement>("#jn-nick")!.value = "Ben";
      app!.root.querySelector<HTMLButtonElement>("#jn-btn")!.click();
      app!.conn().feed(
        intermissionSnapshot({
          code: "SPAT7",
          selfSeatId: 2,
          nickname: "Ben",
          hostSeatId: 1,
          board: BOARD,
          reveal: REVEAL,
        })
      );
      expect(revealText(app!.root)).toEqual(fromRoundEnd);
    });
  });

  describe("live regions (#122)", () => {
    it("a play-time delta refreshes the intermission's declared regions — countdown and session standings — in place", () => {
      driveToRoundWith("LAG4T", [
        seat({ seatId: 1, nickname: "Lena" }),
        seat({ seatId: 2, nickname: "Ben" }),
        seat({ seatId: 3, nickname: "Cem" }),
      ]);
      app!.conn().feed(roundEnded(1, REVEAL));

      const players = app!.root.querySelector("#players")!;
      // The pause declares neither a countdown nor private found-word chips.
      expect(app!.root.querySelector("#timer")).toBeNull();
      expect(app!.root.querySelector("#found")).toBeNull();

      // A score-update re-ranks the session standings in place — by
      // cumulative score, the intermission's designated mode — without
      // replacing the list element.
      app!.conn().feed({
        type: "score-update",
        roundNumber: 1,
        scores: [
          { seatId: 2, nickname: "Ben", roundScore: 7, cumulativeScore: 60 },
          { seatId: 1, nickname: "Lena", roundScore: 5, cumulativeScore: 25 },
          { seatId: 3, nickname: "Cem", roundScore: 2, cumulativeScore: 40 },
        ],
      });
      expect(app!.root.querySelector("#players")).toBe(players);
      const chips = [...app!.root.querySelectorAll<HTMLElement>("#players .chip.player")];
      expect(chips.map((c) => c.querySelector(".nick")!.textContent)).toEqual(["Ben", "Cem", "Lena"]);
      expect(chips.map((c) => c.querySelector(".place")!.textContent)).toEqual(["1", "2", "3"]);
      expect(chips[0]!.textContent).toContain("Runde 7 P");
      expect(chips[0]!.textContent).toContain("Gesamt 60 P");
      // The in-place rewrite keeps the two score segments separately
      // addressable, so the wrapped layout cannot be flattened by an update.
      expect(chips[0]!.querySelector(".round-score")!.textContent).toBe("Runde 7 P");
      expect(chips[0]!.querySelector(".cumulative-score")!.textContent).toBe("Gesamt 60 P");
      expect(chips[0]!.classList.contains("session")).toBe(true);
    });

    it("a spectator's game screen skips the declared found region it does not render", () => {
      window.history.pushState({}, "", "/r/ABC12");
      const deep = mountHarness();
      try {
        deep.root.querySelector<HTMLInputElement>("#jn-nick")!.value = "Ben";
        deep.root.querySelector<HTMLButtonElement>("#jn-btn")!.click();
        deep.conn().feed(
          playingSnapshot({
            code: "ABC12",
            selfSeatId: 2,
            nickname: "Ben",
            role: "spectator",
            board: BOARD,
            players: [
              seat({ seatId: 1, nickname: "Lena" }),
              seat({ seatId: 2, nickname: "Ben", role: "spectator" }),
            ],
          })
        );
        const timer = deep.root.querySelector("#timer");
        const players = deep.root.querySelector("#players");
        expect(deep.root.querySelector("#found")).toBeNull();

        // The tick still refreshes the two regions this screen renders in
        // place; the absent found region is skipped without error.
        deep.conn().feed(tick(90_000));
        expect(deep.root.querySelector("#timer")).toBe(timer);
        expect(deep.root.querySelector("#players")).toBe(players);
        expect(deep.root.querySelector("#countdown")!.textContent).toBe("1:30");
      } finally {
        deep.unmount();
        window.history.pushState({}, "", "/");
      }
    });
  });

  it("a connection close with no server frame shows the connection-lost outcome screen", () => {
    driveToRoundOne("LAG4T");
    // An orderly transport close that carried no end frame is one close
    // outcome — not a separate closed status racing a later frame.
    app!.conn().abruptClose();
    expect(app!.root.querySelector("h1")!.textContent).toBe("Verbindung beendet.");
    expect(app!.conn().statuses).toEqual(["connecting", "open"]);
    expect(app!.conn().closeOutcomes).toEqual([{ kind: "connection-lost" }]);
    // The real action returns to the home screen.
    app!.root.querySelector<HTMLButtonElement>("#home-btn")!.click();
    expect(app!.root.querySelector("h1")!.textContent).toBe("Wortschatz");
  });

  it("routes home → lobby → game, fed by snapshot and deltas, through the scripted connection", () => {
    // Home: the mounted app renders its first screen.
    expect(app!.root.querySelector("h1")!.textContent).toBe("Wortschatz");

    // Creating a room goes out on the boundary as the connection greets.
    typeInto("#mk-nick", "Lena");
    click("#mk-btn");
    expect(app!.connections()).toHaveLength(1);
    expect(app!.conn().sent()).toEqual([{ type: "create-room", nickname: "Lena", reqId: 1 }]);
    expect(app!.conn().statuses).toEqual(["connecting"]);
    // Nothing but the Create screen until the server's first word.
    expect(app!.root.querySelector("h1")!.textContent).toBe("Raum erstellen");

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
    expect(app!.root.textContent).toContain("2 von 8 verbunden");

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
    expect(tiles.map((t) => t.firstChild?.textContent)).toEqual(BOARD);
    // Points replaced the old 0–15 indices everywhere.
    expect(app!.root.querySelector("#board .idx")).toBeNull();

    // Playing is drag-only: the typed input is gone.
    expect(app!.root.querySelector("#word-input")).toBeNull();
    expect(app!.root.querySelector("#word-form")).toBeNull();
  });

  it("renders the drag surface idle and sizes board fonts on the grid container", () => {
    driveToRoundOne("LAG4T");
    // Idle trace shows the hint that explains dragging.
    const trace = app!.root.querySelector<HTMLElement>("#trace")!;
    expect(trace.classList.contains("hint")).toBe(true);
    expect(trace.textContent).toContain("Wische über die Felder");

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
      expect(deep.root.querySelector<HTMLInputElement>("#jn-code")!.readOnly).toBe(true);
      expect(deep.root.querySelector(".panel .note")!.textContent).toBe(
        "Du wurdest in Raum ABC12 eingeladen."
      );
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

  describe("out-of-room screens (#21)", () => {
    it("being kicked shows the dedicated outcome screen with a real action back home", () => {
      driveToRoundOne("LAG4T");
      app!.conn().feed({ type: "kicked" });
      // The connection reports one close outcome after the frame reached
      // the app, so the kicked screen wins without depending on callback
      // order.
      expect(app!.conn().closeOutcomes).toEqual([{ kind: "kicked" }]);
      expect(app!.root.querySelector("h1")!.textContent).toBe("Du wurdest aus dem Raum LAG4T entfernt.");
      // No "Wie geht es weiter?" heading: the note speaks for itself.
      expect(app!.root.textContent).not.toContain("Wie geht es weiter?");
      expect(app!.root.querySelector(".panel .note")!.textContent).toBe(
        "Der Gastgeber hat dich aus dem Raum entfernt. Du kannst einen neuen Raum erstellen oder einem anderen beitreten."
      );
      expect(app!.root.querySelector("#home-btn")).toBeTruthy();
      expect(app!.conn().stopped).toBe(true);
      app!.root.querySelector<HTMLButtonElement>("#home-btn")!.click();
      expect(app!.root.querySelector("h1")!.textContent).toBe("Wortschatz");
    });

    it("a host-closed room shows the dedicated ended screen", () => {
      driveToRoundOne("LAG4T");
      app!.conn().feed({ type: "room-ended", reason: "host-closed" });
      expect(app!.conn().closeOutcomes).toEqual([{ kind: "room-ended", reason: "host-closed" }]);
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum LAG4T wurde beendet.");
      app!.root.querySelector<HTMLButtonElement>("#home-btn")!.click();
      expect(app!.root.querySelector("h1")!.textContent).toBe("Wortschatz");
    });

    it("an expired room ends with its own dedicated screen", () => {
      driveToRoundOne("LAG4T");
      app!.conn().feed({ type: "room-ended", reason: "expired" });
      expect(app!.conn().closeOutcomes).toEqual([{ kind: "room-ended", reason: "expired" }]);
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum LAG4T ist abgelaufen.");
      // Same real action as every outcome screen: back to the home screen.
      app!.root.querySelector<HTMLButtonElement>("#home-btn")!.click();
      expect(app!.root.querySelector("h1")!.textContent).toBe("Wortschatz");
    });

    it("a wrong room code surfaces the generic not-found outcome screen", () => {
      typeInto("#jn-code", "ZZZ99");
      typeInto("#jn-nick", "Ben");
      click("#jn-btn");
      expect(app!.conn().sent()).toEqual([{ type: "join", code: "ZZZ99", nickname: "Ben", reqId: 1 }]);
      app!.conn().feed({ type: "error", code: "room-not-found", message: "ZZZ99" });
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum ZZZ99 nicht gefunden oder abgelaufen.");
      app!.root.querySelector<HTMLButtonElement>("#home-btn")!.click();
      expect(app!.root.querySelector("h1")!.textContent).toBe("Wortschatz");
    });

    it("a deep link lands pre-filled with the code and the remembered nickname for instant joining", () => {
      // One full flow saves the remembered session for this room code.
      typeInto("#mk-nick", "Lena");
      click("#mk-btn");
      app!.conn().feed(lobbySnapshot({ code: "XQ7F2", nickname: "Lena" }));
      app!.unmount();
      window.history.pushState({}, "", "/r/xq7f2");
      const deep = mountHarness();
      try {
        expect(deep.root.querySelector<HTMLInputElement>("#jn-code")!.value).toBe("XQ7F2");
        expect(deep.root.querySelector<HTMLInputElement>("#jn-nick")!.value).toBe("Lena");
        // The join invitation is announced in the join panel.
        expect(deep.root.querySelector(".panel .note")!.textContent).toContain(
          "Du wurdest in Raum XQ7F2 eingeladen"
        );
        // One click joins — through the remembered session token.
        deep.root.querySelector<HTMLButtonElement>("#jn-btn")!.click();
        expect(deep.conn().sent()).toEqual([
          { type: "join", code: "XQ7F2", nickname: "Lena", token: "t-1", reqId: 1 },
        ]);
      } finally {
        deep.unmount();
        window.history.pushState({}, "", "/");
      }
    });
  });

  describe("greeting rejection (#49)", () => {
    // Greeting rejections must be tested without a remembered session, or
    // the greet would reclaim a leftover seat instead of the typed name.
    beforeEach(() => localStorage.clear());

    it("a taken nickname returns to the join screen with the German copy and the typed inputs intact", () => {
      typeInto("#jn-code", "ABC12");
      typeInto("#jn-nick", "Anja");
      click("#jn-btn");
      expect(app!.conn().sent()).toEqual([{ type: "join", code: "ABC12", nickname: "Anja", reqId: 1 }]);

      app!.conn().feed({ type: "error", code: "nickname-taken" });

      // A usable Join screen — never the connection-lost outcome or any
      // room screen, even though the join was answered.
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum beitreten");
      expect(app!.root.querySelector("#jn-btn")).toBeTruthy();
      expect(app!.root.querySelector("#board")).toBeNull();
      expect(app!.root.querySelector("#players")).toBeNull();
      expect(app!.root.textContent).not.toContain("Verbindung beendet.");

      // The shared German copy lands in the floating error slot; no inline
      // error paragraph competes with it.
      expect(noticeText(app!.root, "error")).toBe("Dieser Name ist bereits vergeben. Wähle einen anderen.");
      expect(app!.root.querySelector("#home-errors")).toBeNull();

      // The typed code and name survive for a corrected retry, and the
      // address bar never claims the room.
      expect(app!.root.querySelector<HTMLInputElement>("#jn-code")!.value).toBe("ABC12");
      expect(app!.root.querySelector<HTMLInputElement>("#jn-nick")!.value).toBe("Anja");
      expect(window.location.pathname).toBe("/");

      // The rejected connection is stopped, not left open.
      expect(app!.conn().stopped).toBe(true);
      expect(app!.conn().statuses).toEqual(["connecting"]);
    });

    it("a full room surfaces its German copy on the join screen", () => {
      typeInto("#jn-code", "ABC12");
      typeInto("#jn-nick", "Anja");
      click("#jn-btn");
      app!.conn().feed({ type: "error", code: "room-full" });
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum beitreten");
      expect(noticeText(app!.root, "error")).toBe("Der Raum ist voll (max. 8 Spieler).");
      expect(app!.root.querySelector("#board")).toBeNull();
      expect(app!.conn().stopped).toBe(true);
    });

    it("a malformed greeting surfaces its German copy on the join screen", () => {
      typeInto("#jn-code", "ABC12");
      typeInto("#jn-nick", "Anja");
      click("#jn-btn");
      app!.conn().feed({ type: "error", code: "invalid-message" });
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum beitreten");
      expect(noticeText(app!.root, "error")).toBe("Ungültige Nachricht.");
      expect(app!.root.querySelector("#board")).toBeNull();
      expect(app!.conn().stopped).toBe(true);
    });

    it("retrying after a rejection sends exactly one new join and clears the old error", () => {
      typeInto("#jn-code", "ABC12");
      typeInto("#jn-nick", "Anja");
      click("#jn-btn");
      app!.conn().feed({ type: "error", code: "nickname-taken" });
      expect(app!.conn().stopped).toBe(true);
      expect(noticeText(app!.root, "error")).not.toBe("");

      // Correct the name and retry: one fresh connection with one greeting,
      // and the previous error is gone.
      typeInto("#jn-nick", "Ben");
      click("#jn-btn");
      expect(app!.connections()).toHaveLength(2);
      expect(app!.conn().sent()).toEqual([{ type: "join", code: "ABC12", nickname: "Ben", reqId: 1 }]);
      expect(noticeText(app!.root, "error")).toBe("");

      // The fresh attempt still reaches a room on the confirming snapshot.
      app!.conn().feed(lobbySnapshot({ code: "ABC12", nickname: "Ben" }));
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum ABC12");
    });
  });

  describe("floating notifications (#146)", () => {
    it("owns one layer outside the screen that survives a rebuild and a screen transition", () => {
      typeInto("#mk-nick", "Lena");
      click("#mk-btn");
      app!.conn().feed(lobbySnapshot({ code: "LAG4T", nickname: "Lena" }));
      const layer = app!.root.querySelector("#notifications")!;
      const status = app!.root.querySelector("#notice-status")!;
      const error = app!.root.querySelector("#notice-error")!;

      // A structural re-render replaces the lobby markup…
      app!.conn().feed(playerJoined(2, "Ben"));
      expect(app!.root.querySelector("#notifications")).toBe(layer);
      expect(app!.root.querySelector("#notice-status")).toBe(status);
      expect(app!.root.querySelector("#notice-error")).toBe(error);

      // …and a screen transition replaces it again, with the layer intact.
      app!.conn().feed(roundStarted(BOARD));
      expect(app!.root.querySelector("#notifications")).toBe(layer);
      expect(app!.root.querySelector("#notice-status")).toBe(status);
      expect(app!.root.querySelector("#notice-error")).toBe(error);
    });

    it("shows nothing on the idle start screen", () => {
      expect(app!.root.querySelector("h1")!.textContent).toBe("Wortschatz");
      expect(notices(app!.root)).toEqual([]);
      expect(noticeText(app!.root, "status")).toBe("");
      expect(noticeText(app!.root, "error")).toBe("");
    });

    it("shows the connection status on the start screen while a room attempt is in flight, then clears it when open", () => {
      typeInto("#mk-nick", "Lena");
      click("#mk-btn");

      // The Create screen stays put, and the status is visible exactly where
      // the player first waits for the connection.
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum erstellen");
      expect(noticeText(app!.root, "status")).toBe("Verbinde …");

      app!.conn().feed(lobbySnapshot({ code: "LAG4T", nickname: "Lena" }));
      expect(noticeText(app!.root, "status")).toBe("");
    });

    it("renders connection status and an error together, status first", () => {
      driveToRoundOne("LAG4T");
      app!.conn().feed({ type: "error", code: "word-duplicate", message: "HAU" });
      app!.conn().retry();

      const shown = notices(app!.root);
      expect(shown.map((n) => n.id)).toEqual(["notice-status", "notice-error"]);
      expect(shown.map((n) => n.textContent)).toEqual([
        "Verbindung wird wiederhergestellt …",
        "Das Wort hast du schon.",
      ]);
    });

    it("marks the status slot polite and the error slot assertive", () => {
      const status = app!.root.querySelector("#notice-status")!;
      const error = app!.root.querySelector("#notice-error")!;
      expect(status.getAttribute("role")).toBe("status");
      expect(status.getAttribute("aria-live")).toBe("polite");
      expect(error.getAttribute("role")).toBe("alert");
      expect(error.getAttribute("aria-live")).toBe("assertive");
      // Messages are text, not focusable elements.
      expect(status.getAttribute("tabindex")).toBeNull();
      expect(error.getAttribute("tabindex")).toBeNull();
    });

    it("replaces a repeated identical error in place instead of stacking notices", () => {
      driveToRoundOne("LAG4T");
      const slot = app!.root.querySelector("#notice-error")!;
      app!.conn().feed({ type: "error", code: "word-duplicate", message: "HAU" });
      app!.conn().feed({ type: "error", code: "word-duplicate", message: "HAU" });

      expect(app!.root.querySelector("#notice-error")).toBe(slot);
      expect(notices(app!.root)).toHaveLength(1);
      expect(notices(app!.root)[0]!.textContent).toBe("Das Wort hast du schon.");
    });

    it("keeps a notice through play-time and structural re-renders while its situation is unchanged", () => {
      driveToRoundOne("LAG4T");
      app!.conn().feed({ type: "error", code: "invalid-word" });
      expect(noticeText(app!.root, "error")).toBe("Kein gültiges Wort.");

      // A play-time tick updates live regions in place…
      app!.conn().feed(tick(90_000));
      expect(noticeText(app!.root, "error")).toBe("Kein gültiges Wort.");

      // …and a structural roster change rebuilds the screen: the layer and
      // its message are outside that rebuild.
      app!.conn().feed(playerJoined(2, "Ben"));
      expect(app!.root.querySelector("h1")!.textContent).toContain("Runde 1");
      expect(noticeText(app!.root, "error")).toBe("Kein gültiges Wort.");
    });

    it("drops an error when the phase changes", () => {
      driveToRoundOne("LAG4T");
      app!.conn().feed({ type: "error", code: "word-duplicate", message: "HAU" });
      expect(noticeText(app!.root, "error")).toBe("Das Wort hast du schon.");

      app!.conn().feed(roundEnded(1, REVEAL));
      expect(app!.root.querySelector("h1")!.textContent).toBe("Pause");
      expect(noticeText(app!.root, "error")).toBe("");
      expect(notices(app!.root)).toEqual([]);
    });

    it("clears an error on the next submit", () => {
      driveToRoundOne("LAG4T");
      app!.conn().feed({ type: "error", code: "invalid-word" });
      expect(noticeText(app!.root, "error")).toBe("Kein gültiges Wort.");

      synthesizePointerDrag([tileEls(app!.root)[0]!, tileEls(app!.root)[1]!]);
      expect(noticeText(app!.root, "error")).toBe("");
    });

    it("shows a rejected round start in the layer, not beside the start button", () => {
      typeInto("#mk-nick", "Lena");
      click("#mk-btn");
      app!.conn().feed(lobbySnapshot({ code: "LAG4T", nickname: "Lena" }));

      click("#start-btn");
      app!.conn().feed({ type: "error", code: "invalid-phase" });
      expect(app!.root.querySelector("#start-hint")).toBeNull();
      expect(noticeText(app!.root, "error")).toBe("Das geht gerade nicht.");

      // A new start attempt addresses the old rejection at once.
      click("#start-btn");
      expect(noticeText(app!.root, "error")).toBe("");
    });

    it.each([
      ["invalid-word", "Kein gültiges Wort."],
      ["round-over", "Die Runde ist bereits vorbei."],
      ["rate-limited", "Zu viele Nachrichten."],
      ["not-playing", "Du spielst in dieser Runde nicht."],
    ])("renders the shared German copy for %s in the error slot", (code, copy) => {
      driveToRoundOne("LAG4T");
      app!.conn().feed({ type: "error", code: code as ErrorCode });
      expect(noticeText(app!.root, "error")).toBe(copy);
    });
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
    expect(traceSeen).toEqual(["H", "HA", "HAT", "Wische über die Felder, um ein Wort zu bilden."]);
    const trace = app!.root.querySelector("#trace")!;
    expect(trace.classList.contains("hint")).toBe(true);

    // Release submits the traced string through the boundary, reqId next.
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HAT", reqId: 3 });

    // The synchronous verdict lands as a private chip with its points —
    // immediately, before any broadcast scoreboard update.
    expect(noticeText(app!.root, "error")).toBe("");
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
    expect(traceSeen).toEqual(["H", "HA", "H", "HT", "Wische über die Felder, um ein Wort zu bilden."]);
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HT", reqId: 3 });
  });

  it("a fast swipe that skips a tile still selects the skipped tile", () => {
    driveToRoundOne("LAG4T");
    const tiles = tileEls(app!.root);
    // H (row 0, col 0) → U (row 0, col 2): the browser delivered no sample
    // for the A between them, so the gap is bridged and A is selected too.
    const traceSeen: string[] = [];
    synthesizePointerDrag([tiles[0]!, tiles[2]!], "mouse", () => {
      traceSeen.push(app!.root.querySelector("#trace")!.textContent!);
    });
    expect(traceSeen).toEqual(["H", "HAU", "Wische über die Felder, um ein Wort zu bilden."]);
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HAU", reqId: 3 });
  });

  it("a touch fast swipe bridges the same gap", () => {
    driveToRoundOne("LAG4T");
    const tiles = tileEls(app!.root);
    // Same sparse sample delivered through the touch stream, as a phone does.
    const traceSeen: string[] = [];
    synthesizeTouchDrag([tiles[0]!, tiles[2]!], () => {
      traceSeen.push(app!.root.querySelector("#trace")!.textContent!);
    });
    expect(traceSeen).toEqual(["H", "HAU", "Wische über die Felder, um ein Wort zu bilden."]);
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HAU", reqId: 3 });
  });

  it("walks an 8-way stair-step path to a sample two or more tiles away", () => {
    driveToRoundOne("LAG4T");
    const tiles = tileEls(app!.root);
    // H (0,0) → M (2,2): diagonal to I (1,1), then diagonal to M (2,2).
    const diagonal: string[] = [];
    synthesizePointerDrag([tiles[0]!, tiles[10]!], "mouse", () => {
      diagonal.push(app!.root.querySelector("#trace")!.textContent!);
    });
    expect(diagonal).toEqual(["H", "HIM", "Wische über die Felder, um ein Wort zu bilden."]);
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HIM", reqId: 3 });

    // H (0,0) → A (3,1): diagonal until the row matches, then straight down.
    const stepped: string[] = [];
    synthesizePointerDrag([tiles[0]!, tiles[13]!], "mouse", () => {
      stepped.push(app!.root.querySelector("#trace")!.textContent!);
    });
    expect(stepped).toEqual(["H", "HIUA", "Wische über die Felder, um ein Wort zu bilden."]);
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HIUA", reqId: 4 });
  });

  it("rejects a bridged sample that would reuse a tile", () => {
    driveToRoundOne("LAG4T");
    const tiles = tileEls(app!.root);
    // H → A → U, then a jump back to H: the bridge would cross A and H,
    // both already selected, so the trace stays the valid path "HAU".
    const traceSeen: string[] = [];
    synthesizePointerDrag([tiles[0]!, tiles[1]!, tiles[2]!, tiles[0]!], "mouse", () => {
      traceSeen.push(app!.root.querySelector("#trace")!.textContent!);
    });
    expect(traceSeen).toEqual(["H", "HA", "HAU", "HAU", "Wische über die Felder, um ein Wort zu bilden."]);
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HAU", reqId: 3 });
  });

  it("a resubmitted word surfaces the word-duplicate error and adds nothing", () => {
    driveToRoundOne("LAG4T");
    const tiles = tileEls(app!.root);
    synthesizePointerDrag([tiles[0]!, tiles[1]!, tiles[2]!]); // HAU
    app!.conn().feed({ type: "word-accepted", word: "HAU", points: 3 });
    expect(app!.root.querySelectorAll("#found li")).toHaveLength(1);

    // Same swipe again: the server verdict is word-duplicate; the floating
    // error slot carries the existing German copy, the chips unchanged.
    synthesizePointerDrag([tiles[0]!, tiles[1]!, tiles[2]!]);
    app!.conn().feed({ type: "error", code: "word-duplicate", message: "HAU" });
    expect(noticeText(app!.root, "error")).toBe("Das Wort hast du schon.");
    expect(app!.root.querySelector("#error")).toBeNull();
    expect(app!.root.querySelectorAll("#found li")).toHaveLength(1);
  });

  it("the lobby lets a solo host start round one", () => {
    typeInto("#mk-nick", "Lena");
    click("#mk-btn");
    app!.conn().feed(lobbySnapshot({ code: "LAG4T", nickname: "Lena" }));

    click("#start-btn");
    expect(app!.conn().sent().at(-1)).toEqual({ type: "start-round", reqId: 2 });
  });

  it("the taken-name error calls the conflict a Name, not a Spitzname", () => {
    driveToRoundOne("LAG4T");
    // Every catalog entry renders through the one error slot (#50's
    // copy-testing seam), so the taken-name wording is covered too.
    app!.conn().feed({ type: "error", code: "nickname-taken" });
    const error = noticeText(app!.root, "error");
    expect(error).toBe("Dieser Name ist bereits vergeben. Wähle einen anderen.");
    expect(error).not.toContain("Spitzname");
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

  describe("one gesture across pointer and touch streams (#97)", () => {
    /** The H → A → T tiles of the shared BOARD, all 8-way adjacent. */
    function hatTiles(): [HTMLElement, HTMLElement, HTMLElement] {
      const tiles = tileEls(app!.root);
      return [tiles[0]!, tiles[1]!, tiles[4]!];
    }

    it("a pointerdown drag continues through touchmove (Firefox for Android)", () => {
      driveToRoundOne("LAG4T");
      const [h, a, t] = hatTiles();
      const traceSeen: string[] = [];
      const seen = () => traceSeen.push(app!.root.querySelector("#trace")!.textContent!);

      // The browser commits to a pointer drag, then delivers the movement
      // only as touch events.
      firePointerEvent(h, "pointerdown", { pointerType: "touch" });
      seen();
      fireTouchEvent(h, "touchstart", { to: h });
      fireTouchEvent(h, "touchmove", { to: a });
      seen();
      fireTouchEvent(h, "touchmove", { to: t });
      seen();
      fireTouchEvent(h, "touchend", { to: t });
      seen();

      expect(traceSeen).toEqual(["H", "HA", "HAT", "Wische über die Felder, um ein Wort zu bilden."]);
      expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HAT", reqId: 3 });
    });

    it("counts a move carried by both streams once and submits a single frame", () => {
      driveToRoundOne("LAG4T");
      const [h, a, t] = hatTiles();
      firePointerEvent(h, "pointerdown", { pointerType: "touch" });
      fireTouchEvent(h, "touchstart", { to: h });

      // The same H → A move arrives over the pointer stream, then again over
      // touch: the tile is added once and the trace never repeats it.
      firePointerEvent(a, "pointermove", { pointerType: "touch" });
      fireTouchEvent(h, "touchmove", { to: a });
      expect(app!.root.querySelector("#trace")!.textContent).toBe("HA");
      firePointerEvent(t, "pointermove", { pointerType: "touch" });
      fireTouchEvent(h, "touchmove", { to: t });
      expect(app!.root.querySelector("#trace")!.textContent).toBe("HAT");

      // Both streams then report the release of the same finger.
      firePointerEvent(t, "pointerup", { pointerType: "touch" });
      fireTouchEvent(h, "touchend", { to: t });

      const submits = app!
        .conn()
        .sent()
        .filter((m) => m.type === "submit-word");
      expect(submits).toEqual([{ type: "submit-word", word: "HAT", reqId: 3 }]);
    });

    it("a pointercancel does not discard a word the touch stream keeps building", () => {
      driveToRoundOne("LAG4T");
      const [h, a, t] = hatTiles();
      firePointerEvent(h, "pointerdown", { pointerType: "touch" });
      fireTouchEvent(h, "touchstart", { to: h });
      firePointerEvent(a, "pointermove", { pointerType: "touch" });

      // The browser cancels the pointer stream, but the same finger keeps
      // moving over touch: the gesture survives.
      firePointerEvent(a, "pointercancel", { pointerType: "touch" });
      fireTouchEvent(h, "touchmove", { to: t });
      expect(app!.root.querySelector("#trace")!.textContent).toBe("HAT");
      fireTouchEvent(h, "touchend", { to: t });
      expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HAT", reqId: 3 });
    });

    it("a mouse pointercancel ends the gesture without submitting", () => {
      driveToRoundOne("LAG4T");
      const [h, a] = hatTiles();
      firePointerEvent(h, "pointerdown", { pointerType: "mouse" });
      firePointerEvent(a, "pointermove", { pointerType: "mouse" });
      // No touch fallback: the interrupted gesture clears without a word.
      firePointerEvent(a, "pointercancel", { pointerType: "mouse" });
      expect(app!.conn().sentTypes()).toEqual(["create-room", "start-round"]);
      expect(app!.root.querySelector("#trace")!.textContent).toBe(
        "Wische über die Felder, um ein Wort zu bilden."
      );
    });

    it("touchcancel ends the gesture without submitting", () => {
      driveToRoundOne("LAG4T");
      const [h, a] = hatTiles();
      fireTouchEvent(h, "touchstart", { to: h });
      fireTouchEvent(h, "touchmove", { to: a });
      fireTouchEvent(h, "touchcancel", { to: a });
      expect(app!.conn().sentTypes()).toEqual(["create-room", "start-round"]);
      expect(app!.root.querySelector("#trace")!.textContent).toBe(
        "Wische über die Felder, um ein Wort zu bilden."
      );
    });

    it("a touch-only stream traces and submits (regression replay)", () => {
      driveToRoundOne("LAG4T");
      const [h, a, t] = hatTiles();
      // No pointer events at all: the browser delivers only touch.
      fireTouchEvent(h, "touchstart", { to: h });
      fireTouchEvent(h, "touchmove", { to: a });
      expect(app!.root.querySelector("#trace")!.textContent).toBe("HA");
      fireTouchEvent(h, "touchmove", { to: t });
      fireTouchEvent(h, "touchend", { to: t });
      expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HAT", reqId: 3 });
    });

    it("a single tap submits the tile's one-letter word", () => {
      driveToRoundOne("LAG4T");
      const [h] = hatTiles();
      firePointerEvent(h, "pointerdown", { pointerType: "touch" });
      fireTouchEvent(h, "touchstart", { to: h });
      firePointerEvent(h, "pointerup", { pointerType: "touch" });
      fireTouchEvent(h, "touchend", { to: h });
      // One tap, one release across both streams, one letter.
      expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "H", reqId: 3 });
    });
  });

  describe("explicit drag samples and synthetic tile rects (#102)", () => {
    /** The shared BOARD: tile 0=H, 1=A, 5=I, 10=M, 15=Z. */
    function tiles(): HTMLElement[] {
      return tileEls(app!.root);
    }

    it("fires one pointer move at an explicit point, not just a tile centre", () => {
      driveToRoundOne("LAG4T");
      const board = tiles();
      // A sample clearly inside A's top-left corner, away from its centre
      // (past the board-gap margin that #103 requires for a clear hit).
      const box = board[1]!.getBoundingClientRect();
      const at = { x: box.left + 8, y: box.top + 8 };
      const seen: { x: number; y: number }[] = [];
      document.addEventListener("pointermove", (ev) => seen.push({ x: ev.clientX, y: ev.clientY }), {
        once: true,
      });

      firePointerEvent(board[0]!, "pointerdown", { pointerType: "mouse" });
      firePointerEvent(board[0]!, "pointermove", { pointerType: "mouse", at });

      expect(seen).toEqual([at]);
      expect(app!.root.querySelector("#trace")!.textContent).toBe("HA");
    });

    it("fires one touch move at an explicit point, not just a tile centre", () => {
      driveToRoundOne("LAG4T");
      const board = tiles();
      const box = board[1]!.getBoundingClientRect();
      const at = { x: box.left + 8, y: box.top + 8 };
      const seen: { x: number; y: number }[] = [];
      document.addEventListener(
        "touchmove",
        (ev) => seen.push({ x: ev.changedTouches[0]!.clientX, y: ev.changedTouches[0]!.clientY }),
        { once: true }
      );

      fireTouchEvent(board[0]!, "touchstart", { to: board[0]! });
      fireTouchEvent(board[0]!, "touchmove", { at });

      expect(seen).toEqual([at]);
      expect(app!.root.querySelector("#trace")!.textContent).toBe("HA");
    });

    it("answers board tile rects from the same synthetic grid as the hit-test", () => {
      driveToRoundOne("LAG4T");
      const board = tiles();

      // 40px cells with 4px gaps, row-major: tile 0 at the origin, tile 5
      // one cell right and one down.
      const first = board[0]!.getBoundingClientRect();
      expect([first.left, first.top, first.right, first.bottom]).toEqual([0, 0, 40, 40]);
      const middle = board[5]!.getBoundingClientRect();
      expect([middle.left, middle.top, middle.right, middle.bottom]).toEqual([44, 44, 84, 84]);

      // The point→tile hit-test agrees with the rects, at centres and edges.
      for (const idx of [0, 5, 10, 15]) {
        const box = board[idx]!.getBoundingClientRect();
        expect(tileAtPoint(box.left + 1, box.top + 1)).toBe(board[idx]);
        const centre = tilePoint(idx);
        expect(tileAtPoint(centre.x, centre.y)).toBe(board[idx]);
      }
      expect(document.elementFromPoint(middle.left + 1, middle.top + 1)).toBe(board[5]);
    });

    it("resolves a sample in the gap between two tiles to no tile", () => {
      driveToRoundOne("LAG4T");
      const board = tiles();
      // x=86 sits between tile 1 (ends at 84) and tile 2 (starts at 88).
      const gap = { x: 86, y: 20 };
      expect(tileAtPoint(gap.x, gap.y)).toBeNull();
      expect(document.elementFromPoint(gap.x, gap.y)?.closest(".tile") ?? null).toBeNull();

      // Through the pointer stream the gap moves the trace not at all: H stays.
      firePointerEvent(board[0]!, "pointerdown", { pointerType: "mouse" });
      firePointerEvent(board[0]!, "pointermove", { pointerType: "mouse", at: gap });
      expect(app!.root.querySelector("#trace")!.textContent).toBe("H");
    });
  });

  describe("only a clearly-inside sample moves the trace (#103)", () => {
    /** The shared BOARD: tile 0=H, 1=A, 5=I, 10=M. */
    function tiles(): HTMLElement[] {
      return tileEls(app!.root);
    }

    /** The live trace the player sees, i.e. the word a release would submit. */
    function liveTrace(): string {
      return app!.root.querySelector("#trace")!.textContent!;
    }

    it("ignores a touchmove clipping tile A's corner, then bridges to M", () => {
      driveToRoundOne("LAG4T");
      const board = tiles();
      const [h, a, m] = [board[0]!, board[1]!, board[10]!];

      fireTouchEvent(h, "touchstart", { to: h });
      expect(liveTrace()).toBe("H");

      // 1px inside A's near corner: the finger only clips the tile, so the
      // sample is ignored and the trace stays "H".
      const box = a.getBoundingClientRect();
      fireTouchEvent(h, "touchmove", { at: { x: box.left + 1, y: box.top + 1 } });
      expect(liveTrace()).toBe("H");

      // Continuing to M's centre bridges the ground in between: H → I → M.
      fireTouchEvent(h, "touchmove", { to: m });
      expect(liveTrace()).toBe("HIM");
      fireTouchEvent(h, "touchend", { to: m });
      expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HIM", reqId: 3 });
    });

    it("does not unwind the previous tile when a touchmove clips its corner", () => {
      driveToRoundOne("LAG4T");
      const board = tiles();
      const h = board[0]!;
      const i = board[5]!;

      fireTouchEvent(h, "touchstart", { to: h });
      fireTouchEvent(h, "touchmove", { to: i });
      expect(liveTrace()).toBe("HI");

      // 1px inside H's near corner (bottom-right, toward I): an ambiguous
      // sample must not be read as backtracking onto the previous tile.
      const box = h.getBoundingClientRect();
      fireTouchEvent(h, "touchmove", { at: { x: box.right - 1, y: box.bottom - 1 } });
      expect(liveTrace()).toBe("HI");
      fireTouchEvent(h, "touchend", { to: i });
      expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HI", reqId: 3 });
    });

    it("still unwinds the previous tile when the finger reaches its centre", () => {
      driveToRoundOne("LAG4T");
      const board = tiles();
      const h = board[0]!;
      const i = board[5]!;

      fireTouchEvent(h, "touchstart", { to: h });
      fireTouchEvent(h, "touchmove", { to: i });
      expect(liveTrace()).toBe("HI");

      // The previous tile's centre is a clear hit: a deliberate backtrack.
      fireTouchEvent(h, "touchmove", { to: h });
      expect(liveTrace()).toBe("H");
      fireTouchEvent(h, "touchend", { to: h });
      expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "H", reqId: 3 });
    });

    it("moves the trace not at all for a sample placed in the gap", () => {
      driveToRoundOne("LAG4T");
      const board = tiles();
      const h = board[0]!;

      fireTouchEvent(h, "touchstart", { to: h });
      // x=86 falls between tile 1 (ends at 84) and tile 2 (starts at 88).
      fireTouchEvent(h, "touchmove", { at: { x: 86, y: 20 } });
      expect(liveTrace()).toBe("H");
    });

    it("derives the clear-hit margin from the board's computed gap", () => {
      // The happy-dom harness has no layout engine, so widen the token
      // before the board renders; the app must read it from the board rather
      // than carry its own literal copy.
      const style = document.createElement("style");
      style.textContent = ".board { --board-gap: 12px; }";
      document.head.append(style);
      try {
        driveToRoundOne("LAG4T");
        const board = tiles();
        const [h, a] = [board[0]!, board[1]!];
        const box = a.getBoundingClientRect();

        firePointerEvent(h, "pointerdown", { pointerType: "mouse" });
        // 8px inside A is exactly the old margin's clear ground, but not
        // this board's: the widened gap leaves the trace on H.
        firePointerEvent(h, "pointermove", {
          pointerType: "mouse",
          at: { x: box.left + 8, y: box.top + 8 },
        });
        expect(liveTrace()).toBe("H");

        // Past the computed 12px margin the sample is clearly inside A.
        firePointerEvent(h, "pointermove", {
          pointerType: "mouse",
          at: { x: box.left + 13, y: box.top + 13 },
        });
        expect(liveTrace()).toBe("HA");
      } finally {
        style.remove();
      }
    });
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
        remaining: 18_000,
        deadline: Date.now() + 18_000,
      });
      await vi.advanceTimersByTimeAsync(251);
      expect(app!.root.querySelector("#countdown")!.textContent).toBe("0:18");
      const nowTimer = app!.root.querySelector<HTMLElement>("#timer")!;
      expect(nowTimer.classList.contains("low")).toBe(true);
      expect(Number(nowTimer.style.getPropertyValue("--p"))).toBeCloseTo(0.15, 2);
      expect(noticeText(app!.root, "error")).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a Tick re-anchors the ring timer in place while a structural delta rebuilds the screen", () => {
    vi.useFakeTimers();
    try {
      driveToRoundOne("LAG4T");
      const timer = app!.root.querySelector<HTMLElement>("#timer")!;
      const digits = app!.root.querySelector<HTMLElement>("#countdown")!;

      // A play-time delta: the server re-anchors the countdown, and the very
      // same ring timer and digits survive — updated, never replaced.
      app!.conn().feed(tick(90_000));
      expect(app!.root.querySelector("#timer")).toBe(timer);
      expect(app!.root.querySelector("#countdown")).toBe(digits);
      expect(digits.textContent).toBe("1:30");
      expect(Number(timer.style.getPropertyValue("--p"))).toBeCloseTo(0.75, 2);

      // A structural delta (a roster join) still rebuilds the whole screen:
      // a fresh ring timer takes the old one's place.
      app!.conn().feed(playerJoined(2, "Ben"));
      expect(app!.root.querySelector("#timer")).not.toBe(timer);
      expect(app!.root.querySelector("#countdown")).not.toBe(digits);
      expect(app!.root.querySelector("#countdown")!.textContent).toBe("1:30");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a score-update and a word-accepted verdict update in place without replacing the ring timer", () => {
    driveToRoundOne("LAG4T");
    const timer = app!.root.querySelector<HTMLElement>("#timer")!;
    const digits = app!.root.querySelector<HTMLElement>("#countdown")!;

    // A round-score change refreshes the scoreboard and the centered round
    // score, but the very same ring timer and digits survive.
    app!.conn().feed({
      type: "score-update",
      roundNumber: 1,
      scores: [{ seatId: 1, nickname: "Lena", roundScore: 7, cumulativeScore: 7 }],
    });
    expect(app!.root.querySelector("#timer")).toBe(timer);
    expect(app!.root.querySelector("#countdown")).toBe(digits);
    expect(app!.root.querySelector("#round-score")!.textContent).toBe("7 P");
    expect(app!.root.querySelector<HTMLElement>("#players")!.textContent).toContain("7 P");

    // An accepted word refreshes the private found-word chips and the centered
    // round score, again without replacing the ring timer.
    app!.conn().feed({ type: "word-accepted", word: "HAU", points: 5 });
    expect(app!.root.querySelector("#timer")).toBe(timer);
    expect(app!.root.querySelector("#countdown")).toBe(digits);
    expect(app!.root.querySelector("#round-score")!.textContent).toBe("12 P");
    expect(app!.root.querySelector("#found .chip.find")!.textContent).toContain("HAU");

    // A structural delta (a roster join) still rebuilds the whole screen: a
    // fresh ring timer takes the old one's place.
    app!.conn().feed(playerJoined(2, "Ben"));
    expect(app!.root.querySelector("#timer")).not.toBe(timer);
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
    expect(traceSeen).toEqual(["sch", "schT", "schTE", "Wische über die Felder, um ein Wort zu bilden."]);
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
    expect(tileEls(app!.root).map((t) => t.firstChild?.textContent)).toEqual(BOARD);
  });

  describe("entry screens (#53, #173)", () => {
    it("Home is the landing: tagline, exactly two actions and no form — the skin switcher lives in the Menü", () => {
      expect(app!.root.querySelector("h1")!.textContent).toBe("Wortschatz");
      expect(app!.root.querySelector(".sheet > p.dim")!.textContent).toBe("Ein Mehrspieler-Wörterspiel.");

      const actions = [...app!.root.querySelectorAll<HTMLButtonElement>(".home-actions button")];
      expect(actions.map((b) => b.textContent)).toEqual(["Raum erstellen", "Raum beitreten"]);
      expect(app!.root.querySelector("#screen #skin-select")).toBeNull();
      expect(app!.root.querySelector("#menu-panel #skin-select")).toBeTruthy();
      expect(app!.root.querySelectorAll("input")).toHaveLength(0);
    });

    it("Create has one Name field and sends create-room", () => {
      openCreate();
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum erstellen");
      const labels = [...app!.root.querySelectorAll<HTMLLabelElement>("label")];
      expect(labels.map((l) => l.textContent!.trim())).toEqual(["Name"]);
      expect(app!.root.querySelector<HTMLInputElement>("#mk-nick")!.placeholder).toBe("z. B. Anja");
      expect(app!.root.querySelector("#mk-btn")!.textContent).toBe("Raum erstellen");

      typeInto("#mk-nick", "Lena");
      click("#mk-btn");
      expect(app!.conn().sent()).toEqual([{ type: "create-room", nickname: "Lena", reqId: 1 }]);
    });

    it("Join has Raumcode and Name fields and sends join with code and nickname", () => {
      // No remembered seat may replace the typed name in this assertion.
      localStorage.clear();
      openJoin();
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum beitreten");
      const labels = [...app!.root.querySelectorAll<HTMLLabelElement>("label")];
      expect(labels.map((l) => l.textContent!.trim())).toEqual(["Raumcode", "Name"]);
      expect(app!.root.querySelector<HTMLInputElement>("#jn-nick")!.placeholder).toBe("z. B. Jörg");
      expect(app!.root.querySelector<HTMLInputElement>("#jn-code")!.readOnly).toBe(false);

      typeInto("#jn-code", "ABC12");
      typeInto("#jn-nick", "Anja");
      click("#jn-btn");
      expect(app!.conn().sent()).toEqual([{ type: "join", code: "ABC12", nickname: "Anja", reqId: 1 }]);
    });

    it("keeps the local validation copy on the screen that owns the field", () => {
      openCreate();
      click("#mk-btn");
      expect(noticeText(app!.root, "error")).toBe("Bitte gib einen Namen ein.");
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum erstellen");
      expect(app!.connections()).toHaveLength(0);

      click("#back-btn");
      openJoin();
      click("#jn-btn");
      expect(noticeText(app!.root, "error")).toBe("Bitte gib einen Raumcode ein.");
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum beitreten");

      typeInto("#jn-code", "ABC12");
      click("#jn-btn");
      expect(noticeText(app!.root, "error")).toBe("Bitte gib einen Namen ein.");
      expect(app!.connections()).toHaveLength(0);
    });

    it("Zurück from Create or Join returns Home without a connection attempt", () => {
      openCreate();
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum erstellen");
      click("#back-btn");
      expect(app!.root.querySelector("h1")!.textContent).toBe("Wortschatz");
      expect(window.location.pathname).toBe("/");
      expect(app!.connections()).toHaveLength(0);

      openJoin();
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum beitreten");
      click("#back-btn");
      expect(app!.root.querySelector("h1")!.textContent).toBe("Wortschatz");
      expect(app!.connections()).toHaveLength(0);
      expect(noticeText(app!.root, "error")).toBe("");
    });

    it("popstate renders the entry it names, and stays ignored while in a room", () => {
      openCreate();
      window.dispatchEvent(new PopStateEvent("popstate", { state: { screen: "home" } }));
      expect(app!.root.querySelector("h1")!.textContent).toBe("Wortschatz");
      expect(app!.connections()).toHaveLength(0);

      window.dispatchEvent(new PopStateEvent("popstate", { state: { screen: "join" } }));
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum beitreten");
      window.dispatchEvent(new PopStateEvent("popstate", { state: { screen: "home" } }));

      driveToRoundOne("LAG4T");
      window.dispatchEvent(new PopStateEvent("popstate", { state: { screen: "home" } }));
      expect(app!.root.querySelector("h1")!.textContent).toContain("Runde 1");
    });
  });

  describe("menu skin choice (#23, ADR-0023)", () => {
    // The choice is observable only at its boundaries: the root attribute
    // (body[data-skin]), the localStorage value and remounts of the app.
    const SKIN_KEY = "wordament:skin";

    beforeEach(() => {
      localStorage.removeItem(SKIN_KEY);
    });

    afterEach(() => {
      localStorage.removeItem(SKIN_KEY);
      delete (document.body as { dataset: DOMStringMap }).dataset.skin;
    });

    function chooseSkin(value: string): void {
      const select = app!.root.querySelector<HTMLSelectElement>("#skin-select")!;
      select.value = value;
      select.dispatchEvent(new Event("change"));
    }

    it("first-time visitors land on Standard — the root attribute, the switcher and its selection", () => {
      expect(document.body.dataset.skin).toBe("standard");
      // The switcher lives in the app-owned Menü, not in Home's markup.
      expect(app!.root.querySelector("#screen #skin-select")).toBeNull();
      const select = app!.root.querySelector<HTMLSelectElement>("#menu-panel #skin-select")!;
      expect([...select.options].map((o) => o.value)).toEqual(["standard", "arcade"]);
      expect(select.value).toBe("standard");
      // A room rebuild leaves the app-owned switcher in place.
      typeInto("#mk-nick", "Lena");
      click("#mk-btn");
      app!.conn().feed(lobbySnapshot({ code: "LAG4T", nickname: "Lena" }));
      expect(app!.root.querySelector("#screen #skin-select")).toBeNull();
      expect(app!.root.querySelector("#menu-panel #skin-select")).not.toBeNull();
    });

    it("the Menü skin entry is headed Skin with a Skin selector — no Erscheinungsbild, Farbwelt or explanatory note", () => {
      const panel = app!.root.querySelector<HTMLElement>(".panel:has(#skin-select)")!;
      expect(panel.querySelector("h2")!.textContent).toBe("Skin");
      expect(panel.querySelector("#skin-select")).toBeTruthy();
      expect(panel.textContent).not.toContain("Erscheinungsbild");
      expect(panel.textContent).not.toContain("Farbwelt");
      expect(panel.textContent).not.toContain("Gilt überall in der App");

      // The option labels the switcher kept.
      const select = panel.querySelector<HTMLSelectElement>("#skin-select")!;
      expect([...select.options].map((o) => o.textContent)).toEqual(["Standard (hell)", "Arcade (dunkel)"]);

      // Registry entries carry no unused `note` string.
      for (const skin of SKINS) expect(skin).not.toHaveProperty("note");
    });

    it("choosing Arcade applies app-wide instantly and carries through every screen of the mount", () => {
      chooseSkin("arcade");
      expect(document.body.dataset.skin).toBe("arcade");

      // Rooms render from the same root: no per-screen choice needed.
      typeInto("#mk-nick", "Lena");
      click("#mk-btn");
      app!.conn().feed(lobbySnapshot({ code: "LAG4T", nickname: "Lena" }));
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum LAG4T");
      expect(document.body.dataset.skin).toBe("arcade");

      // Back home, the switcher reflects the life choice of this visit.
      click("#leave-btn");
      expect(app!.root.querySelector<HTMLSelectElement>("#menu-panel #skin-select")!.value).toBe("arcade");
    });

    it("the choice persists via localStorage and a returning visitor mounts onto it", () => {
      chooseSkin("arcade");
      expect(localStorage.getItem(SKIN_KEY)).toBe("arcade");
      app!.unmount();
      app = mountHarness();
      expect(document.body.dataset.skin).toBe("arcade");
      expect(app!.root.querySelector<HTMLSelectElement>("#menu-panel #skin-select")!.value).toBe("arcade");
    });

    it("a misplaced stored value falls back to Standard, not to a broken skin", () => {
      localStorage.setItem(SKIN_KEY, "retro90");
      app!.unmount();
      app = mountHarness();
      expect(document.body.dataset.skin).toBe("standard");
      expect(app!.root.querySelector<HTMLSelectElement>("#menu-panel #skin-select")!.value).toBe("standard");
    });
  });

  describe("ß display (#150)", () => {
    /** The ß tile is canonical lowercase data; the display layer is what
     *  keeps it from reading as a double `s`. */
    const BOARD_WITH_ẞ = ["ß", "a", "u", "s", "t", "i", "r", "e", "b", "u", "m", "s", "k", "a", "t", "z"];

    function driveToẞRound(): void {
      driveToRoundOne("LAG4T");
      app!.conn().feed(roundStarted(BOARD_WITH_ẞ, 2));
    }

    it("renders the ß tile as one ẞ glyph with a matching accessible label", () => {
      driveToẞRound();
      const tile = tileEls(app!.root)[0]!;
      expect(tile.firstChild?.textContent).toBe("ẞ");
      expect(tile.textContent).not.toContain("SS");
      expect(tile.getAttribute("aria-label")).toBe("ẞ, 2 Punkte");
    });

    it("shows ẞ in the drag trace while the submitted word still spells ß", () => {
      driveToẞRound();
      const tiles = tileEls(app!.root);
      const traceSeen: string[] = [];
      synthesizePointerDrag([tiles[0]!, tiles[1]!], "mouse", () => {
        traceSeen.push(app!.root.querySelector("#trace")!.textContent!);
      });

      expect(traceSeen).toEqual(["ẞ", "ẞa", "Wische über die Felder, um ein Wort zu bilden."]);
      expect(traceSeen[1]).not.toContain("SS");
      // Display only: the wire still carries the data's real `ß`.
      expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "ßa", reqId: 3 });
    });

    it("shows ẞ in a found-word chip and in the reveal, keeping straße and strasse distinct", () => {
      driveToẞRound();
      app!.conn().feed({ type: "word-accepted", word: "ßa", points: 2 });
      const chip = app!.root.querySelector<HTMLElement>("#found .chip.find")!;
      expect(chip.textContent).toContain("ẞa");
      expect(chip.textContent).not.toContain("SS");

      app!.conn().feed(
        roundEnded(1, {
          groups: [
            { length: 5, words: [{ word: "straße", points: 7, foundBy: [1] }] },
            { length: 6, words: [{ word: "strasse", points: 7, foundBy: [1] }] },
          ],
        })
      );
      const words = [...app!.root.querySelectorAll(".rw-word")].map((el) => el.textContent);
      expect(words).toEqual(["straẞe", "strasse"]);
      expect(words[0]).not.toBe(words[1]);
    });
  });
});
