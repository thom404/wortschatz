import type {
  ClientMessage,
  RoundStartMsg,
  PlayerJoinedMsg,
  ServerMessage,
  SnapshotMsg,
} from "@wordament/shared";
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
   *  and flips the status to `open`; server-initiated ends mark the
   *  boundary closed first, then deliver the frame. */
  feed(msg: ServerMessage): void {
    if (msg.type === "snapshot") {
      const token = msg.self.token ?? "";
      if (token) {
        saveSession(this.code, { token, nickname: msg.self.nickname, seatId: msg.self.seatId });
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
  return {
    seatId: opts.seatId,
    nickname: opts.nickname,
    role: "player",
    cumulativeScore: 0,
    connected: opts.connected ?? true,
  } as const;
}

/** Lobby snapshot: the creator alone in the room, waiting for joiners. */
export function lobbySnapshot(opts: { code: string; nickname: string; seatId?: number }): SnapshotMsg {
  const seatId = opts.seatId ?? 1;
  return {
    type: "snapshot",
    room: { code: opts.code, phase: "lobby", hostSeatId: seatId, roundNumber: 0 },
    self: { seatId, nickname: opts.nickname, role: "player", cumulativeScore: 0, token: "t-1" },
    players: [player({ seatId, nickname: opts.nickname })],
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

/* ------------------------------------------------------------------ */
/* Pointer synthesis                                                   */
/* ------------------------------------------------------------------ */

/** Synthetic tile-cell layout of the test DOM (no layout engine exists):
 *  40px square cells in a 4-column grid with 4px gaps, row-major, matching
 *  style.css's board. */
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

type PointerType = "pointerdown" | "pointermove" | "pointerup";

function dispatchPointer(
  target: Element,
  type: PointerType,
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
function touches(startTile: Element, point: { x: number; y: number }) {
  const touch = {
    identifier: 42,
    target: startTile,
    clientX: point.x,
    clientY: point.y,
  };
  return [touch] as unknown as Touch[];
}

function dispatchTouch(
  target: Element,
  type: "touchstart" | "touchmove" | "touchend",
  point: { x: number; y: number },
  currentTouches: Touch[]
): void {
  if (hasTouchEvents()) {
    target.dispatchEvent(
      new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: currentTouches,
        targetTouches: currentTouches,
        changedTouches: touches(target, point),
      })
    );
    return;
  }
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(ev, {
    touches: { value: currentTouches },
    changedTouches: { value: touches(target, point) },
  });
  target.dispatchEvent(ev);
}

/** One synthesized pointer drag: pointer down on the first tile of `path`,
 *  moves across the rest, releases on the last. Coordinates come from the
 *  synthetic cell layout, so the tiles' own listeners can be found. */
export function synthesizePointerDrag(
  path: readonly Element[],
  pointerType: "mouse" | "touch" = "mouse"
): void {
  if (path.length === 0) throw new Error("drag needs at least one tile");
  const pointerId = pointerType === "mouse" ? 1 : 7;
  const start = path[0]!;
  const downPoint = tilePoint(tileIndexOf(start));
  dispatchPointer(start, "pointerdown", { pointerId, pointerType, ...downPoint, buttons: 1 });
  for (const tile of path.slice(1)) {
    dispatchPointer(tile, "pointermove", {
      pointerId,
      pointerType,
      ...tilePoint(tileIndexOf(tile)),
      buttons: 1,
    });
  }
  const last = path[path.length - 1]!;
  dispatchPointer(last, "pointerup", {
    pointerId,
    pointerType,
    ...tilePoint(tileIndexOf(last)),
    buttons: 0,
  });
}

/** One synthesized touch drag across `path`: touchstart on the first tile,
 *  then a touchmove for each following tile's coordinates — all retargeted
 *  to the touchstart element — and a touchend carrying the last position. */
export function synthesizeTouchDrag(path: readonly Element[]): void {
  if (path.length === 0) throw new Error("drag needs at least one tile");
  const startTile = path[0]!;
  const startPoint = tilePoint(tileIndexOf(startTile));
  dispatchTouch(startTile, "touchstart", startPoint, touches(startTile, startPoint));
  const points = path.map((t) => ({ ...tilePoint(tileIndexOf(t)) }));
  for (let i = 1; i < path.length; i++) {
    const point = points[i]!;
    dispatchTouch(startTile, "touchmove", point, touches(startTile, point));
  }
  const lastPoint = points[path.length - 1]!;
  dispatchTouch(startTile, "touchend", lastPoint, []);
}
