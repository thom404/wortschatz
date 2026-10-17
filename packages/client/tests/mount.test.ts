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
  seat,
  tick,
  tileEls,
  type Mounted,
  type PlayerInfo,
} from "./harness.js";
import type { RevealPayload } from "@wortschatz/shared";

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

function click(sel: string): void {
  app!.root.querySelector<HTMLButtonElement>(sel)!.click();
}

function typeInto(sel: string, value: string): void {
  app!.root.querySelector<HTMLInputElement>(sel)!.value = value;
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

      // The host's round-start affordance (spec: start only at ≥ 2 players).
      expect(app!.root.querySelector("#start-btn")).toBeTruthy();
      expect(app!.root.querySelector("#players")).toBeTruthy();

      // The address bar carries the room's real deep link, not the greeting
      // key the creator pushed before the server named the room.
      expect(window.location.pathname).toBe("/r/LAG4T");
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
          "Du schaust zu — ab der nächsten Runde spielst du mit."
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
        .map((t) => (t.firstChild?.textContent ?? "").trim()); // tile letters only (the .idx span rides along)
      expect(shown).toEqual(["an", "s", "e/ä", "H", "qu"]);

      // The input still spells the cleaned letters (trace uses the data).
      const tiles = tileEls(app!.root);
      synthesizePointerDrag([tiles[7]!, tiles[11]!], "mouse"); // R → M (8-way adjacent, both singles)
      expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "RM", reqId: 3 });
    });
  });

  describe("intermission screen (#22)", () => {
    it("the round-end reveal renders grouped by length with per-word points, found-by chips and missed words visible", () => {
      driveToRoundWith("LAG4T", [
        seat({ seatId: 1, nickname: "Lena" }),
        seat({ seatId: 2, nickname: "Ben" }),
      ]);
      app!.conn().feed(roundEnded(1, REVEAL));

      expect(app!.root.querySelector("h1")!.textContent).toBe("Zwischenspiel");
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
      // second.
      expect(chips[0]!.textContent).toContain("Runde 2 P");
      expect(chips[0]!.textContent).toContain("Gesamt 40 P");
      expect(chips[1]!.textContent).toContain("Runde 5 P");
      expect(chips[1]!.textContent).toContain("Gesamt 25 P");
    });

    it("the host gets a working skip control that starts the next round now", () => {
      driveToRoundOne("LAG4T");
      app!.conn().feed(roundEnded(1, REVEAL));
      const skip = app!.root.querySelector<HTMLButtonElement>("#skip-btn")!;
      skip.click();
      expect(app!.conn().sent().at(-1)).toEqual({ type: "skip", reqId: 3 });
    });

    it("a non-host sees the server-owned next-round indicator instead of a skip control", () => {
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
      expect(app!.root.querySelector("h1")!.textContent).toBe("Zwischenspiel");
      expect(app!.root.querySelector("#skip-btn")).toBeNull();
      // Unambiguous: the pause belongs to the server, not to any button.
      expect(app!.root.querySelector(".next-round-hint")!.textContent).toContain(
        "Die nächste Runde startet gleich"
      );
    });

    it("auto-advances into the next round when the countdown expires — no click anywhere", async () => {
      vi.useFakeTimers();
      try {
        driveToRoundOne("LAG4T");
        app!.conn().feed(roundEnded(1, REVEAL));
        app!.conn().feed(tick("intermission", 2_000));
        await vi.advanceTimersByTimeAsync(251);
        // Interpolated intermission digits are live…
        expect(app!.root.querySelector("#countdown")!.textContent).toBe("0:02");
        app!.conn().feed(tick("intermission", 0));
        await vi.advanceTimersByTimeAsync(251);
        // …clamped at zero — the client never self-transitions.
        expect(app!.root.querySelector("#countdown")!.textContent).toBe("0:00");
        expect(document.title).toBe("WortMeister — Zwischenspiel");
        // The expiry lands as the server's next round: everyone flips
        // without so much as a hover over a button.
        app!.conn().feed(roundStarted(BOARD, 2));
        expect(app!.root.querySelector("h1")!.textContent).toContain("Runde 2");
        expect(tileEls(app!.root)).toHaveLength(16);
        // Nothing was sent but the original lobby truth — no skip, no start.
        expect(app!.conn().sentTypes()).toEqual(["create-room", "start-round"]);
      } finally {
        vi.useRealTimers();
      }
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

  it("a connection close with no server frame shows the connection-lost outcome screen", () => {
    driveToRoundOne("LAG4T");
    // An orderly close (production: server restart races, dispose before
    // the frame) or the pre-frame state of a kicked/room-ended disposal.
    app!.conn().abruptClose();
    expect(app!.root.querySelector("h1")!.textContent).toBe("Verbindung beendet.");
    expect(app!.conn().statuses).toEqual(["connecting", "open", "closed"]);
    // The real action returns to the home screen.
    app!.root.querySelector<HTMLButtonElement>("#home-btn")!.click();
    expect(app!.root.querySelector("h1")!.textContent).toBe("WortMeister");
  });

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

  describe("out-of-room screens (#21)", () => {
    it("being kicked shows the dedicated outcome screen with a real action back home", () => {
      driveToRoundOne("LAG4T");
      app!.conn().feed({ type: "kicked" });
      // The boundary closes before the outcome frame is delivered
      // (RoomConnection-faithful order) — the kicked screen still wins.
      expect(app!.root.querySelector("h1")!.textContent).toBe("Du wurdest aus dem Raum LAG4T entfernt.");
      expect(app!.root.querySelector("#home-btn")).toBeTruthy();
      expect(app!.conn().stopped).toBe(true);
      app!.root.querySelector<HTMLButtonElement>("#home-btn")!.click();
      expect(app!.root.querySelector("h1")!.textContent).toBe("WortMeister");
    });

    it("a host-closed room shows the dedicated ended screen", () => {
      driveToRoundOne("LAG4T");
      app!.conn().feed({ type: "room-ended", reason: "host-closed" });
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum LAG4T wurde beendet.");
      app!.root.querySelector<HTMLButtonElement>("#home-btn")!.click();
      expect(app!.root.querySelector("h1")!.textContent).toBe("WortMeister");
    });

    it("an expired room ends with its own dedicated screen", () => {
      driveToRoundOne("LAG4T");
      app!.conn().feed({ type: "room-ended", reason: "expired" });
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum LAG4T ist abgelaufen.");
      // Same real action as every outcome screen: back to the home screen.
      app!.root.querySelector<HTMLButtonElement>("#home-btn")!.click();
      expect(app!.root.querySelector("h1")!.textContent).toBe("WortMeister");
    });

    it("a wrong room code surfaces the generic not-found outcome screen", () => {
      typeInto("#jn-code", "ZZZ99");
      typeInto("#jn-nick", "Ben");
      click("#jn-btn");
      expect(app!.conn().sent()).toEqual([{ type: "join", code: "ZZZ99", nickname: "Ben", reqId: 1 }]);
      app!.conn().feed({ type: "error", code: "room-not-found", message: "ZZZ99" });
      expect(app!.root.querySelector("h1")!.textContent).toBe("Raum ZZZ99 nicht gefunden oder abgelaufen.");
      app!.root.querySelector<HTMLButtonElement>("#home-btn")!.click();
      expect(app!.root.querySelector("h1")!.textContent).toBe("WortMeister");
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

  describe("home skin choice (#23)", () => {
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
      const select = app!.root.querySelector<HTMLSelectElement>("#skin-select")!;
      expect([...select.options].map((o) => o.value)).toEqual(["standard", "arcade"]);
      expect(select.value).toBe("standard");
      // Switcher lives on the home screen (of this mount), not in a room.
      typeInto("#mk-nick", "Lena");
      click("#mk-btn");
      app!.conn().feed(lobbySnapshot({ code: "LAG4T", nickname: "Lena" }));
      expect(app!.root.querySelector("#skin-select")).toBeNull();
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
      expect(app!.root.querySelector<HTMLSelectElement>("#skin-select")!.value).toBe("arcade");
    });

    it("the choice persists via localStorage and a returning visitor mounts onto it", () => {
      chooseSkin("arcade");
      expect(localStorage.getItem(SKIN_KEY)).toBe("arcade");
      app!.unmount();
      app = mountHarness();
      expect(document.body.dataset.skin).toBe("arcade");
      expect(app!.root.querySelector<HTMLSelectElement>("#skin-select")!.value).toBe("arcade");
    });

    it("a misplaced stored value falls back to Standard, not to a broken skin", () => {
      localStorage.setItem(SKIN_KEY, "retro90");
      app!.unmount();
      app = mountHarness();
      expect(document.body.dataset.skin).toBe("standard");
      expect(app!.root.querySelector<HTMLSelectElement>("#skin-select")!.value).toBe("standard");
    });
  });
});
