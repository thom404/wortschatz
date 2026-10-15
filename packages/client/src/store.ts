import type { PlayerInfo, ScoreEntry, SnapshotMsg, ErrorCode, RevealPayload } from "@wordament/shared";

/**
 * Client state. Built ONLY from server messages (snapshot + deltas); never
 * reconstructs state by replaying deltas — a snapshot always supersedes.
 */
export type Outcome = "none" | "kicked" | "room-ended";

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

  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    for (const fn of this.listeners) fn();
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
      // Intermission re-joiners still see the finished round's board.
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
    const order = this.players
      .map((player, index) => ({ player, index, roundScore: this.roundScores.get(player.seatId) ?? 0 }))
      .sort((a, b) => b.roundScore - a.roundScore || a.index - b.index);
    let place = 1;
    let prevScore: number | null = null;
    return order.map((entry, idx) => {
      if (prevScore !== null && entry.roundScore !== prevScore) place = idx + 1;
      prevScore = entry.roundScore;
      return { player: entry.player, roundScore: entry.roundScore, place };
    });
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
  "nickname-taken": "Dieser Spitzname ist bereits vergeben. Wähle einen anderen.",
  "token-invalid": "Sitzung ungültig.",
  "invalid-word": "Kein gültiges Wort.",
  "word-duplicate": "Wort schon gefunden.",
  "round-over": "Die Runde ist bereits vorbei.",
  "not-host": "Nur der Gastgeber kann das.",
  "rate-limited": "Zu viele Nachrichten.",
  "server-full": "Der Server ist ausgelastet.",
  "invalid-message": "Ungültige Nachricht.",
  "not-playing": "Du spielst in dieser Runde nicht.",
  "need-players": "Es braucht mindestens 2 Spieler, um zu starten.",
  "invalid-phase": "Das geht gerade nicht.",
};
