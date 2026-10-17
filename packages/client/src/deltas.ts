import type { GameStore } from "./store.js";
import type { SnapshotMsg, ServerMessage } from "@wortschatz/shared";

/**
 * Local countdown interpolation, per spec: clients never own the clock. The
 * server re-anchors every second with a `tick`; between ticks the renderer
 * interpolates against the last-known absolute deadline. A locally expired
 * countdown clamps at 0 and waits for the server's next message — phases
 * change only upon server messages, never self-transitioned.
 */
export function remainingOf(store: GameStore): number {
  if (store.phase !== "playing" && store.phase !== "intermission") return 0;
  if (!store.deadline) return 0;
  return Math.max(0, store.deadline - Date.now());
}

export function fmt(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** At ≤ 20 s remaining, the countdown takes the low-time look (ADR-0002):
 *  one shared class for digits and ring, coloured through `--ping`. */
export const LOW_TIME_MS = 20_000;

export function applyDelta(store: GameStore, msg: ServerMessage): void {
  switch (msg.type) {
    case "snapshot":
      store.applySnapshot(msg as SnapshotMsg);
      break;
    case "tick":
      store.phase = msg.phase;
      store.deadline = msg.deadline;
      break;
    case "round-start":
      store.phase = "playing";
      store.roundNumber = msg.round.roundNumber;
      store.round = msg.round;
      store.deadline = msg.round.deadline;
      store.roundWords = new Map();
      store.roundScores.clear();
      break;
    case "round-end":
      store.phase = "intermission";
      store.roundNumber = msg.roundNumber;
      store.finishedRound = {
        roundNumber: msg.roundNumber,
        reveal: msg.reveal,
      };
      break;
    case "score-update":
      store.applyScores(msg.roundNumber, msg.scores);
      break;
    case "player-joined":
      store.upsertPlayer(msg.player);
      break;
    case "player-left":
      store.removePlayer(msg.seatId);
      break;
    case "player-disconnected":
      store.setConnected(msg.seatId, false);
      break;
    case "host-changed":
      store.hostSeatId = msg.hostSeatId;
      break;
    case "word-accepted":
      store.acceptedForMe(msg.word, msg.points);
      break;
    case "error":
      store.lastError = msg;
      break;
    case "kicked":
      store.outcome = "kicked";
      break;
    case "room-ended":
      store.outcome = "room-ended";
      break;
    default:
      break;
  }
  store.notify();
}
