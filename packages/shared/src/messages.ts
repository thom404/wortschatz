/**
 * The wire contract: every message that can travel over the WebSocket in
 * either direction, discriminated by `type`. This is the single source of
 * truth; server and client both consume it and so cannot drift apart.
 *
 * Envelope rules:
 * - Client→server requests may carry `reqId` (client-chosen monotonic
 *   integer). The server echoes `reqId` verbatim on the correlated reply
 *   when present; it never interprets it.
 * - Server→client messages are deltas or re-anchors; a full `snapshot`
 *   always supersedes them on join/reconnect/resync.
 */
import type { Board } from "./board.js";
import type { ErrorCode, ErrorEnvelope } from "./errors.js";

/* ------------------------------------------------------------------ */
/* Client → server                                                     */
/* ------------------------------------------------------------------ */

export interface CreateRoomMsg {
  type: "create-room";
  nickname: string;
  reqId?: number | undefined;
}

export interface JoinMsg {
  type: "join";
  code: string;
  nickname: string;
  /** Session token from a previous connection of this room; optional. */
  token?: string | undefined;
  reqId?: number | undefined;
}

/** The first client message on a connection: create a room or join one. */
export type GreetingMsg = CreateRoomMsg | JoinMsg;

export interface SubmitWordMsg {
  type: "submit-word";
  word: string;
  /** The other reading of a choice tile on the path, when there is one. The
   *  server tries both and accepts the best valid word (ADR-0027). */
  alternate?: string | undefined;
  reqId?: number | undefined;
}

export interface StartRoundMsg {
  type: "start-round";
  reqId?: number | undefined;
}

export interface KickMsg {
  type: "kick";
  seatId: number;
  reqId?: number | undefined;
}

export interface TransferHostMsg {
  type: "transfer-host";
  seatId: number;
  reqId?: number | undefined;
}

export interface LeaveMsg {
  type: "leave";
  reqId?: number | undefined;
}

export interface CloseRoomMsg {
  type: "close-room";
  reqId?: number | undefined;
}

export interface ResyncMsg {
  type: "resync";
  reqId?: number | undefined;
}

export type ClientMessage =
  | GreetingMsg
  | SubmitWordMsg
  | StartRoundMsg
  | KickMsg
  | TransferHostMsg
  | LeaveMsg
  | CloseRoomMsg
  | ResyncMsg;

/* ------------------------------------------------------------------ */
/* Server → client                                                     */
/* ------------------------------------------------------------------ */

/** The complete authoritative state, always sent whole. */
export interface SnapshotMsg {
  type: "snapshot";
  reqId?: number | undefined;
  room: RoomInfo;
  self: SelfInfo;
  players: PlayerInfo[];
  /** Present only while the room phase is `playing`. */
  round?: RoundInfo;
  /** Present only while the room phase is `intermission`. */
  finishedRound?: FinishedRoundInfo;
}

/** Why a room ended — the one word of server truth the end screen
 *  renders (client outcome screens, #21). */
export type RoomEndReason = "host-closed" | "expired" | "no-players" | "server-shutdown";

export interface RoomsEndedMsg {
  type: "room-ended";
  reason: RoomEndReason;
}

/** 1 Hz re-anchor of the round clock; only ever sent while `playing`. */
export interface TickMsg {
  type: "tick";
  remaining: number;
  deadline: number;
}

export interface RoundStartMsg {
  type: "round-start";
  round: RoundInfo;
}

/** Round-end broadcast: the findable-word reveal (#17 concrete shape). */
export interface RoundEndMsg {
  type: "round-end";
  roundNumber: number;
  reveal: RevealPayload;
}

/** Player-chip broadcast after every accepted verdict (and on snapshot). */
export interface ScoreUpdateMsg {
  type: "score-update";
  roundNumber: number;
  scores: ScoreEntry[];
}

/** Wiktionary links for the finished round's reveal, keyed by exact word
 *  form. Sent after `round-end` when the server-side lookup resolves; an
 *  empty mapping is never sent. */
export interface WikiLinksMsg {
  type: "wiki-links";
  roundNumber: number;
  links: Record<string, string>;
}

export interface PlayerJoinedMsg {
  type: "player-joined";
  player: PlayerInfo;
}

export interface PlayerLeftMsg {
  type: "player-left";
  seatId: number;
  nickname: string;
}

export interface PlayerDisconnectedMsg {
  type: "player-disconnected";
  seatId: number;
  nickname: string;
}

export interface HostChangedMsg {
  type: "host-changed";
  hostSeatId: number;
}

export interface KickedMsg {
  type: "kicked";
}

/** Synchronous verdict to a `submit-word`. */
export interface WordAcceptedMsg {
  type: "word-accepted";
  reqId?: number | undefined;
  word: string;
  points: number;
}

export interface ServerErrorMsg {
  type: "error";
  /** Echoed from the correlated request when the client supplied one. */
  reqId?: number | undefined;
  code: ErrorCode;
  message?: string;
}

export type ServerMessage =
  | SnapshotMsg
  | RoomsEndedMsg
  | TickMsg
  | RoundStartMsg
  | RoundEndMsg
  | ScoreUpdateMsg
  | WikiLinksMsg
  | PlayerJoinedMsg
  | PlayerLeftMsg
  | PlayerDisconnectedMsg
  | HostChangedMsg
  | KickedMsg
  | WordAcceptedMsg
  | ServerErrorMsg;

/** Convenience alias: an error message is the typed error envelope. */
export type ErrorEnvelopeMsg = ServerErrorMsg;
export type { ErrorEnvelope };

/* ------------------------------------------------------------------ */
/* Shared sub-shapes                                                   */
/* ------------------------------------------------------------------ */

export interface RoomInfo {
  code: string;
  phase: RoomPhase;
  hostSeatId: number;
  roundNumber: number;
}

export interface SelfInfo {
  seatId: number;
  nickname: string;
  role: PlayerRole;
  cumulativeScore: number;
  /** Present on join/reconnect replies: reclaim key for this seat. */
  token?: string | undefined;
}

export interface PlayerInfo {
  seatId: number;
  nickname: string;
  role: PlayerRole;
  cumulativeScore: number;
  connected: boolean;
}

export interface RoundInfo {
  roundNumber: number;
  board: Board;
  /** Absolute epoch-ms deadline of the current round. */
  deadline: number;
}

export interface FinishedRoundInfo {
  roundNumber: number;
  board: Board;
  reveal: RevealPayload;
  /** Exact-form German Wiktionary URLs by reveal word, once the lookup has
   *  resolved; absent when no word has an entry (or it is still pending). */
  links?: Record<string, string> | undefined;
  /** Zero: the host-paced pause has no deadline. */
  deadline: number;
}

export interface ScoreEntry {
  seatId: number;
  nickname: string;
  roundScore: number;
  cumulativeScore: number;
}

/**
 * End-of-round reveal (#6/#17): every findable word of the finished board,
 * grouped by word length ascending; each word priced by the scoring engine
 * and annotated with the seat ids that found it. Missed words are present
 * with an empty `foundBy`. No tile paths, no first-finder credit.
 */
export interface RevealPayload {
  groups: RevealGroup[];
}

export interface RevealGroup {
  length: number;
  words: RevealWord[];
}

export interface RevealWord {
  word: string;
  points: number;
  foundBy: number[];
}

export type RoomPhase = "lobby" | "playing" | "intermission" | "closed";
export type PlayerRole = "player" | "spectator";

export type { Board };
