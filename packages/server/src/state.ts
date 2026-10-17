/**
 * Room and seat domain types. Server-internal: never inspected by tests,
 * which see only the wire seam.
 */
import type { RoomPhase, RevealPayload } from "@wortschatz/shared";
import { PROTOCOL } from "@wortschatz/shared";
import type { WebSocket } from "ws";

export interface Seat {
  seatId: number;
  nickname: string;
  role: "player" | "spectator";
  cumulativeScore: number;
  /** Opaque room-lifetime token; an auto-released seat's token is dead. */
  token: string;
  present: boolean;
  sockets: Set<WebSocket>;
  /** Epoch-ms of seat creation; join order for host transfer. */
  joinedAt: number;
  /** Set when absent from a round; the seat auto-releases after a full round+intermission missed. */
  absentRound: number | null;
  autoReleased: boolean;
  /** Per-round accepted words (dedupe). */
  roundWords: Set<string>;
  roundScore: number;
}

export interface Room {
  code: string;
  phase: RoomPhase;
  hostSeatId: number;
  roundNumber: number;
  board: string[];
  /** 64-bit board generation seed for the current round; logged, never shared. */
  seed: bigint;
  /** Enumerated findable words for the current round; the reveal reuses it. */
  words: string[];
  deadline: number;
  seats: Map<number, Seat>;
  nextSeatId: number;
  reveal: RevealPayload | null;
  wordsBySeat: Map<number, string[]>;
  lastActivity: number;
  closing: boolean;
}

export function makeRoomCode(length: number = PROTOCOL.ROOM_CODE_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PROTOCOL.ROOM_CODE_ALPHABET[Math.floor(Math.random() * PROTOCOL.ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

export function makeToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
