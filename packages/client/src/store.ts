import type {
  PlayerInfo,
  ScoreEntry,
  ServerMessage,
  SnapshotMsg,
  ErrorCode,
  RevealPayload,
} from "@wortschatz/shared";

/**
 * Client state. Built ONLY from server messages (snapshot + deltas); never
 * reconstructs state by replaying deltas — a snapshot always supersedes.
 * `apply` is the single reducer: every server message reaches client state
 * through it, and it returns the render consequence.
 */
export type Outcome = "none" | "kicked" | "room-ended";

/**
 * The render consequence of one store change. A play-time delta updates
 * live, already-rendered game state **in place** — the countdown, the
 * scoreboard and the private found-word chips — so the ring timer keeps its
 * identity; a structural change rebuilds the whole screen. Tick,
 * score-update and word-accepted are play-time deltas.
 * See [GLOSSARY](../GLOSSARY.md): Play-time delta.
 */
export type DeltaKind = "play-time" | "structural";

/**
 * Classifies one server message for rendering (ADR-0009): a play-time delta
 * changes only live, already-rendered game state and must update in place;
 * every other message is a structural change that rebuilds the screen.
 */
export function deltaKind(msg: ServerMessage): DeltaKind {
  return msg.type === "tick" || msg.type === "score-update" || msg.type === "word-accepted"
    ? "play-time"
    : "structural";
}

/** The scoreboard's and the standings' shared ranking fabric: order by an
 *  ascending-score key descending, ties staying in join order (the roster
 *  array's order), then standard competition ranking over the result — a
 *  later, better score restarts the count after shared places. */
function orderPlayers(
  players: PlayerInfo[],
  key: (p: PlayerInfo) => number
): { player: PlayerInfo; index: number; key: number }[] {
  return players
    .map((player, index) => ({ player, index, key: key(player) }))
    .sort((a, b) => b.key - a.key || a.index - b.index);
}

function competitionPlaces(ordered: { key: number }[], score: (e: { key: number }) => number): number[] {
  const places: number[] = [];
  let place = 1;
  let prev: number | null = null;
  ordered.forEach((entry, idx) => {
    const value = score(entry);
    if (prev !== null && value !== prev) place = idx + 1;
    prev = value;
    places.push(place);
  });
  return places;
}

export class GameStore {
  code = "";
  phase: "lobby" | "playing" | "intermission" | "closed" = "lobby";
  hostSeatId = -1;
  roundNumber = 0;
  self: { seatId: number; nickname: string; role: "player" | "spectator"; cumulativeScore: number } = {
    seatId: -1,
    nickname: "",
    role: "player",
    cumulativeScore: 0,
  };
  players: PlayerInfo[] = [];
  /** Per-seat round score of the live or just-finished round — the
   *  scoreboard's ranking key and the timer's centered value. Comes from
   *  room-wide `score-update`s; absent seats count as 0. Cleared on
   *  snapshot and round start. */
  roundScores = new Map<number, number>();
  round: { roundNumber: number; board: string[]; deadline: number } | null = null;
  /** Round number + reveal of the finished round; the board itself stays in
   *  `round` (a bare `round-end` delta carries no board). */
  finishedRound: { roundNumber: number; reveal: RevealPayload } | null = null;
  deadline = 0;
  /** My score for THIS round alone — the ring timer's centered value. One
   *  state, not two: it reads the scoreboard map's entry for my seat. */
  get selfRoundScore(): number {
    return this.roundScores.get(this.self.seatId) ?? 0;
  }
  roundWords = new Map<string, number>();
  lastError: { code: ErrorCode; message?: string } | null = null;
  outcome: Outcome = "none";

  private listeners = new Set<(kind: DeltaKind) => void>();

  subscribe(fn: (kind: DeltaKind) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(kind: DeltaKind = "structural"): void {
    for (const fn of this.listeners) fn(kind);
  }

  /** The single reducer: applies one server message to client state,
   *  notifies subscribers with its render consequence and returns that
   *  classification. A snapshot always supersedes earlier deltas. */
  apply(msg: ServerMessage): DeltaKind {
    switch (msg.type) {
      case "snapshot":
        this.applySnapshot(msg);
        break;
      case "tick":
        this.deadline = msg.deadline;
        break;
      case "round-start":
        this.phase = "playing";
        this.roundNumber = msg.round.roundNumber;
        this.round = msg.round;
        this.deadline = msg.round.deadline;
        this.roundWords = new Map();
        this.roundScores.clear();
        break;
      case "round-end":
        this.phase = "intermission";
        this.roundNumber = msg.roundNumber;
        this.deadline = 0;
        this.finishedRound = {
          roundNumber: msg.roundNumber,
          reveal: msg.reveal,
        };
        break;
      case "score-update":
        this.applyScores(msg.roundNumber, msg.scores);
        break;
      case "player-joined":
        this.upsertPlayer(msg.player);
        break;
      case "player-left":
        this.removePlayer(msg.seatId);
        break;
      case "player-disconnected":
        this.setConnected(msg.seatId, false);
        break;
      case "host-changed":
        this.hostSeatId = msg.hostSeatId;
        break;
      case "word-accepted":
        this.acceptedForMe(msg.word, msg.points);
        break;
      case "error":
        this.lastError = msg;
        break;
      case "kicked":
        this.outcome = "kicked";
        break;
      case "room-ended":
        this.outcome = "room-ended";
        break;
      default:
        break;
    }
    const kind = deltaKind(msg);
    this.notify(kind);
    return kind;
  }

  applySnapshot(snap: SnapshotMsg): void {
    this.code = snap.room.code;
    this.phase = snap.room.phase;
    this.hostSeatId = snap.room.hostSeatId;
    this.roundNumber = snap.room.roundNumber;
    this.self = {
      seatId: snap.self.seatId,
      nickname: snap.self.nickname,
      role: snap.self.role,
      cumulativeScore: snap.self.cumulativeScore,
    };
    this.players = snap.players.map((p) => ({ ...p }));
    this.roundScores.clear();
    this.round = snap.round ?? null;
    this.finishedRound = snap.finishedRound
      ? { roundNumber: snap.finishedRound.roundNumber, reveal: snap.finishedRound.reveal }
      : null;
    if (snap.round) {
      this.deadline = snap.round.deadline;
    }
    if (snap.finishedRound) {
      // Intermission re-joiners still see the finished round's board. The
      // pause has no clock, so no deadline is carried.
      this.deadline = 0;
      this.round = {
        roundNumber: snap.finishedRound.roundNumber,
        board: snap.finishedRound.board,
        deadline: 0,
      };
    }
    this.lastError = null;
  }

  applyScores(roundNumber: number, scores: ScoreEntry[]): void {
    if (roundNumber !== this.roundNumber) return;
    for (const s of scores) {
      this.roundScores.set(s.seatId, s.roundScore);
      const p = this.players.find((x) => x.seatId === s.seatId);
      if (p) p.cumulativeScore = s.cumulativeScore;
      if (s.seatId === this.self.seatId) this.self.cumulativeScore = s.cumulativeScore;
    }
  }

  /** The scoreboard view: players ordered by round score descending, ties
   *  sharing one place, the display order inside a tie settled by join
   *  order (the roster array's order). Standard competition ranking: a
   *  later, better score restarts the count after shared places. */
  rankedPlayers(): { player: PlayerInfo; roundScore: number; place: number }[] {
    const ordered = orderPlayers(this.players, (p) => this.roundScores.get(p.seatId) ?? 0);
    const places = competitionPlaces(ordered, (e) => e.key);
    return ordered.map((entry, i) => ({
      player: entry.player,
      roundScore: entry.key,
      place: places[i]!,
    }));
  }

  /** The intermission's session standings (#22): ordered by cumulative
   *  score — the key that decides the session's winner — with the same
   *  ranking rules as `rankedPlayers`: ties share a place, display order
   *  inside a tie settles by join order. */
  sessionRanked(): { player: PlayerInfo; roundScore: number; cumulativeScore: number; place: number }[] {
    const ordered = orderPlayers(this.players, (p) => p.cumulativeScore);
    const places = competitionPlaces(ordered, (e) => e.key);
    return ordered.map((entry, i) => ({
      player: entry.player,
      roundScore: this.roundScores.get(entry.player.seatId) ?? 0,
      cumulativeScore: entry.key,
      place: places[i]!,
    }));
  }

  upsertPlayer(p: PlayerInfo): void {
    const existing = this.players.find((x) => x.seatId === p.seatId);
    if (existing) Object.assign(existing, p);
    else this.players.push({ ...p });
  }

  removePlayer(seatId: number): void {
    this.players = this.players.filter((p) => p.seatId !== seatId);
    this.roundScores.delete(seatId);
  }

  setConnected(seatId: number, connected: boolean): void {
    const p = this.players.find((x) => x.seatId === seatId);
    if (p) p.connected = connected;
  }

  /** My private per-round found words with their points (from the
   *  synchronous `word-accepted` verdict). Quietly adds nothing when the
   *  word is already found; my scoreboard entry moves with it, ahead of
   *  the room-wide `score-update` re-anchor. */
  acceptedForMe(word: string, points: number): void {
    if (this.roundWords.has(word)) return;
    this.roundWords.set(word, points);
    const mine = this.roundScores.get(this.self.seatId) ?? 0;
    this.roundScores.set(this.self.seatId, mine + points);
  }

  get isHost(): boolean {
    return this.hostSeatId === this.self.seatId;
  }

  get errorText(): string {
    if (!this.lastError) return "";
    return GERMAN_ERRORS[this.lastError.code] ?? "Fehler";
  }

  reset(): void {
    this.code = "";
    this.phase = "closed";
    this.hostSeatId = -1;
    this.roundNumber = 0;
    this.self = { seatId: -1, nickname: "", role: "player", cumulativeScore: 0 };
    this.players = [];
    this.roundScores.clear();
    this.round = null;
    this.finishedRound = null;
    this.deadline = 0;
    this.roundWords = new Map();
    this.lastError = null;
    this.outcome = "none";
  }
}

export const GERMAN_ERRORS: Record<ErrorCode, string> = {
  "room-not-found": "Raum nicht gefunden oder abgelaufen.",
  "room-full": "Der Raum ist voll (max. 8 Spieler).",
  "nickname-taken": "Dieser Name ist bereits vergeben. Wähle einen anderen.",
  "token-invalid": "Sitzung ungültig.",
  "invalid-word": "Kein gültiges Wort.",
  "word-duplicate": "Das Wort hast du schon.",
  "round-over": "Die Runde ist bereits vorbei.",
  "not-host": "Nur der Gastgeber kann das.",
  "rate-limited": "Zu viele Nachrichten.",
  "server-full": "Der Server ist ausgelastet.",
  "invalid-message": "Ungültige Nachricht.",
  "not-playing": "Du spielst in dieser Runde nicht.",
  "invalid-phase": "Das geht gerade nicht.",
};
