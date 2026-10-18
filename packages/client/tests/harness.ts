import type {
  ClientMessage,
  RoundEndMsg,
  RoundStartMsg,
  PlayerJoinedMsg,
  PlayerInfo,
  RevealPayload,
  ServerMessage,
  SnapshotMsg,
  TickMsg,
} from "@wortschatz/shared";

export type { PlayerInfo };
import { saveSession, type ConnStatus } from "../src/api.js";
import { mount, type ConnFactory, type RoomConn } from "../src/app.js";

/**
 * The client mount test harness (#18): mounts the real app into a test DOM
 * and drives the single client test seam — the connection boundary.
 *
 * - `ScriptedConnection` plays the transport. The app hands over its greet
 *   builder; `start()` simulates the socket coming up, sending the greeting
 *   (create-room / join) with the first reqId — everything the client sends
 *   afterwards is captured verbatim. Tests push `ServerMessage`s at the app
 *   with `feed()`.
 * - `synthesizePointerDrag` / `synthesizeTouchDrag` replay user drags onto
 *   the rendered tile grid at synthetic cell coordinates (the test DOM has
 *   no layout engine). Touch events retarget like real browsers do: after
 *   touchstart, touchmove/touchend keep firing on the start tile, carrying
 *   the finger's current coordinates.
 *
 * Assertions live only on rendered DOM and boundary messages; the app's
 * store stays an internal detail.
 */

/* ------------------------------------------------------------------ */
/* Scripted connection boundary                                        */
/* ------------------------------------------------------------------ */

type ServerListener = (msg: ServerMessage) => void;

/** One client→server wire frame as JSON.stringify would put it on the
 *  boundary: a typed message with its optional echoed reqId. */
export type SentMessage = ClientMessage;

export class ScriptedConnection implements RoomConn {
  readonly code: string;
  /** Everything the client sent through this boundary, in send order. */
  readonly outbox: ClientMessage[] = [];
  /** Status history the app was told about, in order. */
  readonly statuses: ConnStatus[] = [];
  /** Set once the boundary must go silent: after `stop()` or a
   *  server-initiated end frame (`kicked` / `room-ended`). */
  stopped = false;

  private readonly greet: () => ClientMessage | null;
  private readonly listener: ServerListener;
  private readonly onStatus: (status: ConnStatus) => void;
  private nextReqId = 1;
  private open = false;

  constructor(opts: {
    code: string;
    greet: () => ClientMessage | null;
    listener: ServerListener;
    onStatus: (status: ConnStatus) => void;
  }) {
    this.code = opts.code;
    this.greet = opts.greet;
    this.listener = opts.listener;
    this.onStatus = opts.onStatus;
  }

  /* —— the app-side surface (the calls the production client makes) —— */

  /** Transport up: the app is told `connecting`, and like an open socket
   *  the greeting (create-room / join) crosses the boundary with reqId 1.
   *  Mirrors `RoomConnection`: only a snapshot flips the status to `open`. */
  start(): void {
    if (this.open) throw new Error("connection already started");
    this.open = true;
    this.statuses.push("connecting");
    this.onStatus("connecting");
    const greet = this.greet();
    if (greet) this.send({ ...greet, reqId: this.nextReqId++ });
  }

  /** Client-initiated close. Mirrors `RoomConnection.stop()`: silent — a
   *  1000 close never surfaces as a status callback. */
  stop(): void {
    this.stopped = true;
    this.open = false;
  }

  /** A close-status arrives with no server frame ahead — the state an
   *  orderly close (kicked/room-ended disposal in production) reports
   *  before its frame, or a close that never gets one. Marks the
   *  boundary closed and tells the app. */
  abruptClose(): void {
    this.open = false;
    this.statuses.push("closed");
    this.onStatus("closed");
  }

  send(msg: Omit<ClientMessage, "reqId"> & { reqId?: number }): void {
    if (this.open) this.outbox.push(msg as ClientMessage);
  }

  request<T extends Omit<ClientMessage, "reqId">>(msg: T): number {
    const reqId = this.nextReqId++;
    this.send({ ...msg, reqId });
    return reqId;
  }

  resync(): void {
    this.request({ type: "resync" });
  }

  /* —— the test-side drive ------------------------------------------ */

  /** Delivers one server message to the mounted app. Mirrors
   *  `RoomConnection.onMessage`: a snapshot persists the session token
   *  under the snapshot's room code and flips the status to `open`;
   *  server-initiated ends mark the boundary closed first, then deliver
   *  the frame. */
  feed(msg: ServerMessage): void {
    if (msg.type === "snapshot") {
      const token = msg.self.token ?? "";
      if (token) {
        saveSession(msg.room.code, { token, nickname: msg.self.nickname, seatId: msg.self.seatId });
      }
      this.statuses.push("open");
      this.onStatus("open");
    }
    if (msg.type === "kicked" || msg.type === "room-ended") {
      this.stopped = true;
      this.open = false;
      this.statuses.push("closed");
      this.onStatus("closed");
    }
    this.listener(msg);
  }

  /** Frames sent so far, as a stable copy for assertions. */
  sent(): ClientMessage[] {
    return [...this.outbox];
  }

  /** All message types sent so far, in order — quick boundary shape. */
  sentTypes(): string[] {
    return this.outbox.map((m) => m.type);
  }
}

/* ------------------------------------------------------------------ */
/* Mount                                                              */
/* ------------------------------------------------------------------ */

export interface Mounted {
  /** The DOM root the app was mounted into. */
  root: HTMLElement;
  /** The newest scripted connection (i.e. the current room). */
  conn(): ScriptedConnection;
  /** All connections this mount created, in creation order. */
  connections(): ScriptedConnection[];
  /** Unmounts the app (stops timers/connection and clears the DOM root). */
  unmount(): void;
}

/** Mounts the real app into a fresh root div on `document.body`. */
export function mountHarness(): Mounted {
  document.body.textContent = "";
  const root = document.createElement("div");
  document.body.append(root);

  const connections: ScriptedConnection[] = [];
  const factory: ConnFactory = (opts) => {
    const conn = new ScriptedConnection(opts);
    connections.push(conn);
    return conn;
  };
  const unmount = mount(root, factory);

  return {
    root,
    conn() {
      const latest = connections[connections.length - 1];
      if (!latest) throw new Error("no room was opened yet");
      return latest;
    },
    connections() {
      return [...connections];
    },
    unmount,
  };
}

/* ------------------------------------------------------------------ */
/* Server message fixtures                                             */
/* ------------------------------------------------------------------ */

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
  players?: PlayerInfo[];
}): SnapshotMsg {
  const seatId = opts.seatId ?? 1;
  return {
    type: "snapshot",
    room: { code: opts.code, phase: "lobby", hostSeatId: seatId, roundNumber: 0 },
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
    round: { roundNumber: opts.roundNumber ?? 1, board: [...opts.board], deadline: Date.now() + 120_000 },
  };
}

/** Someone takes a seat next to you (a delta, not a snapshot). */
export function playerJoined(seatId: number, nickname: string): PlayerJoinedMsg {
  return { type: "player-joined", player: player({ seatId, nickname }) };
}

/** Round start: the server owns the board and the deadline. */
export function roundStarted(board: readonly string[], roundNumber = 1): RoundStartMsg {
  return {
    type: "round-start",
    round: { roundNumber, board: [...board], deadline: Date.now() + 120_000 },
  };
}

/** Round end: the room-wide reveal, grouped by length ascending (#17). */
export function roundEnded(roundNumber: number, reveal: RevealPayload): RoundEndMsg {
  return { type: "round-end", roundNumber, reveal };
}

/** One 1 Hz re-anchor tick for either countdown phase. */
export function tick(phase: "playing" | "intermission", remaining: number): TickMsg {
  return { type: "tick", phase, remaining, deadline: Date.now() + remaining };
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
  players?: PlayerInfo[];
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
    },
  };
}

/* ------------------------------------------------------------------ */
/* Pointer synthesis                                                   */
/* ------------------------------------------------------------------ */

/** Synthetic tile-cell layout of the test DOM (no layout engine exists):
 *  40px square cells in a 4-column grid with 4px gaps, row-major. The app
 *  resolves drags by coordinates (like a real browser), so the harness
 *  stubs `document.elementFromPoint` with this geometry's inverse —
 *  exactly the hit-testing the browser answers and happy-dom cannot. */
const CELL = 40;
const GAP = 4;
const COLUMNS = 4;

/** Center coordinates of one board tile index in the synthetic grid. */
export function tilePoint(idx: number): { x: number; y: number } {
  const col = idx % COLUMNS;
  const row = Math.floor(idx / COLUMNS);
  return {
    x: col * (CELL + GAP) + CELL / 2,
    y: row * (CELL + GAP) + CELL / 2,
  };
}

/* Layout stub: `document.elementFromPoint` answered once per process —
 * happy-dom's DOM answers null (no layout engine); a real browser answers
 * with the darkest element under the point. The stub maps synthetic cell
 * coordinates back to the currently rendered board's tile. */

const realFromPoint = document.elementFromPoint.bind(document);

document.elementFromPoint = (x: number, y: number): Element | null => {
  const board = document.querySelector("#board");
  if (board) {
    const col = Math.floor(x / (CELL + GAP));
    const row = Math.floor(y / (CELL + GAP));
    if (col >= 0 && col < COLUMNS && row >= 0 && row < COLUMNS) {
      const tiles = tileEls(board as HTMLElement);
      return tiles[row * COLUMNS + col] ?? realFromPoint(x, y);
    }
    return board;
  }
  return realFromPoint(x, y);
};

/** The board's rendered tiles, in row-major order. */
export function tileEls(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("#board .tile")];
}

function tileIndexOf(tile: Element): number {
  const parent = tile.parentElement;
  if (!parent) throw new Error("tile is not attached to the rendered board");
  return Array.prototype.indexOf.call(parent.children, tile);
}

function hasPointerEvents(): boolean {
  return typeof window.PointerEvent === "function";
}
function hasTouchEvents(): boolean {
  return typeof window.TouchEvent === "function";
}

export type PointerEventType = "pointerdown" | "pointermove" | "pointerup" | "pointercancel";

function dispatchPointer(
  target: Element,
  type: PointerEventType,
  init: { pointerId: number; pointerType: "mouse" | "touch"; x: number; y: number; buttons: number }
): void {
  if (hasPointerEvents()) {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: init.pointerId,
        pointerType: init.pointerType,
        isPrimary: true,
        clientX: init.x,
        clientY: init.y,
        button: 0,
        buttons: init.buttons,
      })
    );
    return;
  }
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(ev, {
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType },
    isPrimary: { value: true },
    clientX: { value: init.x },
    clientY: { value: init.y },
    button: { value: 0 },
    buttons: { value: init.buttons },
  });
  target.dispatchEvent(ev);
}

/** Synthetic single-finger touch state targeting `startTile` (the browser
 *  retargets every touch event to the touchstart element). */
function touches(startTile: Element, point: { x: number; y: number }, identifier = 42) {
  const touch = {
    identifier,
    target: startTile,
    clientX: point.x,
    clientY: point.y,
  };
  return [touch] as unknown as Touch[];
}

export type TouchEventType = "touchstart" | "touchmove" | "touchend" | "touchcancel";

function dispatchTouch(
  target: Element,
  type: TouchEventType,
  point: { x: number; y: number },
  currentTouches: Touch[],
  identifier = 42
): TouchEvent {
  if (hasTouchEvents()) {
    const ev = new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: currentTouches,
      targetTouches: currentTouches,
      changedTouches: touches(target, point, identifier),
    });
    target.dispatchEvent(ev);
    return ev;
  }
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(ev, {
    touches: { value: currentTouches },
    changedTouches: { value: touches(target, point, identifier) },
  });
  target.dispatchEvent(ev);
  return ev as unknown as TouchEvent;
}

/** One touchmove with no drag underway (the stray-gesture probe: asserts
 *  the app leaves unstarted gestures to the browser). */
export function strayTouchMove(tile: Element): TouchEvent {
  return dispatchTouch(
    tile,
    "touchmove",
    tilePoint(tileIndexOf(tile)),
    touches(tile, tilePoint(tileIndexOf(tile)))
  );
}

/** One synthesized pointer drag: pointer down on the first tile of `path`,
 *  moves across the rest, releases on the last. Coordinates come from the
 *  synthetic cell layout, so the tiles' own listeners can be found.
 *  `onStep` runs after each dispatched event (e.g. to observe the rendered
 *  DOM mid-drag). */
export function synthesizePointerDrag(
  path: readonly Element[],
  pointerType: "mouse" | "touch" = "mouse",
  onStep?: () => void
): void {
  if (path.length === 0) throw new Error("drag needs at least one tile");
  const pointerId = pointerType === "mouse" ? 1 : 7;
  const start = path[0]!;
  const downPoint = tilePoint(tileIndexOf(start));
  dispatchPointer(start, "pointerdown", { pointerId, pointerType, ...downPoint, buttons: 1 });
  onStep?.();
  for (const tile of path.slice(1)) {
    dispatchPointer(tile, "pointermove", {
      pointerId,
      pointerType,
      ...tilePoint(tileIndexOf(tile)),
      buttons: 1,
    });
    onStep?.();
  }
  const last = path[path.length - 1]!;
  dispatchPointer(last, "pointerup", {
    pointerId,
    pointerType,
    ...tilePoint(tileIndexOf(last)),
    buttons: 0,
  });
  onStep?.();
}

/** One synthesized touch drag across `path`: touchstart on the first tile,
 *  then a touchmove for each following tile's coordinates — all retargeted
 *  to the touchstart element — and a touchend carrying the last position.
 *  `onStep` runs after each dispatched event. */
export function synthesizeTouchDrag(path: readonly Element[], onStep?: () => void): void {
  if (path.length === 0) throw new Error("drag needs at least one tile");
  const startTile = path[0]!;
  fireTouchEvent(startTile, "touchstart", { to: startTile });
  onStep?.();
  for (const tile of path.slice(1)) {
    fireTouchEvent(startTile, "touchmove", { to: tile });
    onStep?.();
  }
  fireTouchEvent(startTile, "touchend", { to: path[path.length - 1]! });
  onStep?.();
}

/* ------------------------------------------------------------------ */
/* Independent event streams                                           */
/* ------------------------------------------------------------------ */

/**
 * One pointer event on `tile`, at that tile's synthetic coordinates. Unlike
 * `synthesizePointerDrag` this fires a single event, so a test can mix the
 * pointer and touch streams of one gesture (e.g. a `pointerdown` continued
 * only by `touchmove`) and fire a `pointercancel`. Defaults to a touch
 * pointer, the stream a phone's drag begins with.
 */
export function firePointerEvent(
  tile: Element,
  type: PointerEventType,
  opts: { pointerId?: number; pointerType?: "mouse" | "touch" } = {}
): void {
  const pointerType = opts.pointerType ?? "touch";
  const pointerId = opts.pointerId ?? (pointerType === "mouse" ? 1 : 7);
  const released = type === "pointerup" || type === "pointercancel";
  dispatchPointer(tile, type, {
    pointerId,
    pointerType,
    ...tilePoint(tileIndexOf(tile)),
    buttons: released ? 0 : 1,
  });
}

/**
 * One touch event. Like a real browser it retargets every event to
 * `target` (the touchstart element) while carrying `to`'s coordinates —
 * `to` defaults to `target`. Fires a single event, so a test can replay a
 * touch-only stream, mix it with pointer events, or fire a `touchcancel`.
 */
export function fireTouchEvent(
  target: Element,
  type: TouchEventType,
  opts: { identifier?: number; to?: Element } = {}
): TouchEvent {
  const identifier = opts.identifier ?? 42;
  const point = tilePoint(tileIndexOf(opts.to ?? target));
  const current = type === "touchend" || type === "touchcancel" ? [] : touches(target, point, identifier);
  return dispatchTouch(target, type, point, current, identifier);
}
