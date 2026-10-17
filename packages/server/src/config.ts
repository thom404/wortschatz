/**
 * Server configuration. Clock constants are injectable so integration tests
 * run real timers at scaled-down durations; the domain collaborators
 * (dictionary, board generation, scoring/reveal) are opaque injected seams
 * owned by tickets #7 and #6 — this wire-spec ticket fixes only their shape.
 */
import { PROTOCOL } from "@wortschatz/shared";
import type { RevealPayload } from "@wortschatz/shared";
import { randomBytes } from "node:crypto";

/** Opaque dictionary seam (deep module per ADR-0001; ticket #7 owns impl). */
export interface DictionaryLike {
  isValid(word: string): boolean;
}

/** Board seam: real generation result per round (ticket #7 owns generation). */
export interface BoardResult {
  board: string[];
  /** Enumerated distinct words; kept in round state for the reveal (#6). */
  words: string[];
}

/** Board seam: a fresh board per round from one 64-bit seed; pure (ADR-0003 §10). */
export type BoardGenerator = (seed: bigint) => BoardResult;

/** Seed seam: one 64-bit crypto seed per room per round (injectable for tests). */
export type SeedSource = () => bigint;

/** Scoring seam (ticket #6 owns the formula). */
export type ScoreFn = (word: string, seatId: number) => number;

/** Round-end reveal seam (#6/#17): computes the concrete payload from the
 *  round's enumerated findable words and the per-seat found words. */
export type RevealFn = (ctx: {
  /** Enumerated distinct findable words for the round (ADR-0003 retention). */
  words: string[];
  wordsBySeat: Map<number, string[]>;
  /** The shared per-word price, straight from the scoring engine that
   *  awarded each submission (#6: identical for every seat). */
  points: (word: string) => number;
}) => RevealPayload;

export interface Logger {
  info(obj: Record<string, unknown>): void;
  warn(obj: Record<string, unknown>): void;
  error(obj: Record<string, unknown>): void;
}

export interface ServerConfig {
  port: number;
  host?: string;
  /** Absolute path of the SPA build to serve at `/` (deep links included). */
  staticDir?: string;

  /** Injectable domain seams. */
  dictionary: DictionaryLike;
  generateBoard: BoardGenerator;
  scoreWord: ScoreFn;
  reveal: RevealFn;

  /** Seed draw for board generation; defaults to `crypto` randomness. */
  seedSource?: SeedSource;

  /** Clock overrides (ms). Defaults come from `PROTOCOL`. */
  roundMs?: number;
  intermissionMs?: number;
  tickIntervalMs?: number;
  roomEmptyGraceMs?: number;
  roomIdleMs?: number;

  /** Hardening overrides. */
  maxPayloadBytes?: number;
  quotaWindowMs?: number;
  quotaMaxMessages?: number;
  pingIntervalMs?: number;
  pongGraceMs?: number;
  maxPlayers?: number;
  maxRooms?: number;
  roomCodeLength?: number;

  /** Structured logger; defaults to JSON lines on stdout. */
  log?: Logger;
}

export type ServerConfigResolved = Required<
  Pick<
    ServerConfig,
    | "port"
    | "roundMs"
    | "intermissionMs"
    | "tickIntervalMs"
    | "roomEmptyGraceMs"
    | "roomIdleMs"
    | "maxPayloadBytes"
    | "quotaWindowMs"
    | "quotaMaxMessages"
    | "pingIntervalMs"
    | "pongGraceMs"
    | "maxPlayers"
    | "maxRooms"
    | "roomCodeLength"
  >
> & {
  host?: string;
  staticDir?: string;
  dictionary: DictionaryLike;
  generateBoard: BoardGenerator;
  scoreWord: ScoreFn;
  reveal: RevealFn;
  seedSource: SeedSource;
  log: Logger;
};

function envPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") return 3000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

export function resolveConfig(overrides: ServerConfig): ServerConfigResolved {
  return {
    port: overrides.port ?? envPort(),
    ...(overrides.host !== undefined ? { host: overrides.host } : {}),
    ...(overrides.staticDir !== undefined ? { staticDir: overrides.staticDir } : {}),
    dictionary: overrides.dictionary,
    generateBoard: overrides.generateBoard,
    scoreWord: overrides.scoreWord,
    reveal: overrides.reveal,
    seedSource: overrides.seedSource ?? ((): bigint => randomBytes(8).readBigUInt64BE(0)),
    roundMs: overrides.roundMs ?? PROTOCOL.ROUND_MS,
    intermissionMs: overrides.intermissionMs ?? PROTOCOL.INTERMISSION_MS,
    tickIntervalMs: overrides.tickIntervalMs ?? PROTOCOL.TICK_INTERVAL_MS,
    roomEmptyGraceMs: overrides.roomEmptyGraceMs ?? PROTOCOL.ROOM_EMPTY_GRACE_MS,
    roomIdleMs: overrides.roomIdleMs ?? PROTOCOL.ROOM_IDLE_MS,
    maxPayloadBytes: overrides.maxPayloadBytes ?? PROTOCOL.MAX_PAYLOAD_BYTES,
    quotaWindowMs: overrides.quotaWindowMs ?? PROTOCOL.QUOTA_WINDOW_MS,
    quotaMaxMessages: overrides.quotaMaxMessages ?? PROTOCOL.QUOTA_MAX_MESSAGES,
    pingIntervalMs: overrides.pingIntervalMs ?? PROTOCOL.PING_INTERVAL_MS,
    pongGraceMs: overrides.pongGraceMs ?? PROTOCOL.PONG_GRACE_MS,
    maxPlayers: overrides.maxPlayers ?? PROTOCOL.MAX_PLAYERS,
    maxRooms: overrides.maxRooms ?? PROTOCOL.MAX_ROOMS,
    roomCodeLength: overrides.roomCodeLength ?? PROTOCOL.ROOM_CODE_LENGTH,
    log: overrides.log ?? {
      info: (o) => console.log(JSON.stringify({ level: "info", ts: Date.now(), ...o })),
      warn: (o) => console.warn(JSON.stringify({ level: "warn", ts: Date.now(), ...o })),
      error: (o) => console.error(JSON.stringify({ level: "error", ts: Date.now(), ...o })),
    },
  };
}
