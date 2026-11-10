/**
 * The local solo authority (ADR-0031). It satisfies the same `RoomConn` port
 * as the WebSocket adapter, but owns a one-player session entirely in memory:
 * board generation, the word rule, the absolute local deadline, the tick, the
 * reveal, the round score and the cumulative score. It never opens a socket.
 *
 * The messages it emits are the existing **Wire protocol** shapes, so the
 * store, Game, Intermission, drag, timer and reveal need no solo branch.
 */
import {
  PROTOCOL,
  type ClientMessage,
  type PlayerInfo,
  type RevealPayload,
  type ServerMessage,
  type SnapshotMsg,
} from "@wortschatz/shared";
import {
  generateBoard,
  revealAll,
  submissionVerdict,
  wordScore,
  type BoardResult,
  type Dictionary,
} from "@wortschatz/engine";
import type { ConnectionOptions, GreetFn, RoomConn } from "./connection.js";

/** The one player id a solo session ever uses. */
export const SOLO_SEAT_ID = 1;
/** The one rendered player name in solo mode. */
export const SOLO_NICKNAME = "Du";

/** Injectable local clock and seed, so tests can drive solo without waiting. */
export interface SoloClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemSoloClock: SoloClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface SoloOptions {
  /** The deserialized artifact; the only data solo needs. */
  dictionary: Pick<Dictionary, "isValid" | "findWords">;
  clock?: SoloClock;
  seedSource?: () => bigint;
  roundMs?: number;
  tickIntervalMs?: number;
  /** Deterministic board seam for tests; production uses the shared engine. */
  generateBoard?: (seed: bigint, dictionary: SoloOptions["dictionary"]) => BoardResult;
}

export interface SoloConnectionOptions extends Omit<ConnectionOptions, "greet">, SoloOptions {
  /** Solo sends no greeting; accepted for interface symmetry with rooms. */
  greet?: GreetFn;
}

/** One in-memory solo session. */
export class SoloConnection implements RoomConn {
  private readonly dictionary: SoloOptions["dictionary"];
  private readonly clock: SoloClock;
  private readonly seedSource: () => bigint;
  private readonly roundMs: number;
  private readonly tickIntervalMs: number;
  private readonly boardGenerator: NonNullable<SoloOptions["generateBoard"]>;
  private readonly listener: ConnectionOptions["listener"];
  private readonly onStatus: ConnectionOptions["onStatus"];

  private started = false;
  private stopped = false;
  private nextReqId = 1;
  private phase: "lobby" | "playing" | "intermission" = "lobby";
  private roundNumber = 0;
  private board: string[] = [];
  private words: string[] = [];
  private deadline = 0;
  private roundScore = 0;
  private cumulativeScore = 0;
  private found = new Set<string>();
  private reveal: RevealPayload | null = null;
  private deadlineTimer: unknown = null;
  private tickTimer: unknown = null;

  constructor(opts: SoloConnectionOptions) {
    this.dictionary = opts.dictionary;
    this.clock = opts.clock ?? systemSoloClock;
    this.seedSource =
      opts.seedSource ??
      (() => {
        const bytes = new Uint8Array(8);
        if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
        else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
        let seed = 0n;
        for (const byte of bytes) seed = (seed << 8n) | BigInt(byte);
        return seed;
      });
    this.roundMs = opts.roundMs ?? PROTOCOL.ROUND_MS;
    this.tickIntervalMs = opts.tickIntervalMs ?? PROTOCOL.TICK_INTERVAL_MS;
    this.boardGenerator = opts.generateBoard ?? ((seed, dictionary) => generateBoard(seed, dictionary));
    this.listener = opts.listener;
    this.onStatus = opts.onStatus;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.onStatus("open");
    this.emit(this.snapshot());
    this.beginRound();
  }

  request<T extends Omit<ClientMessage, "reqId">>(msg: T): number {
    const reqId = this.nextReqId++;
    this.dispatch({ ...msg, reqId } as ClientMessage);
    return reqId;
  }

  send(msg: Omit<ClientMessage, "reqId"> & { reqId?: number }): void {
    this.dispatch(msg as ClientMessage);
  }

  resync(): void {
    if (!this.started || this.stopped) return;
    this.emit(this.snapshot());
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
  }

  private dispatch(msg: ClientMessage): void {
    if (!this.started || this.stopped) return;
    if (msg.type === "submit-word") return this.submit(msg);
    if (msg.type === "start-round") return this.startNextRound(msg.reqId);
    if (msg.type === "resync") return this.resync();
    // Solo has no room, seat or host commands; leave/stop is owned by the
    // shell, which discards the session by returning Home.
  }

  private submit(msg: Extract<ClientMessage, { type: "submit-word" }>): void {
    if (this.phase !== "playing" || this.clock.now() >= this.deadline) {
      this.error("round-over", msg.reqId);
      return;
    }
    const verdict = submissionVerdict({
      word: msg.word,
      ...(msg.alternate !== undefined ? { alternate: msg.alternate } : {}),
      board: this.board,
      dictionary: this.dictionary,
      foundWords: this.found,
      points: (word) => wordScore(word),
    });
    if (verdict.kind === "rejected") {
      this.error(verdict.code, msg.reqId, verdict.detail);
      return;
    }
    this.found.add(verdict.word);
    this.roundScore += verdict.points;
    this.cumulativeScore += verdict.points;
    this.emit({
      type: "word-accepted",
      ...(msg.reqId !== undefined ? { reqId: msg.reqId } : {}),
      word: verdict.word,
      points: verdict.points,
    });
    this.emitScores();
  }

  private startNextRound(reqId?: number): void {
    if (this.phase !== "intermission") {
      this.error("invalid-phase", reqId);
      return;
    }
    this.beginRound();
  }

  private beginRound(): void {
    this.roundNumber += 1;
    this.phase = "playing";
    const generated: BoardResult = this.boardGenerator(this.seedSource(), this.dictionary);
    this.board = generated.board;
    this.words = generated.words;
    this.deadline = this.clock.now() + this.roundMs;
    this.found = new Set();
    this.roundScore = 0;
    this.reveal = null;
    this.emit({
      type: "round-start",
      round: { roundNumber: this.roundNumber, board: [...this.board], deadline: this.deadline },
    });
    this.emitTick();
    this.emitScores();
    this.armDeadline();
    this.armTick();
  }

  private endRound(): void {
    if (this.phase !== "playing") return;
    this.phase = "intermission";
    this.deadline = 0;
    this.clearTimers();
    this.reveal = revealAll({
      words: this.words,
      wordsBySeat: new Map([[SOLO_SEAT_ID, [...this.found]]]),
      points: wordScore,
    });
    this.emit({ type: "round-end", roundNumber: this.roundNumber, reveal: this.reveal });
  }

  private armDeadline(): void {
    this.clearDeadlineTimer();
    const remain = Math.max(0, this.deadline - this.clock.now());
    this.deadlineTimer = this.clock.setTimeout(() => {
      this.deadlineTimer = null;
      if (this.stopped || this.phase !== "playing") return;
      // A late fire may never extend the deadline; an early fire re-arms.
      if (this.clock.now() < this.deadline - 25) {
        this.armDeadline();
        return;
      }
      this.endRound();
    }, remain);
  }

  private armTick(): void {
    this.clearTickTimer();
    this.tickTimer = this.clock.setTimeout(() => {
      this.tickTimer = null;
      if (this.stopped || this.phase !== "playing") return;
      this.emitTick();
      this.armTick();
    }, this.tickIntervalMs);
  }

  private emitTick(): void {
    this.emit({
      type: "tick",
      remaining: Math.max(0, this.deadline - this.clock.now()),
      deadline: this.deadline,
    });
  }

  private emitScores(): void {
    this.emit({
      type: "score-update",
      roundNumber: this.roundNumber,
      scores: [
        {
          seatId: SOLO_SEAT_ID,
          nickname: SOLO_NICKNAME,
          roundScore: this.roundScore,
          cumulativeScore: this.cumulativeScore,
        },
      ],
    });
  }

  private snapshot(): SnapshotMsg {
    const player: PlayerInfo = {
      seatId: SOLO_SEAT_ID,
      nickname: SOLO_NICKNAME,
      role: "player",
      cumulativeScore: this.cumulativeScore,
      connected: true,
    };
    const snap: SnapshotMsg = {
      type: "snapshot",
      room: {
        code: "",
        phase: this.phase,
        hostSeatId: SOLO_SEAT_ID,
        roundNumber: this.roundNumber,
      },
      self: {
        seatId: SOLO_SEAT_ID,
        nickname: SOLO_NICKNAME,
        role: "player",
        cumulativeScore: this.cumulativeScore,
      },
      players: [player],
    };
    if (this.phase === "playing") {
      snap.round = { roundNumber: this.roundNumber, board: [...this.board], deadline: this.deadline };
    }
    if (this.phase === "intermission" && this.reveal) {
      snap.finishedRound = {
        roundNumber: this.roundNumber,
        board: [...this.board],
        reveal: this.reveal,
        deadline: 0,
      };
    }
    return snap;
  }

  private error(
    code: Extract<ServerMessage, { type: "error" }>["code"],
    reqId?: number,
    detail?: string
  ): void {
    this.emit({
      type: "error",
      ...(reqId !== undefined ? { reqId } : {}),
      code,
      ...(detail !== undefined ? { message: detail } : {}),
    });
  }

  private emit(msg: ServerMessage): void {
    if (!this.stopped) this.listener(msg);
  }

  private clearTimers(): void {
    this.clearDeadlineTimer();
    this.clearTickTimer();
  }

  private clearDeadlineTimer(): void {
    if (this.deadlineTimer !== null) this.clock.clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
  }

  private clearTickTimer(): void {
    if (this.tickTimer !== null) this.clock.clearTimeout(this.tickTimer);
    this.tickTimer = null;
  }
}

/** The shell seam: a dictionary-bound connection factory for one solo visit. */
export function createSoloConnFactory(
  dictionary: Pick<Dictionary, "isValid" | "findWords">
): (opts: ConnectionOptions) => RoomConn {
  return (opts) => new SoloConnection({ ...opts, dictionary });
}
