import type { Page } from "@playwright/test";
import type { RevealPayload, ScoreEntry, ServerMessage } from "@wortschatz/shared";
import {
  COPY,
  ROOM_CODE,
  intermissionSnapshot,
  lobbySnapshot,
  playingSnapshot,
  seat,
  type PlayerInfo,
  type Scene,
} from "../packages/client/tests/fixtures.js";
import {
  FIXED_NOW,
  PHONE_LARGE,
  PHONE_SMALL,
  SKINS,
  VIEWPORTS,
  expect,
  openScene,
  type SkinId,
  type Viewport,
} from "./support.js";

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

/** A board carrying the two-letter choice tile the reveal and drag must agree
 *  on; the smallest phone checks that its face stays legible. */
export const BOARD_CHOICE = [
  "r/s",
  "e",
  "i",
  "n",
  "s",
  "t",
  "a",
  "h",
  "u",
  "g",
  "l",
  "b",
  "o",
  "m",
  "k",
  "d",
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

function gameWire(board: readonly string[] = BOARD_DIGRAM): ServerMessage[] {
  return [
    playingSnapshot({
      code: ROOM_CODE,
      selfSeatId: 2,
      nickname: "Jonas",
      role: "player",
      board,
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

function outcomeScene(
  finalFrame: ServerMessage,
  closeAfterGreeting?: { code?: number; reason?: string; delayMs?: number }
): Scene {
  return {
    entry: { mode: "create", nickname: "Lena" },
    greeting: [...lobbyWire(ROSTER, 2), finalFrame],
    ...(closeAfterGreeting ? { closeAfterGreeting } : {}),
  };
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
  await expect(page.locator("#notice-error")).toHaveText(COPY.errors.nameRequired);
}

/** One screenshot row of the curated matrix (#156). */
export interface ScreenshotScenario {
  id: string;
  scene: Scene;
  skins: readonly SkinId[];
  viewports: readonly Viewport[];
  /** Written but not enabled until the named issue lands. */
  fixme?: string;
  afterOpen?: (page: Page) => Promise<void>;
  ready: (page: Page) => Promise<void>;
}

/** Opens one scenario and runs its browser-only hooks before its readiness
 *  assertion, so every matrix loop shares the open → afterOpen → ready path. */
export async function runScenario(
  page: Page,
  scenario: ScreenshotScenario,
  opts: { viewport: Viewport; skin: SkinId }
): Promise<void> {
  await openScene(page, { scene: scenario.scene, viewport: opts.viewport, skin: opts.skin });
  if (scenario.afterOpen) await scenario.afterOpen(page);
  await scenario.ready(page);
}

const home: ScreenshotScenario = {
  id: "home-fresh",
  scene: { greeting: [] },
  skins: SKINS,
  viewports: VIEWPORTS,
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toHaveText(COPY.home.title);
    await expect(page.locator(".home-actions button")).toHaveCount(2);
  },
};

const createFresh: ScreenshotScenario = {
  id: "create-fresh",
  scene: { greeting: [] },
  skins: SKINS,
  viewports: VIEWPORTS,
  afterOpen: async (page) => {
    await page.locator("#create-btn").click();
  },
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toHaveText(COPY.create.title);
    await expect(page.locator("#mk-nick")).toBeVisible();
  },
};

const joinFresh: ScreenshotScenario = {
  id: "join-fresh",
  scene: { greeting: [] },
  skins: SKINS,
  viewports: VIEWPORTS,
  afterOpen: async (page) => {
    await page.locator("#join-btn").click();
  },
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toHaveText(COPY.join.title);
    await expect(page.locator("#jn-code")).toBeVisible();
  },
};

const lobbyHostAlone: ScreenshotScenario = {
  id: "lobby-host-alone",
  scene: {
    entry: { mode: "create", nickname: ROSTER[0]!.nickname },
    greeting: lobbyWire([ROSTER[0]!], 1),
  },
  skins: SKINS,
  viewports: VIEWPORTS,
  ready: async (page) => {
    await expect(page.locator("#players .chip")).toHaveCount(1);
    await expect(page.locator("#start-btn")).toBeVisible();
  },
};

const lobbyHostWithGuests: ScreenshotScenario = {
  id: "lobby-host-three-guests",
  scene: {
    entry: { mode: "create", nickname: ROSTER[0]!.nickname },
    greeting: lobbyWire(),
  },
  skins: SKINS,
  viewports: VIEWPORTS,
  ready: async (page) => {
    await expect(page.locator("#players .chip")).toHaveCount(4);
    await expect(page.locator("#players .away")).toHaveText(COPY.lobby.away);
  },
};

const game: ScreenshotScenario = {
  id: "game-digram",
  scene: {
    entry: { mode: "create", nickname: ROSTER[0]!.nickname },
    greeting: gameWire(),
  },
  skins: SKINS,
  viewports: VIEWPORTS,
  ready: async (page) => {
    await expect(page.locator("#board .tile")).toHaveCount(16);
    await expect(page.locator("#countdown")).toHaveText("1:40");
  },
};

const intermissionHost: ScreenshotScenario = {
  id: "intermission-host",
  scene: {
    entry: { mode: "create", nickname: ROSTER[0]!.nickname },
    greeting: intermissionWire(1),
  },
  skins: SKINS,
  viewports: VIEWPORTS,
  ready: async (page) => {
    await expect(page.locator("#reveal .rw")).toHaveCount(7);
    await expect(page.locator("#start-btn")).toBeVisible();
  },
};

const intermissionGuest: ScreenshotScenario = {
  id: "intermission-guest",
  scene: {
    entry: { mode: "create", nickname: ROSTER[0]!.nickname },
    greeting: intermissionWire(2),
  },
  skins: SKINS,
  viewports: VIEWPORTS,
  ready: async (page) => {
    await expect(page.locator("#reveal .rw")).toHaveCount(7);
    await expect(page.locator(".next-round-hint")).toBeVisible();
  },
};

const kicked: ScreenshotScenario = {
  id: "outcome-kicked",
  scene: outcomeScene({ type: "kicked" }),
  skins: SKINS,
  viewports: [PHONE_LARGE],
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toContainText(COPY.outcomes.kicked(ROOM_CODE));
    await expect(page.locator("#home-btn")).toBeVisible();
  },
};

const roomEnded: ScreenshotScenario = {
  id: "outcome-room-ended",
  scene: outcomeScene({ type: "room-ended", reason: "host-closed" }),
  skins: SKINS,
  viewports: [PHONE_LARGE],
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toContainText(COPY.outcomes.ended(ROOM_CODE));
  },
};

const roomExpired: ScreenshotScenario = {
  id: "outcome-room-expired",
  scene: outcomeScene({ type: "room-ended", reason: "expired" }),
  skins: SKINS,
  viewports: [PHONE_LARGE],
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toContainText(COPY.outcomes.expired(ROOM_CODE));
  },
};

const roomNotFound: ScreenshotScenario = {
  id: "outcome-room-not-found",
  scene: {
    path: `/r/${ROOM_CODE}`,
    entry: { mode: "join", nickname: "Jana" },
    greeting: [{ type: "error", code: "room-not-found" }],
  },
  skins: SKINS,
  viewports: [PHONE_LARGE],
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toContainText(COPY.outcomes.notFound(ROOM_CODE));
  },
};

const connectionLost: ScreenshotScenario = {
  id: "outcome-connection-lost",
  scene: {
    entry: { mode: "create", nickname: "Lena" },
    greeting: lobbyWire(ROSTER, 2),
    closeAfterGreeting: { code: 1000, reason: "gone" },
  },
  skins: SKINS,
  viewports: [PHONE_LARGE],
  ready: async (page) => {
    await expect(page.locator("#screen h1")).toHaveText(COPY.outcomes.connectionLost);
  },
};

const overflowChip: ScreenshotScenario = {
  id: "targeted-154-long-standings-chip",
  scene: {
    entry: { mode: "create", nickname: "Lena" },
    greeting: [
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
  skins: SKINS,
  viewports: [PHONE_SMALL],
  ready: async (page) => {
    await expect(page.locator("#players .chip")).toHaveCount(4);
  },
};

const lowTimer: ScreenshotScenario = {
  id: "targeted-low-timer",
  scene: {
    entry: { mode: "create", nickname: "Lena" },
    greeting: [
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
  skins: SKINS,
  viewports: [PHONE_SMALL],
  ready: async (page) => {
    await expect(page.locator("#countdown")).toHaveText("0:15");
    await expect(page.locator("#timer")).toHaveClass(/low/);
  },
};

const choiceTile: ScreenshotScenario = {
  id: "targeted-choice-tile",
  scene: {
    entry: { mode: "create", nickname: "Lena" },
    greeting: gameWire(BOARD_CHOICE),
  },
  skins: SKINS,
  viewports: [PHONE_SMALL],
  ready: async (page) => {
    await expect(page.locator("#board .tile")).toHaveCount(16);
    await expect(page.locator("#board .tile").first()).toContainText("r/s");
  },
};

const tooltip: ScreenshotScenario = {
  id: "targeted-tooltip",
  scene: {
    entry: { mode: "create", nickname: "Lena" },
    greeting: gameWire(),
  },
  skins: SKINS,
  viewports: [PHONE_SMALL],
  afterOpen: async (page) => {
    await page.locator("#board-rotation").hover();
  },
  ready: async (page) => {
    await expect(page.locator("#board-rotation")).toHaveAttribute("aria-label", COPY.game.rotate);
    await expect
      .poll(() => page.locator("#board-rotation").evaluate((el) => getComputedStyle(el, "::after").opacity))
      .toBe("1");
  },
};

const errorNotice: ScreenshotScenario = {
  id: "targeted-error-notice",
  scene: {
    entry: { mode: "create", nickname: "Lena" },
    greeting: [...gameWire(), { type: "error", code: "invalid-word" }],
  },
  skins: SKINS,
  viewports: [PHONE_SMALL],
  ready: async (page) => {
    await expect(page.locator("#notice-error")).toHaveText(COPY.errors.invalidWord);
  },
};

const spectatorGame: ScreenshotScenario = {
  id: "targeted-spectator",
  scene: {
    entry: { mode: "create", nickname: "Lena" },
    greeting: [
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
  skins: SKINS,
  viewports: [PHONE_SMALL],
  ready: async (page) => {
    await expect(page.locator("#screen")).toContainText(COPY.game.spectatorNote);
  },
};

const revealByPoints: ScreenshotScenario = {
  id: "targeted-reveal-points",
  scene: {
    entry: { mode: "create", nickname: "Lena" },
    greeting: intermissionWire(1),
  },
  skins: SKINS,
  viewports: [PHONE_SMALL],
  afterOpen: (page) => revealSorted(page, "points"),
  ready: async (page) => {
    await expect(page.locator("#reveal .rw-word").first()).toHaveText("stein");
  },
};

const revealAlphabetical: ScreenshotScenario = {
  id: "targeted-reveal-alphabet",
  scene: {
    entry: { mode: "create", nickname: "Lena" },
    greeting: intermissionWire(1),
  },
  skins: SKINS,
  viewports: [PHONE_SMALL],
  afterOpen: (page) => revealSorted(page, "alphabet"),
  ready: async (page) => {
    await expect(page.locator("#reveal .rw-word").first()).toHaveText("ast");
  },
};

const fullLobby: ScreenshotScenario = {
  id: "targeted-full-lobby",
  scene: {
    entry: { mode: "create", nickname: "Lena" },
    greeting: lobbyWire(
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
  skins: SKINS,
  viewports: [PHONE_SMALL],
  ready: async (page) => {
    await expect(page.locator("#players .chip")).toHaveCount(8);
    await expect(page.locator("#screen")).toContainText(COPY.lobby.connected(8));
  },
};

const createLocalError: ScreenshotScenario = {
  id: "targeted-create-local-error",
  scene: { greeting: [] },
  skins: SKINS,
  viewports: [PHONE_SMALL],
  afterOpen: submitCreateLocalError,
  ready: async (page) => {
    await expect(page.locator("#notice-error")).toHaveText(COPY.errors.nameRequired);
  },
};

const joinDeepLink: ScreenshotScenario = {
  id: "targeted-join-deep-link",
  scene: { path: `/r/${ROOM_CODE}`, greeting: [] },
  skins: SKINS,
  viewports: [PHONE_SMALL],
  ready: async (page) => {
    await expect(page.locator("#screen")).toContainText(COPY.join.invited(ROOM_CODE));
    await expect(page.locator("#jn-code")).toHaveValue(ROOM_CODE);
    await expect(page.locator("#jn-code")).toHaveAttribute("readonly", "");
  },
};

const lobbyGuest: ScreenshotScenario = {
  id: "targeted-lobby-guest",
  scene: {
    entry: { mode: "create", nickname: "Lena" },
    greeting: lobbyWire(ROSTER, 2),
  },
  skins: SKINS,
  viewports: [PHONE_SMALL],
  ready: async (page) => {
    await expect(page.locator(".next-round-hint")).toHaveCount(0);
    await expect(page.locator("#screen")).toContainText(COPY.lobby.waiting);
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
  choiceTile,
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
