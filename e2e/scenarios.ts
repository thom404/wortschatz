import type { Page } from "@playwright/test";
import type { RevealPayload, ScoreEntry, ServerMessage } from "@wortschatz/shared";
import {
  intermissionSnapshot,
  lobbySnapshot,
  playingSnapshot,
  seat,
  type PlayerInfo,
} from "../packages/client/tests/fixtures.js";
import {
  FIXED_NOW,
  PHONE_LARGE,
  PHONE_SMALL,
  SKINS,
  VIEWPORTS,
  expect,
  type SkinId,
  type Viewport,
  type WireOptions,
} from "./support.js";

/** The one room code every fixture uses (deterministic deep links and QR). */
export const ROOM_CODE = "ABC12";

/** A board with digrams and an either/or tile, the normal playing surface. */
export const BOARD_DIGRAM = [
  "sch",
  "e",
  "i",
  "n",
  "ch",
  "r",
  "t",
  "a",
  "er",
  "u",
  "g",
  "l",
  "st",
  "o",
  "m",
  "en",
] as const;

/** A plain board whose first row spells `hau`, for the drag flow. */
export const BOARD_DRAG = [
  "h",
  "a",
  "u",
  "s",
  "e",
  "n",
  "d",
  "r",
  "t",
  "i",
  "m",
  "l",
  "g",
  "o",
  "c",
  "k",
] as const;

export const REVEAL: RevealPayload = {
  groups: [
    {
      length: 3,
      words: [
        { word: "ast", points: 3, foundBy: [1] },
        { word: "eis", points: 3, foundBy: [] },
        { word: "rot", points: 2, foundBy: [2] },
      ],
    },
    {
      length: 4,
      words: [
        { word: "haus", points: 8, foundBy: [1, 2] },
        { word: "maus", points: 6, foundBy: [] },
      ],
    },
    {
      length: 5,
      words: [
        { word: "stein", points: 9, foundBy: [2] },
        { word: "wolke", points: 9, foundBy: [] },
      ],
    },
  ],
};

const ROSTER: PlayerInfo[] = [
  seat({ seatId: 1, nickname: "Lena", cumulativeScore: 66 }),
  seat({ seatId: 2, nickname: "Jonas", cumulativeScore: 54 }),
  seat({ seatId: 3, nickname: "Aylin", cumulativeScore: 30, connected: false }),
  seat({ seatId: 4, nickname: "Mehmet", cumulativeScore: 21 }),
];

/** Room-wide scores for round one, matching ROSTER's seats. */
const ROUND_ONE_SCORES: ScoreEntry[] = [
  { seatId: 1, nickname: "Lena", roundScore: 24, cumulativeScore: 66 },
  { seatId: 2, nickname: "Jonas", roundScore: 18, cumulativeScore: 54 },
  { seatId: 3, nickname: "Aylin", roundScore: 12, cumulativeScore: 30 },
  { seatId: 4, nickname: "Mehmet", roundScore: 7, cumulativeScore: 21 },
];

function scoreUpdate(roundNumber: number, scores: ScoreEntry[]): ServerMessage {
  return { type: "score-update", roundNumber, scores };
}

function lobbyWire(players: PlayerInfo[] = ROSTER, selfSeatId = 1): ServerMessage[] {
  const self = players.find((p) => p.seatId === selfSeatId) ?? players[0]!;
  return [
    lobbySnapshot({
      code: ROOM_CODE,
      nickname: self.nickname,
      seatId: self.seatId,
      hostSeatId: 1,
      players,
    }),
  ];
}

function gameWire(): ServerMessage[] {
  return [
    playingSnapshot({
      code: ROOM_CODE,
      selfSeatId: 2,
      nickname: "Jonas",
      role: "player",
      board: BOARD_DIGRAM,
      deadline: FIXED_NOW + 100_000,
      players: ROSTER,
    }),
    scoreUpdate(1, ROUND_ONE_SCORES),
  ];
}

function intermissionWire(selfSeatId: number): ServerMessage[] {
  const self = ROSTER.find((p) => p.seatId === selfSeatId) ?? ROSTER[0]!;
  return [
    intermissionSnapshot({
      code: ROOM_CODE,
      selfSeatId,
      nickname: self.nickname,
      hostSeatId: 1,
      board: BOARD_DIGRAM,
      reveal: REVEAL,
      players: ROSTER,
    }),
    scoreUpdate(1, ROUND_ONE_SCORES),
  ];
}

function outcomeWire(finalFrame: ServerMessage, closeAfterGreeting?: WireOptions["closeAfterGreeting"]) {
  return {
    messages: [...lobbyWire(ROSTER, 2), finalFrame],
    ...(closeAfterGreeting ? { closeAfterGreeting } : {}),
  } satisfies WireOptions;
}

async function revealSorted(page: Page, sort: "points" | "alphabet"): Promise<void> {
  await page.locator(`#reveal-sort button[data-sort="${sort}"]`).click();
  await expect(page.locator(`#reveal-sort button[data-sort="${sort}"]`)).toHaveAttribute(
    "aria-pressed",
    "true"
  );
}

async function submitCreateLocalError(page: Page): Promise<void> {
  await page.locator("#create-btn").click();
  await page.locator("#mk-btn").click();
  await expect(page.locator("#notice-error")).toHaveText("Bitte gib einen Namen ein.");
}

/** One screenshot row of the curated matrix (#156). */
export interface ScreenshotScenario {
  id: string;
  skins: readonly SkinId[];
  viewports: readonly Viewport[];
  path?: string;
  wire?: WireOptions;
  /** How the scenario opens the room's connection (default `create`). */
  enter?: "create" | "join";
  /** Written but not enabled until the named issue lands. */
  fixme?: string;
  afterOpen?: (page: Page) => Promise<void>;
  ready: (page: Page) => Promise<void>;
}

const home: ScreenshotScenario = {
  id: "home-fresh",
  skins: SKINS,
  viewports: VIEWPORTS,
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toHaveText("Wortschatz");
    await expect(page.locator(".home-actions button")).toHaveCount(2);
  },
};

const createFresh: ScreenshotScenario = {
  id: "create-fresh",
  skins: SKINS,
  viewports: VIEWPORTS,
  afterOpen: async (page) => {
    await page.locator("#create-btn").click();
  },
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toHaveText("Raum erstellen");
    await expect(page.locator("#mk-nick")).toBeVisible();
  },
};

const joinFresh: ScreenshotScenario = {
  id: "join-fresh",
  skins: SKINS,
  viewports: VIEWPORTS,
  afterOpen: async (page) => {
    await page.locator("#join-btn").click();
  },
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toHaveText("Raum beitreten");
    await expect(page.locator("#jn-code")).toBeVisible();
  },
};

const lobbyHostAlone: ScreenshotScenario = {
  id: "lobby-host-alone",
  skins: SKINS,
  viewports: VIEWPORTS,
  wire: { messages: lobbyWire([ROSTER[0]!], 1) },
  ready: async (page) => {
    await expect(page.locator("#players .chip")).toHaveCount(1);
    await expect(page.locator("#start-btn")).toBeVisible();
  },
};

const lobbyHostWithGuests: ScreenshotScenario = {
  id: "lobby-host-three-guests",
  skins: SKINS,
  viewports: VIEWPORTS,
  wire: { messages: lobbyWire() },
  ready: async (page) => {
    await expect(page.locator("#players .chip")).toHaveCount(4);
    await expect(page.locator("#players .away")).toHaveText("unterbrochen");
  },
};

const game: ScreenshotScenario = {
  id: "game-digram",
  skins: SKINS,
  viewports: VIEWPORTS,
  wire: { messages: gameWire() },
  ready: async (page) => {
    await expect(page.locator("#board .tile")).toHaveCount(16);
    await expect(page.locator("#countdown")).toHaveText("1:40");
  },
};

const intermissionHost: ScreenshotScenario = {
  id: "intermission-host",
  skins: SKINS,
  viewports: VIEWPORTS,
  wire: { messages: intermissionWire(1) },
  ready: async (page) => {
    await expect(page.locator("#reveal .rw")).toHaveCount(7);
    await expect(page.locator("#start-btn")).toBeVisible();
  },
};

const intermissionGuest: ScreenshotScenario = {
  id: "intermission-guest",
  skins: SKINS,
  viewports: VIEWPORTS,
  wire: { messages: intermissionWire(2) },
  ready: async (page) => {
    await expect(page.locator("#reveal .rw")).toHaveCount(7);
    await expect(page.locator(".next-round-hint")).toBeVisible();
  },
};

const kicked: ScreenshotScenario = {
  id: "outcome-kicked",
  skins: SKINS,
  viewports: [PHONE_LARGE],
  wire: outcomeWire({ type: "kicked" }),
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toContainText("Du wurdest aus dem Raum");
    await expect(page.locator("#home-btn")).toBeVisible();
  },
};

const roomEnded: ScreenshotScenario = {
  id: "outcome-room-ended",
  skins: SKINS,
  viewports: [PHONE_LARGE],
  wire: outcomeWire({ type: "room-ended", reason: "host-closed" }),
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toContainText("wurde beendet");
  },
};

const roomExpired: ScreenshotScenario = {
  id: "outcome-room-expired",
  skins: SKINS,
  viewports: [PHONE_LARGE],
  wire: outcomeWire({ type: "room-ended", reason: "expired" }),
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toContainText("ist abgelaufen");
  },
};

const roomNotFound: ScreenshotScenario = {
  id: "outcome-room-not-found",
  skins: SKINS,
  viewports: [PHONE_LARGE],
  path: `/r/${ROOM_CODE}`,
  wire: { messages: [{ type: "error", code: "room-not-found" }] },
  enter: "join",
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toContainText("nicht gefunden oder abgelaufen");
  },
};

const connectionLost: ScreenshotScenario = {
  id: "outcome-connection-lost",
  skins: SKINS,
  viewports: [PHONE_LARGE],
  wire: {
    messages: lobbyWire(ROSTER, 2),
    closeAfterGreeting: { code: 1000, reason: "gone" },
  },
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toHaveText("Verbindung beendet.");
  },
};

const overflowChip: ScreenshotScenario = {
  id: "targeted-154-long-standings-chip",
  skins: SKINS,
  viewports: [PHONE_SMALL],
  wire: {
    messages: [
      intermissionSnapshot({
        code: ROOM_CODE,
        selfSeatId: 1,
        nickname: "Thomas-Maximilian",
        hostSeatId: 1,
        board: BOARD_DIGRAM,
        reveal: REVEAL,
        players: [
          seat({ seatId: 1, nickname: "Thomas-Maximilian", cumulativeScore: 128 }),
          seat({ seatId: 2, nickname: "Anne-Sophie Charlotte", cumulativeScore: 96 }),
          seat({
            seatId: 3,
            nickname: "Maximilian Alexander",
            cumulativeScore: 84,
            connected: false,
          }),
          seat({
            seatId: 4,
            nickname: "Wilhelmina Zuschauerin",
            role: "spectator",
            cumulativeScore: 0,
          }),
        ],
      }),
      scoreUpdate(1, [
        { seatId: 1, nickname: "Thomas-Maximilian", roundScore: 32, cumulativeScore: 128 },
        { seatId: 2, nickname: "Anne-Sophie Charlotte", roundScore: 21, cumulativeScore: 96 },
        { seatId: 3, nickname: "Maximilian Alexander", roundScore: 8, cumulativeScore: 84 },
        { seatId: 4, nickname: "Wilhelmina Zuschauerin", roundScore: 0, cumulativeScore: 0 },
      ]),
    ],
  },
  ready: async (page) => {
    await expect(page.locator("#players .chip")).toHaveCount(4);
  },
};

const lowTimer: ScreenshotScenario = {
  id: "targeted-low-timer",
  skins: SKINS,
  viewports: [PHONE_SMALL],
  wire: {
    messages: [
      playingSnapshot({
        code: ROOM_CODE,
        selfSeatId: 2,
        nickname: "Jonas",
        role: "player",
        board: BOARD_DIGRAM,
        deadline: FIXED_NOW + 15_000,
        players: ROSTER,
      }),
      scoreUpdate(1, ROUND_ONE_SCORES),
    ],
  },
  ready: async (page) => {
    await expect(page.locator("#countdown")).toHaveText("0:15");
    await expect(page.locator("#timer")).toHaveClass(/low/);
  },
};

const tooltip: ScreenshotScenario = {
  id: "targeted-tooltip",
  skins: SKINS,
  viewports: [PHONE_SMALL],
  wire: { messages: gameWire() },
  afterOpen: async (page) => {
    await page.locator("#board-rotation").hover();
  },
  ready: async (page) => {
    await expect(page.locator("#board-rotation")).toHaveAttribute("aria-label", "Spielfeld um 90° drehen");
    await expect
      .poll(() => page.locator("#board-rotation").evaluate((el) => getComputedStyle(el, "::after").opacity))
      .toBe("1");
  },
};

const errorNotice: ScreenshotScenario = {
  id: "targeted-error-notice",
  skins: SKINS,
  viewports: [PHONE_SMALL],
  wire: {
    messages: [...gameWire(), { type: "error", code: "invalid-word" }],
  },
  ready: async (page) => {
    await expect(page.locator("#notice-error")).toHaveText("Kein gültiges Wort.");
  },
};

const spectatorGame: ScreenshotScenario = {
  id: "targeted-spectator",
  skins: SKINS,
  viewports: [PHONE_SMALL],
  wire: {
    messages: [
      playingSnapshot({
        code: ROOM_CODE,
        selfSeatId: 2,
        nickname: "Jonas",
        role: "spectator",
        board: BOARD_DIGRAM,
        deadline: FIXED_NOW + 80_000,
        players: ROSTER,
      }),
    ],
  },
  ready: async (page) => {
    await expect(page.locator("#screen")).toContainText("Du schaust zu.");
  },
};

const revealByPoints: ScreenshotScenario = {
  id: "targeted-reveal-points",
  skins: SKINS,
  viewports: [PHONE_SMALL],
  wire: { messages: intermissionWire(1) },
  afterOpen: (page) => revealSorted(page, "points"),
  ready: async (page) => {
    await expect(page.locator("#reveal .rw-word").first()).toHaveText("stein");
  },
};

const revealAlphabetical: ScreenshotScenario = {
  id: "targeted-reveal-alphabet",
  skins: SKINS,
  viewports: [PHONE_SMALL],
  wire: { messages: intermissionWire(1) },
  afterOpen: (page) => revealSorted(page, "alphabet"),
  ready: async (page) => {
    await expect(page.locator("#reveal .rw-word").first()).toHaveText("ast");
  },
};

const fullLobby: ScreenshotScenario = {
  id: "targeted-full-lobby",
  skins: SKINS,
  viewports: [PHONE_SMALL],
  wire: {
    messages: lobbyWire(
      [
        seat({ seatId: 1, nickname: "Lena" }),
        seat({ seatId: 2, nickname: "Jonas" }),
        seat({ seatId: 3, nickname: "Aylin" }),
        seat({ seatId: 4, nickname: "Mehmet" }),
        seat({ seatId: 5, nickname: "Sofia" }),
        seat({ seatId: 6, nickname: "Emil" }),
        seat({ seatId: 7, nickname: "Nora" }),
        seat({ seatId: 8, nickname: "Kai" }),
      ],
      1
    ),
  },
  ready: async (page) => {
    await expect(page.locator("#players .chip")).toHaveCount(8);
    await expect(page.locator("#screen")).toContainText("8 von 8 verbunden");
  },
};

const createLocalError: ScreenshotScenario = {
  id: "targeted-create-local-error",
  skins: SKINS,
  viewports: [PHONE_SMALL],
  afterOpen: submitCreateLocalError,
  ready: async (page) => {
    await expect(page.locator("#notice-error")).toHaveText("Bitte gib einen Namen ein.");
  },
};

const joinDeepLink: ScreenshotScenario = {
  id: "targeted-join-deep-link",
  skins: SKINS,
  viewports: [PHONE_SMALL],
  path: `/r/${ROOM_CODE}`,
  ready: async (page) => {
    await expect(page.locator("#screen")).toContainText(`Du wurdest in Raum ${ROOM_CODE} eingeladen.`);
    await expect(page.locator("#jn-code")).toHaveValue(ROOM_CODE);
    await expect(page.locator("#jn-code")).toHaveAttribute("readonly", "");
  },
};

const lobbyGuest: ScreenshotScenario = {
  id: "targeted-lobby-guest",
  skins: SKINS,
  viewports: [PHONE_SMALL],
  wire: { messages: lobbyWire(ROSTER, 2) },
  ready: async (page) => {
    await expect(page.locator(".next-round-hint")).toHaveCount(0);
    await expect(page.locator("#screen")).toContainText("Warte auf den Gastgeber");
  },
};

/** 8 canonical screens × 2 skins × 4 viewports (phones, tablet, desktop) = 64. */
export const CANONICAL_SCENARIOS: readonly ScreenshotScenario[] = [
  home,
  createFresh,
  joinFresh,
  lobbyHostAlone,
  lobbyHostWithGuests,
  game,
  intermissionHost,
  intermissionGuest,
];

/** 5 outcome states × 2 skins × 390 = 10. */
export const OUTCOME_SCENARIOS: readonly ScreenshotScenario[] = [
  kicked,
  roomEnded,
  roomExpired,
  roomNotFound,
  connectionLost,
];

/** 11 targeted states × 2 skins × 360 = 22. */
export const TARGETED_SCENARIOS: readonly ScreenshotScenario[] = [
  overflowChip,
  lowTimer,
  tooltip,
  errorNotice,
  spectatorGame,
  revealByPoints,
  revealAlphabetical,
  fullLobby,
  createLocalError,
  joinDeepLink,
  lobbyGuest,
];

export const ALL_SCENARIOS: readonly ScreenshotScenario[] = [
  ...CANONICAL_SCENARIOS,
  ...OUTCOME_SCENARIOS,
  ...TARGETED_SCENARIOS,
];

export { PHONE_LARGE, PHONE_SMALL };
