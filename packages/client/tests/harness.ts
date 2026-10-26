import type { ClientMessage, GreetingMsg, ServerMessage } from "@wortschatz/shared";

export {
  BOARD,
  COPY,
  NO_WORDS,
  OTHER_ROOM_CODE,
  ROOM_CODE,
  ROUND_ONE,
  intermissionSnapshot,
  lobbySnapshot,
  playerJoined,
  playingSnapshot,
  roundEnded,
  roundStarted,
  seat,
  tick,
  wikiLinks,
} from "./fixtures.js";
export type { PlayerInfo, RoundOneOptions, Scene } from "./fixtures.js";
import { ROUND_ONE, type RoundOneOptions, type Scene } from "./fixtures.js";
import {
  ConnectionCore,
  type CloseOutcome,
  type ConnFactory,
  type ConnectionOptions,
  type ConnStatus,
  type RoomConn,
} from "../src/connection.js";
import { mount } from "../src/app.js";

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
 * - `firePointerEvent` / `fireTouchEvent` place one sample on either stream
 *   at a tile's centre or, with `at`, at an explicit point (a tile edge, a
 *   corner, or the gap between two tiles). Board tiles answer
 *   `getBoundingClientRect()` from that same synthetic geometry, so a rect
 *   and the point→tile hit-test always agree.
 *
 * Assertions live only on rendered DOM and boundary messages; the app's
 * store stays an internal detail.
 */

/* ------------------------------------------------------------------ */
/* Scripted connection boundary                                        */
/* ------------------------------------------------------------------ */

/** One client→server wire frame as JSON.stringify would put it on the
 *  boundary: a typed message with its optional echoed reqId. */
export type SentMessage = ClientMessage;

/** The test adapter: it composes the real `ConnectionCore`, so the mount
 *  suite exercises the production message-handling path — Greeting, reqId,
 *  Snapshot side effects and Close outcomes all live in the core. This class
 *  supplies only the scripted transport and the test-side drive. */
export class ScriptedConnection implements RoomConn {
  /** Everything the client sent through this boundary, in send order. */
  readonly outbox: ClientMessage[] = [];
  /** Status history the app was told about, in order. */
  readonly statuses: ConnStatus[] = [];
  /** Close outcomes the app was told about, in order. Exactly one per end. */
  readonly closeOutcomes: CloseOutcome[] = [];
  /** Set once the boundary must go silent: after `stop()` or a
   *  server-initiated end frame (`kicked` / `room-ended`). */
  stopped = false;

  private readonly core: ConnectionCore;

  constructor(opts: ConnectionOptions) {
    this.core = new ConnectionCore({
      greet: opts.greet,
      listener: opts.listener,
      onStatus: (status) => {
        this.statuses.push(status);
        opts.onStatus(status);
      },
      onClose: (outcome) => {
        this.stopped = true;
        this.closeOutcomes.push(outcome);
        opts.onClose(outcome);
      },
      transport: {
        open: () => this.core.transportUp(),
        write: (msg) => this.outbox.push(msg),
        close: () => {
          /* the scripted transport has no socket to release */
        },
      },
    });
  }

  /* —— the app-side surface (the calls the production client makes) —— */

  /** Starts the core: `connecting`, then the greeting with reqId 1. */
  start(): void {
    this.core.start();
  }

  /** Client-initiated close: silent, with no status and no outcome. */
  stop(): void {
    this.stopped = true;
    this.core.stop();
  }

  /** Reports the unexpected-close branch to the core: `retrying` and no
   *  outcome, exactly as the WebSocket adapter does before its timer. */
  retry(): void {
    this.core.transportClosed(false);
  }

  /** An orderly transport close with no server frame ahead: one
   *  connection-lost close outcome reaches the app. */
  abruptClose(): void {
    this.core.transportClosed(true);
  }

  send(msg: Omit<ClientMessage, "reqId"> & { reqId?: number }): void {
    this.core.send(msg);
  }

  request<T extends Omit<ClientMessage, "reqId">>(msg: T): number {
    return this.core.request(msg);
  }

  resync(): void {
    this.core.resync();
  }

  /* —— the test-side drive ------------------------------------------ */

  /** Delivers one server message to the mounted app through the core. */
  feed(msg: ServerMessage): void {
    this.core.receive(msg);
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

/**
 * The happy-dom harness loads no stylesheet, so the board has no computed
 * gap for the app's clear-hit margin. Mirror the Standard skin's default
 * `--board-gap` token on the synthetic board; a test may override it with a
 * later same-specificity rule or an inline custom property.
 */
function installBoardGap(): void {
  if (document.getElementById("test-board-gap")) return;
  const style = document.createElement("style");
  style.id = "test-board-gap";
  style.textContent = ".board { --board-gap: 6px; gap: var(--board-gap); }";
  document.head.append(style);
}

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
  installBoardGap();
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
/* Shared room-entry drivers                                           */
/* ------------------------------------------------------------------ */

/** Enter Create from the Home landing (ADR-0021). */
function openCreate(root: HTMLElement): void {
  if (!root.querySelector("#mk-nick")) root.querySelector<HTMLButtonElement>("#create-btn")!.click();
}

/** Enter Join from the Home landing (ADR-0021). */
function openJoin(root: HTMLElement): void {
  if (!root.querySelector("#jn-code")) root.querySelector<HTMLButtonElement>("#join-btn")!.click();
}

/** A form helper walks the landing first when its field is not on screen
 *  (a deep link is already on Join). */
function ensureEntryScreen(root: HTMLElement, selector: string): void {
  if (root.querySelector(selector)) return;
  if (selector === "#mk-nick" || selector === "#mk-btn") openCreate(root);
  else if (selector.startsWith("#jn-")) openJoin(root);
}

export function click(root: HTMLElement, selector: string): void {
  ensureEntryScreen(root, selector);
  root.querySelector<HTMLButtonElement>(selector)!.click();
}

export function typeInto(root: HTMLElement, selector: string, value: string): void {
  ensureEntryScreen(root, selector);
  root.querySelector<HTMLInputElement>(selector)!.value = value;
}

/** Drives one `Scene` through the real client: optional path and Room entry,
 *  the greeting frames, then the optional Round-start frames. */
export function driveScene(app: Mounted, scene: Scene): void {
  if (scene.path) window.history.pushState({}, "", scene.path);
  if (scene.entry) {
    if (scene.entry.mode === "join") {
      if (scene.entry.code) typeInto(app.root, "#jn-code", scene.entry.code);
      typeInto(app.root, "#jn-nick", scene.entry.nickname);
      click(app.root, "#jn-btn");
    } else {
      typeInto(app.root, "#mk-nick", scene.entry.nickname);
      click(app.root, "#mk-btn");
    }
  }
  if (!scene.entry) return;

  const conn = app.conn();
  const greeting = conn
    .sent()
    .find((msg): msg is GreetingMsg => msg.type === "create-room" || msg.type === "join");
  const frames = typeof scene.greeting === "function" ? scene.greeting(greeting!) : scene.greeting;
  for (const frame of frames) conn.feed(frame);

  if (scene.startRound) {
    click(app.root, "#start-btn");
    for (const frame of scene.startRound) conn.feed(frame);
  }
  if (scene.closeAfterGreeting) conn.abruptClose();
}

/** Home → Lobby → (Host starts) → Round one, through the boundary. */
export function driveToRoundOne(app: Mounted, opts: RoundOneOptions = {}): void {
  driveScene(app, ROUND_ONE(opts));
}

/* ------------------------------------------------------------------ */
/* Synthetic board geometry                                            */
/* ------------------------------------------------------------------ */

/** Synthetic tile-cell layout of the test DOM (no layout engine exists):
 *  40px square cells in a 4-column grid with 4px gaps, row-major. It is the
 *  one geometry both the point→tile hit-test and every board tile's
 *  `getBoundingClientRect()` answer from, so a sample and the tile it hits
 *  can never disagree with the rects. */
const CELL = 40;
const GAP = 4;
const COLUMNS = 4;

/** A point in the synthetic board's coordinate space. */
export interface Point {
  x: number;
  y: number;
}

/** Top-left corner of one board tile index in the synthetic grid. */
function cellOrigin(idx: number): Point {
  return {
    x: (idx % COLUMNS) * (CELL + GAP),
    y: Math.floor(idx / COLUMNS) * (CELL + GAP),
  };
}

/** Center coordinates of one board tile index in the synthetic grid. */
export function tilePoint(idx: number): Point {
  const origin = cellOrigin(idx);
  return { x: origin.x + CELL / 2, y: origin.y + CELL / 2 };
}

/** The board tile index under a synthetic point, or -1 when the point sits
 *  in the gap between cells or outside the 4×4 grid. */
function tileIndexAtPoint(x: number, y: number): number {
  const col = Math.floor(x / (CELL + GAP));
  const row = Math.floor(y / (CELL + GAP));
  if (col < 0 || col >= COLUMNS || row < 0 || row >= COLUMNS) return -1;
  if (x - col * (CELL + GAP) >= CELL || y - row * (CELL + GAP) >= CELL) return -1;
  return row * COLUMNS + col;
}

/** The rendered board tile under a synthetic point, or `null` when the
 *  point falls in the gap between two tiles (or outside the grid). */
export function tileAtPoint(x: number, y: number): HTMLElement | null {
  const board = document.querySelector<HTMLElement>("#board");
  if (!board) return null;
  const idx = tileIndexAtPoint(x, y);
  if (idx < 0) return null;
  return tileEls(board)[idx] ?? null;
}

/* Layout stub: `document.elementFromPoint` and every board tile's
 * `getBoundingClientRect` answered from the geometry above — the test DOM has
 * no layout engine (happy-dom answers null for every point and zero for every
 * rect). A real browser answers with the darkest element under the point and
 * the box layout gave it; board tiles resolve their rects from the same
 * geometry the point→tile hit-test answers with. */

const realFromPoint = document.elementFromPoint.bind(document);

document.elementFromPoint = (x: number, y: number): Element | null => {
  const board = document.querySelector("#board");
  if (board) return tileAtPoint(x, y) ?? board;
  return realFromPoint(x, y);
};

const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;

Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
  const idx = boardTileIndex(this);
  if (idx < 0) return realGetBoundingClientRect.call(this);
  const origin = cellOrigin(idx);
  return new DOMRect(origin.x, origin.y, CELL, CELL);
};

/** A rendered board tile's index, or -1 for any other element (including
 *  elements outside a rendered board). */
function boardTileIndex(el: Element): number {
  if (!el.classList.contains("tile") || !el.closest("#board")) return -1;
  const parent = el.parentElement;
  if (!parent) return -1;
  return Array.prototype.indexOf.call(parent.children, el);
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
 *
 * `at` places the sample at an explicit point instead of the tile's centre
 * (a tile edge, a corner, or the gap between two tiles); the event then
 * targets the element under that point, as a real browser retargets a
 * pointer.
 */
export function firePointerEvent(
  tile: Element,
  type: PointerEventType,
  opts: { pointerId?: number; pointerType?: "mouse" | "touch"; at?: Point } = {}
): void {
  const pointerType = opts.pointerType ?? "touch";
  const pointerId = opts.pointerId ?? (pointerType === "mouse" ? 1 : 7);
  const released = type === "pointerup" || type === "pointercancel";
  const point = opts.at ?? tilePoint(tileIndexOf(tile));
  const target = opts.at ? (document.elementFromPoint(point.x, point.y) ?? tile) : tile;
  dispatchPointer(target, type, {
    pointerId,
    pointerType,
    ...point,
    buttons: released ? 0 : 1,
  });
}

/**
 * One touch event. Like a real browser it retargets every event to
 * `target` (the touchstart element) while carrying `to`'s coordinates —
 * `to` defaults to `target`. `at` places the sample at an explicit point
 * instead of `to`'s centre. Fires a single event, so a test can replay a
 * touch-only stream, mix it with pointer events, or fire a `touchcancel`.
 */
export function fireTouchEvent(
  target: Element,
  type: TouchEventType,
  opts: { identifier?: number; to?: Element; at?: Point } = {}
): TouchEvent {
  const identifier = opts.identifier ?? 42;
  const point = opts.at ?? tilePoint(tileIndexOf(opts.to ?? target));
  const current = type === "touchend" || type === "touchcancel" ? [] : touches(target, point, identifier);
  return dispatchTouch(target, type, point, current, identifier);
}
