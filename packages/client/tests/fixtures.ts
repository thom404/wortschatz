import type {
  PlayerInfo,
  PlayerJoinedMsg,
  RevealPayload,
  RoundEndMsg,
  RoundStartMsg,
  SnapshotMsg,
  TickMsg,
  WikiLinksMsg,
} from "@wortschatz/shared";

/**
 * DOM-free server-message fixtures shared by the Vitest mount harness and the
 * Playwright visual suite (#156). Both layers script the same WebSocket
 * boundary with the same wire shapes, so they cannot drift.
 */
export type { PlayerInfo };

/** Rooms are small; fixtures use explicit seats. Seat 1 holds the host by
 *  default — the creator of a room is its first host. */
function player(opts: { seatId: number; nickname: string; connected?: boolean }) {
  return seat(opts);
}

/** One seat of a room's roster, with every player-chip dimension named:
 *  nickname, role and connected state (cumulative score on request). */
export function seat(opts: {
  seatId: number;
  nickname: string;
  role?: "player" | "spectator";
  connected?: boolean;
  cumulativeScore?: number;
}): PlayerInfo {
  return {
    seatId: opts.seatId,
    nickname: opts.nickname,
    role: opts.role ?? "player",
    cumulativeScore: opts.cumulativeScore ?? 0,
    connected: opts.connected ?? true,
  };
}

/** Lobby snapshot: the creator alone in the room, waiting for joiners —
 *  or a hand-picked roster for chip/seat tests. A lobby roster is always
 *  join-ordered (the server appends each new seat). */
export function lobbySnapshot(opts: {
  code: string;
  nickname: string;
  seatId?: number;
  hostSeatId?: number;
  players?: PlayerInfo[];
}): SnapshotMsg {
  const seatId = opts.seatId ?? 1;
  return {
    type: "snapshot",
    room: {
      code: opts.code,
      phase: "lobby",
      hostSeatId: opts.hostSeatId ?? seatId,
      roundNumber: 0,
    },
    self: { seatId, nickname: opts.nickname, role: "player", cumulativeScore: 0, token: "t-1" },
    players: opts.players ?? [player({ seatId, nickname: opts.nickname })],
  };
}

/** Snapshot deep in a running round: `self` sits as a named role and must
 *  see the game screen the server's truth prescribes. */
export function playingSnapshot(opts: {
  code: string;
  selfSeatId: number;
  nickname: string;
  role: "player" | "spectator";
  board: readonly string[];
  roundNumber?: number;
  players?: PlayerInfo[];
  /** Absolute deadline; defaults to a round from now. */
  deadline?: number;
}): SnapshotMsg {
  const players = opts.players ?? [
    seat({ seatId: 1, nickname: "Lena" }),
    seat({
      seatId: opts.selfSeatId,
      nickname: opts.nickname,
      role: opts.role,
    }),
  ];
  return {
    type: "snapshot",
    room: { code: opts.code, phase: "playing", hostSeatId: 1, roundNumber: opts.roundNumber ?? 1 },
    self: {
      seatId: opts.selfSeatId,
      nickname: opts.nickname,
      role: opts.role,
      cumulativeScore: 0,
    },
    players,
    round: {
      roundNumber: opts.roundNumber ?? 1,
      board: [...opts.board],
      deadline: opts.deadline ?? Date.now() + 120_000,
    },
  };
}

/** Someone takes a seat next to you (a delta, not a snapshot). */
export function playerJoined(seatId: number, nickname: string): PlayerJoinedMsg {
  return { type: "player-joined", player: player({ seatId, nickname }) };
}

/** Round start: the server owns the board and the deadline. */
export function roundStarted(
  board: readonly string[],
  roundNumber = 1,
  deadline = Date.now() + 120_000
): RoundStartMsg {
  return {
    type: "round-start",
    round: { roundNumber, board: [...board], deadline },
  };
}

/** Round end: the room-wide reveal, grouped by length ascending (#17). */
export function roundEnded(roundNumber: number, reveal: RevealPayload): RoundEndMsg {
  return { type: "round-end", roundNumber, reveal };
}

/** One 1 Hz re-anchor of the round clock. */
export function tick(remaining: number, deadline = Date.now() + remaining): TickMsg {
  return { type: "tick", remaining, deadline };
}

/** Late-arriving exact-form Wiktionary links for the finished reveal. */
export function wikiLinks(roundNumber: number, links: Record<string, string>): WikiLinksMsg {
  return { type: "wiki-links", roundNumber, links };
}

/** A snapshot taken mid-intermission — the late-joiner / reconnect channel:
 *  the full standing roster plus the finished round (board + reveal). */
export function intermissionSnapshot(opts: {
  code: string;
  selfSeatId: number;
  nickname: string;
  role?: "player" | "spectator";
  hostSeatId?: number;
  roundNumber?: number;
  board: readonly string[];
  reveal: RevealPayload;
  /** Resolved exact-form Wiktionary URLs for the reveal, if any. */
  links?: Record<string, string>;
  players?: PlayerInfo[];
  /** The pause has no clock: the snapshot's deadline is always zero. */
  deadline?: number;
}): SnapshotMsg {
  const hostSeatId = opts.hostSeatId ?? 1;
  const roundNumber = opts.roundNumber ?? 1;
  const selfSeat = seat({
    seatId: opts.selfSeatId,
    nickname: opts.nickname,
    role: opts.role ?? "player",
  });
  return {
    type: "snapshot",
    room: { code: opts.code, phase: "intermission", hostSeatId, roundNumber },
    self: { ...selfSeat, cumulativeScore: 0, token: "t-2" },
    players: opts.players ?? [seat({ seatId: hostSeatId, nickname: "Lena" }), selfSeat],
    finishedRound: {
      roundNumber,
      board: [...opts.board],
      reveal: opts.reveal,
      ...(opts.links ? { links: opts.links } : {}),
      deadline: opts.deadline ?? 0,
    },
  };
}
