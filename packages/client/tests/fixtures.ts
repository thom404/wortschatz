import type {
  GreetingMsg,
  PlayerInfo,
  PlayerJoinedMsg,
  RevealPayload,
  RoundEndMsg,
  RoundStartMsg,
  ServerMessage,
  SnapshotMsg,
  TickMsg,
  WikiLinksMsg,
} from "@wortschatz/shared";

/**
 * DOM-free server-message fixtures shared by the Vitest mount harness and the
 * Playwright visual suite (#156). Both layers script the same WebSocket
 * boundary with the same wire shapes, so they cannot drift.
 *
 * It is also the one home for the canonical test data, the expected German UI
 * copy and the setup-only `Scene` description (#214). No DOM or Playwright
 * import may enter this module.
 */
export type { PlayerInfo };

/** The one room code every fixture uses (deterministic deep links and QR). */
export const ROOM_CODE = "ABC12";

/** A second room code for tests that join a different room. */
export const OTHER_ROOM_CODE = "NEU42";

/** The canonical plain board: uppercase single letters, the fast-layer shape. */
export const BOARD: string[] = [
  "H",
  "A",
  "U",
  "S",
  "T",
  "I",
  "R",
  "E",
  "B",
  "U",
  "M",
  "S",
  "K",
  "A",
  "T",
  "Z",
];

/** The canonical empty reveal: the "no words" state. */
export const NO_WORDS: RevealPayload = { groups: [] };

/**
 * The German UI copy the TypeScript tests assert on the shared screens. Tests
 * own this table so a production copy regression still fails; it is not a full
 * catalog of every string in the app.
 */
export const COPY = {
  home: {
    title: "Wortschatz",
    tagline: "Ein Mehrspieler-Wörterspiel.",
    create: "Raum erstellen",
    join: "Raum beitreten",
  },
  create: {
    title: "Raum erstellen",
    name: "Name",
    namePlaceholder: "z. B. Anja",
    submit: "Raum erstellen",
  },
  join: {
    title: "Raum beitreten",
    code: "Raumcode",
    codePlaceholder: "ABC12",
    name: "Name",
    namePlaceholder: "z. B. Jörg",
    invited: (code: string) => `Du wurdest in Raum ${code} eingeladen.`,
  },
  lobby: {
    title: (code: string) => `Raum ${code}`,
    connected: (n: number) => `${n} von 8 verbunden`,
    start: "Runde starten",
    waiting: "Warte auf den Gastgeber …",
    invite: "Einladen",
    inviteNote: "Scanne den Code mit der Kamera, um beizutreten.",
    host: "Gastgeber",
    away: "unterbrochen",
    leave: "Raum verlassen",
  },
  game: {
    title: (round: number) => `Runde ${round}`,
    board: "Spielfeld",
    words: "Deine Wörter",
    points: "Punkte",
    rotate: "Spielfeld um 90° drehen",
    traceHint: "Wische über die Felder, um ein Wort zu bilden.",
    spectator: "Zuschauer",
    spectatorNote: "Du schaust zu. Ab der nächsten Runde bist du dabei.",
    wikiLookup: "Bei Wiktionary nachschlagen",
  },
  intermission: {
    title: "Pause",
    round: (round: number) => `Runde ${round}`,
    nextRound: "Nächste Runde starten",
    hostStarts: "Der Gastgeber startet die nächste Runde.",
    total: "Es zählt das Gesamtergebnis der Sitzung.",
    results: "Ergebnisse",
    noResults: "—",
    length: (n: number) => `${n} Buchstaben`,
    sortLength: "Nach Länge sortieren",
    sortPoints: "Nach Punkten sortieren",
    sortAlphabet: "Alphabetisch sortieren",
  },
  outcomes: {
    kicked: (code: string) => `Du wurdest aus dem Raum ${code} entfernt.`,
    kickedNote:
      "Der Gastgeber hat dich aus dem Raum entfernt. Du kannst einen neuen Raum erstellen oder einem anderen beitreten.",
    ended: (code: string) => `Raum ${code} wurde beendet.`,
    expired: (code: string) => `Raum ${code} ist abgelaufen.`,
    notFound: (code: string) => `Raum ${code} nicht gefunden oder abgelaufen.`,
    notFoundNote: "Prüfe den Raumcode, oder erstelle einen neuen Raum.",
    connectionLost: "Verbindung beendet.",
    home: "Zur Startseite",
  },
  menu: {
    label: "Menü",
    skin: "Skin",
    standard: "Standard (hell)",
    arcade: "Arcade (dunkel)",
    version: (version: string) => `Version ${version}`,
    current: "aktuell",
    changelog: "Das Menü: Skin wechseln und Version ansehen, auf jedem Bildschirm.",
    rotate: "Das Spielfeld lässt sich in 90°-Schritten drehen.",
    rules: "Spielanleitung",
    rulesIntro: "So spielst du:",
    rulesUmlauts: "Ä, ö, ü und ß gelten als echte Buchstaben.",
    rulesNextRound: "Der Gastgeber startet die nächste Runde.",
    rulesSpectator: "Du schaust zu. Ab der nächsten Runde bist du dabei.",
    rulesTotal: "Am Ende zählt das Gesamtergebnis der Sitzung.",
    sources: "Quellen",
    sourcesLicense: "CC0-1.0",
    sourcesExclusions: "Ausschlussliste",
    sourcesWiktionary: "Wiktionary",
    report: "Problem melden",
  },
  errors: {
    nameRequired: "Bitte gib einen Namen ein.",
    codeRequired: "Bitte gib einen Raumcode ein.",
    roomNotFound: "Raum nicht gefunden oder abgelaufen.",
    roomFull: "Der Raum ist voll (max. 8 Spieler).",
    nicknameTaken: "Dieser Name ist bereits vergeben. Wähle einen anderen.",
    invalidWord: "Kein gültiges Wort.",
    wordDuplicate: "Das Wort hast du schon.",
    roundOver: "Die Runde ist bereits vorbei.",
    rateLimited: "Zu viele Nachrichten.",
    invalidMessage: "Ungültige Nachricht.",
    notPlaying: "Du spielst in dieser Runde nicht.",
    invalidPhase: "Das geht gerade nicht.",
  },
  status: {
    connecting: "Verbinde …",
    retrying: "Verbindung wird wiederhergestellt …",
  },
  scores: {
    round: (n: number) => `Runde ${n} P`,
    total: (n: number) => `Gesamt ${n} P`,
    points: (n: number) => `${n} P`,
  },
} as const;

/**
 * The room setup both test layers share. Readiness, `afterOpen`, screenshot
 * ids, skins and viewports stay with the layer that owns them.
 */
export interface Scene {
  entry?: { mode: "create" | "join"; nickname: string; code?: string };
  path?: string;
  greeting: ServerMessage[] | ((greeting: GreetingMsg) => ServerMessage[]);
  startRound?: ServerMessage[];
  closeAfterGreeting?: { code?: number; reason?: string; delayMs?: number };
}

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
export interface RoundOneOptions {
  code?: string;
  roster?: PlayerInfo[];
  board?: readonly string[];
}

/** The canonical Home → Lobby → Round-one setup: create, greet, start, play. */
export function ROUND_ONE(opts: RoundOneOptions = {}): Scene {
  const code = opts.code ?? ROOM_CODE;
  const roster = opts.roster ?? [seat({ seatId: 1, nickname: "Lena" })];
  const nickname = roster[0]!.nickname;
  return {
    entry: { mode: "create", nickname },
    greeting: [lobbySnapshot({ code, nickname, players: roster })],
    startRound: [roundStarted(opts.board ?? BOARD)],
  };
}

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
