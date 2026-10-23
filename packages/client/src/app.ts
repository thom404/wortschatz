import { loadSession, clearSession, type CloseOutcome, type ConnStatus, type GreetFn } from "./api.js";
import { GameStore, type DeltaKind } from "./store.js";
import {
  applyGestureSample,
  type GesturePhase,
  type GestureSample,
  type GestureStream,
  type PointerKind,
} from "./gesture.js";
import { displayTile, displayWord } from "./display.js";
import { rotateBoard, serverBoardIndex, type BoardRotation } from "./board-rotation.js";
import {
  homeIcon,
  leaveIcon,
  rotateIcon,
  sortAlphabetIcon,
  sortLengthIcon,
  sortPointsIcon,
} from "./icons.js";
import { qrSvg } from "./qr.js";
import { applySkin, loadSkin } from "./skins.js";
import { menuHtml, wireMenu, type MenuSurface } from "./menu.js";
import { ViewState, type RevealOrder } from "./view-state.js";
import type {
  ClientMessage,
  PlayerInfo,
  RevealPayload,
  RevealWord,
  RoomEndReason,
  ServerErrorMsg,
  ServerMessage,
} from "@wortschatz/shared";
import { PROTOCOL, tileSpellingLength, tileStrings, tileValues } from "@wortschatz/shared";
import "./style.css";

/**
 * Screens of the minimal functional shell (visual language is ticket #8):
 * - Home: the landing; two actions, no form (the skin switcher moved to the
 *   app-owned Menü, ADR-0023).
 * - Create screen: name a player and create a room.
 * - Join screen: room code and name; a deep link lands here pre-filled.
 * - Wait room (Lobby): waiting room; the host starts round one, even alone.
 * - Game: board, interpolated countdown, scoreboard, typed word input.
 * - Intermission: finished round's board + reveal until the next round.
 * - Ended: kicked / room-ended outcomes, each with a real action.
 *
 * `mount` is the single app entry (#18): production boot (main.ts) and the
 * mount test harness share it. The app is parameterized by its DOM root
 * and its connection factory; every client message crosses that boundary,
 * as does every server message the app renders from.
 */

/** The client-facing surface of a room connection. Production hands over
 *  a real `RoomConnection`; tests substitute a scripted fake of the same
 *  shape. */
export interface RoomConn {
  start(): void;
  request<T extends Omit<ClientMessage, "reqId">>(msg: T): number;
  send(msg: Omit<ClientMessage, "reqId"> & { reqId?: number }): void;
  resync(): void;
  stop(): void;
}

/** How a room connection comes to be. The factory receives the room code,
 *  the greeting builder, the status callback and the one close-outcome
 *  callback; it returns an unstarted connection the app then `start()`s. */
export type ConnFactory = (opts: {
  code: string;
  greet: GreetFn;
  listener: (msg: ServerMessage) => void;
  onStatus: (status: ConnStatus) => void;
  onClose: (outcome: CloseOutcome) => void;
}) => RoomConn;

type Unsubscribe = () => void;

/** The three entry screens (ADR-0021): Home routes to Create or Join, both
 *  in memory. The history entry carries the screen it names, never a route. */
type EntryScreen = "home" | "create" | "join";

/** The history state one entry carries. `fromHome` distinguishes an entry
 *  pushed by Create/Join from the initial Home/deep-link entry, so the
 *  in-screen Zurück can return to Home without leaving the app. */
interface EntryState {
  screen: EntryScreen;
  code?: string;
  fromHome?: boolean;
}

interface App {
  /** The shell's screen container: every screen rebuilds into this. */
  root: HTMLElement;
  /** The mount root: a shell holding the screen and the notification layer
   *  (ADR-0018). The layer lives outside every screen's markup. */
  shell: HTMLElement;
  connect: ConnFactory;
  store: GameStore;
  conn: RoomConn | null;
  renderTimer: ReturnType<typeof setInterval> | null;
  inRoom: boolean;
  /** The live connection attempt, or `null` when no attempt exists (the idle
   *  start screen). `open` is also the absence of a notice. */
  connStatus: ConnStatus | null;
  /** The current local validation copy, surfaced in the error slot. Server
   *  errors come from the store; a local string replaces them. */
  localError: string | null;
  /** The two app-owned notice slots (ADR-0018), in DOM order. */
  noticeStatus: HTMLElement;
  noticeError: HTMLElement;
  /** The app-owned Menü surface (ADR-0023), created once outside the screen
   *  markup so a rebuild can neither remove it nor lose its wiring. */
  menu: MenuSurface;
  unsub: Unsubscribe | null;
  /** Client-only view state (ADR-0024): the reveal order, the Board
   *  rotation and the live Gesture, together with their reset rules. */
  view: ViewState;
  /** The room code this mount's connection was built for — creating a
   *  room greets with the nickname, and the server names the room later
   *  (first snapshot). The outcome screens that fire without a snapshot
   *  (room-not-found) still name the code the user typed. */
  roomCode: string;
  /** The entry screen currently rendered (ADR-0021). */
  screen: EntryScreen;
  /** Whether the current Create/Join entry was pushed from Home, which is
   *  what lets the in-screen Zurück walk history back to Home. */
  screenFromHome: boolean;
  onPopState: (ev: PopStateEvent) => void;
  stopDrag: () => void;
  /** How far (px) inside a tile a movement sample must land to count as a
   *  clear hit, measured from the board's computed gap when it renders. */
  clearHitMargin: number;
  /** The live regions the current screen declares beside its template
   *  (ADR-0009). The play-time updater walks exactly these. */
  liveRegions: readonly LiveRegion[];
}

/** The user-facing app name: the browser title and the home heading. */
const APP_NAME = "Wortschatz";

/** The one sentence the drag surface shows between words. */
const TRACE_HINT = "Wische über die Felder, um ein Wort zu bilden.";

/** The German points phrase for a tile: singular at one point, an `oder`
 *  pair when the spellings differ, plural otherwise (issue #142). Equal
 *  either/or variants collapse exactly as the visible number does. */
function pointsText(values: readonly number[]): string {
  const first = values[0] ?? 0;
  if (!values.every((v) => v === first)) return `${values.join(" oder ")} Punkte`;
  return first === 1 ? "1 Punkt" : `${first} Punkte`;
}

/** The visible corner number: differing either/or variants join with `/` in
 *  letter order; equal variants (and every other tile kind) collapse to one. */
function pointsDisplay(values: readonly number[]): string {
  const first = values[0] ?? 0;
  return values.every((v) => v === first) ? String(first) : values.join("/");
}

/**
 * One board tile: the displayed letters, the points in the old index corner
 * (hidden from assistive technology, since the tile's label already carries
 * them) and the whole tile as the hover target. Both the game and
 * intermission boards render through this one path (ADR-0002).
 */
function tileHtml(t: string): string {
  const letters = displayTile(t);
  const values = tileValues(t);
  const points = pointsText(values);
  const label = `${letters}, ${points}`;
  return `<div class="tile" title="${escapeHtml(points)}" aria-label="${escapeHtml(label)}">${escapeHtml(letters)}<span class="pts" aria-hidden="true">${escapeHtml(pointsDisplay(values))}</span></div>`;
}

/** The 4×4 board both screens share. Font sizing lives on the grid
 *  container via the widest tile span knob (ADR-0002): per-tile `em`
 *  resolves against the parent and breaks. Rotation only permutes the
 *  cells (ADR-0002 amendment #151): the tile markup stays upright and the
 *  server board array is never reordered. */
function boardHtml(board: readonly string[], rotation: BoardRotation): string {
  return `<div id="board" class="board" data-rotation="${rotation}" style="${boardSpanStyle(board)}">${boardTilesHtml(board, rotation)}</div>`;
}

/** The tiles in rotated render order: each cell shows the tile the module's
 *  forward permutation places there, so the arrangement turns while every
 *  glyph, corner value and tile identity stays as authored. */
function boardTilesHtml(board: readonly string[], rotation: BoardRotation): string {
  if (board.length === 0) return "";
  return rotateBoard(board, rotation).map(tileHtml).join("");
}

/** The grid container's one font-size knob: the widest tile span on the
 *  server board (rotation never changes the set of tiles). */
function boardSpanStyle(board: readonly string[]): string {
  const tileSpan = Math.max(1, ...board.map((t) => tileSpellingLength(t)));
  return `--tile-span:${tileSpan}`;
}

/**
 * Measures the board's gap once, after a board has rendered (ADR-0002 §20).
 * The CSS `--board-gap` token is the single source of the drag clear-hit
 * margin, so the board's computed gap is authoritative and no second
 * literal copies it into this file.
 */
function measureBoardGap(app: App): void {
  const board = app.root.querySelector<HTMLElement>("#board");
  if (!board) {
    app.clearHitMargin = 0;
    return;
  }
  const computed = getComputedStyle(board);
  const gap = computed.gap || computed.columnGap || computed.getPropertyValue("--board-gap");
  app.clearHitMargin = Number.parseFloat(gap) || 0;
}

/** The one German string of an icon-only control, used for both its
 *  accessible name and its tooltip, so the two can never drift (ADR-0022). */
const ROTATE_LABEL = "Spielfeld um 90° drehen";
const LEAVE_LABEL = "Raum verlassen";

/** One icon-only control: the glyph is hidden from assistive technology,
 *  the `aria-label` carries the name, and `data-tip` is the same string for
 *  the CSS-only tooltip. There is deliberately no `aria-describedby`. */
function iconButtonHtml(opts: {
  id?: string;
  className: string;
  icon: string;
  label: string;
  data?: string;
  pressed?: boolean;
}): string {
  const id = opts.id ? ` id="${opts.id}"` : "";
  const data = opts.data ? ` ${opts.data}` : "";
  const pressed = opts.pressed === undefined ? "" : ` aria-pressed="${opts.pressed}"`;
  return `<button type="button"${id} class="${opts.className}" aria-label="${escapeHtml(opts.label)}" data-tip="${escapeHtml(opts.label)}"${data}${pressed}>${opts.icon}</button>`;
}

/** The single cycling rotation control (ADR-0002 #174): each press turns
 *  the board 90° clockwise. The name never changes with the angle; the
 *  board's `data-rotation` is the machine-readable live value. */
function boardRotationHtml(): string {
  return iconButtonHtml({
    id: "board-rotation",
    className: "icon-btn board-rotation",
    icon: rotateIcon,
    label: ROTATE_LABEL,
  });
}

function leaveButtonHtml(): string {
  return iconButtonHtml({
    id: "leave-btn",
    className: "icon-btn leave-btn",
    icon: leaveIcon,
    label: LEAVE_LABEL,
  });
}

/**
 * Mounts the app into `rootEl`, which renders to the home screen
 * immediately. Returns the unmount function: it stops the countdown
 * render timer, stops any live connection, unsubscribes, removes the
 * popstate listener, unbinds the drag surface and clears the root. Call
 * exactly once per mount.
 */
export function mount(rootEl: HTMLElement, connect: ConnFactory): () => void {
  // The app root is a shell (ADR-0018): one screen container that every
  // render replaces, beside the app-owned Menü (ADR-0023) and the one
  // notification layer created here once. Neither surface is inside markup a
  // screen rebuild replaces; unmount removes all three.
  rootEl.innerHTML = `
    <div id="screen"></div>
    ${menuHtml()}
    <div id="notifications" class="notifications">
      <p id="notice-status" class="notice status" role="status" aria-live="polite"></p>
      <p id="notice-error" class="notice error" role="alert" aria-live="assertive"></p>
    </div>`;
  const app: App = {
    root: rootEl.querySelector<HTMLElement>("#screen")!,
    shell: rootEl,
    connect,
    store: new GameStore(),
    conn: null,
    renderTimer: null,
    inRoom: false,
    connStatus: null,
    localError: null,
    noticeStatus: rootEl.querySelector<HTMLElement>("#notice-status")!,
    noticeError: rootEl.querySelector<HTMLElement>("#notice-error")!,
    menu: wireMenu(rootEl),
    unsub: null,
    view: new ViewState(),
    roomCode: "",
    screen: "home",
    screenFromHome: false,
    onPopState: (ev) => {
      // A live room owns the screen (ADR-0021): history never competes with
      // the connection's snapshots and close outcomes.
      if (!app.inRoom) showEntry(app, ev.state as EntryState | null);
    },
    stopDrag: () => {},
    clearHitMargin: 0,
    liveRegions: [],
  };
  window.addEventListener("popstate", app.onPopState);
  app.stopDrag = wireDrag(app);
  // The skin choice is page-level (ADR-0002): the restored selection
  // rides on the root attribute before the first screen renders, so a
  // returning visitor never glimpses the wrong design.
  applySkin(loadSkin());
  // The initial entry names its screen too (ADR-0021). A deep link lands on
  // Join without pushing an entry, so browser Back still leaves the app.
  const deepCode = deepLinkCode();
  if (deepCode) {
    window.history.replaceState(
      { screen: "join", code: deepCode, fromHome: false } satisfies EntryState,
      "",
      location.pathname
    );
    renderJoin(app, deepCode);
  } else {
    window.history.replaceState({ screen: "home" } satisfies EntryState, "", location.pathname);
    home(app);
  }
  return () => {
    teardown(app);
    app.stopDrag();
    app.menu.dispose();
    if (app.conn) {
      app.conn.stop();
      app.conn = null;
    }
    if (app.unsub) app.unsub();
    window.removeEventListener("popstate", app.onPopState);
    rootEl.textContent = "";
  };
}

/* ------------------------------------------------------------------ */
/* Home / routes                                                       */
/* ------------------------------------------------------------------ */

/** The landing (ADR-0021): the app name, the tagline and exactly two
 *  actions. It carries no form and no skin switcher — that moved into the
 *  app-owned Menü (ADR-0023). */
function home(app: App): void {
  app.screen = "home";
  app.screenFromHome = false;
  app.menu.screenChanged("home");
  document.title = APP_NAME;
  app.liveRegions = [];
  // Returning to home is a screen change: no notice may follow it.
  resetEntryNotices(app);
  app.root.innerHTML = `
    <div class="sheet">
      <h1>${APP_NAME}</h1>
      <p class="dim">Ein Mehrspieler-Wörterspiel.</p>
      <div class="home-actions">
        <button id="create-btn">Raum erstellen</button>
        <button id="join-btn">Raum beitreten</button>
      </div>
    </div>`;
  app.root.querySelector<HTMLButtonElement>("#create-btn")!.onclick = () => openCreate(app);
  app.root.querySelector<HTMLButtonElement>("#join-btn")!.onclick = () => openJoin(app);
  renderNotices(app);
}

/** Enter Create as a new history entry (ADR-0021): Back returns to Home. */
function openCreate(app: App): void {
  pushEntry(app, { screen: "create", fromHome: true });
  renderCreate(app);
}

/** Enter Join as a new history entry. A deep link skips this: it renders
 *  Join in place and never pushes, so Back still leaves the app. */
function openJoin(app: App): void {
  pushEntry(app, { screen: "join", fromHome: true });
  renderJoin(app);
}

function pushEntry(app: App, state: EntryState): void {
  // The address bar keeps today's rule: entering an entry screen changes no
  // URL; only a snapshot naming a room claims `/r/<code>`.
  window.history.pushState(state, "", location.pathname);
  app.screenFromHome = true;
}

/** Renders the screen a history entry names. Called on popstate only. */
function showEntry(app: App, state: EntryState | null): void {
  if (state?.screen === "create") {
    app.screenFromHome = state.fromHome ?? false;
    renderCreate(app);
    return;
  }
  if (state?.screen === "join") {
    app.screenFromHome = state.fromHome ?? false;
    renderJoin(app, state.code);
    return;
  }
  home(app);
}

/** The in-screen Zurück: walk back to Home through history when this screen
 *  was entered from Home, otherwise (a deep link) replace the entry so the
 *  app stays here rather than falling out of the page. */
function backToHome(app: App): void {
  if (app.screenFromHome) {
    // Paint Home immediately; the popstate that follows confirms the same
    // entry, so the click never waits on browser history timing.
    window.history.back();
    home(app);
    return;
  }
  window.history.replaceState({ screen: "home" } satisfies EntryState, "", "/");
  home(app);
}

function resetEntryNotices(app: App): void {
  app.localError = null;
  app.store.lastError = null;
  app.connStatus = null;
}

/** The Create screen: one `Name` field and one create button. */
function renderCreate(app: App): void {
  app.screen = "create";
  app.menu.screenChanged("create");
  document.title = APP_NAME;
  app.liveRegions = [];
  resetEntryNotices(app);
  app.root.innerHTML = `
    <div class="sheet">
      <h1>Raum erstellen</h1>
      <section class="panel">
        <label>Name <input id="mk-nick" maxlength="24" placeholder="z. B. Anja" /></label>
        <button id="mk-btn">Raum erstellen</button>
      </section>
      <button id="back-btn">Zurück</button>
    </div>`;
  app.root.querySelector<HTMLButtonElement>("#mk-btn")!.onclick = () => {
    const nickname = input(app, "mk-nick");
    if (!nickname) {
      setLocalError(app, "Bitte gib einen Namen ein.");
      return;
    }
    startRoom(app, nickname, () => ({ type: "create-room", nickname }));
  };
  app.root.querySelector<HTMLButtonElement>("#back-btn")!.onclick = () => backToHome(app);
  renderNotices(app);
}

/** The Join screen. A deep-linked code is pre-filled and read-only, and the
 *  remembered session nickname pre-fills the name; a code reached from Home
 *  stays editable. */
function renderJoin(app: App, deepCode?: string): void {
  app.screen = "join";
  app.menu.screenChanged("join");
  document.title = APP_NAME;
  app.liveRegions = [];
  resetEntryNotices(app);
  const deep = typeof deepCode === "string" && deepCode !== "";
  const code = deep ? deepCode : "";
  const stored = deep ? loadSession(code) : null;
  app.root.innerHTML = `
    <div class="sheet">
      <h1>Raum beitreten</h1>
      <section class="panel">
        ${deep ? `<p class="note">Du wurdest in Raum ${escapeHtml(code)} eingeladen.</p>` : ""}
        <label>Raumcode <input id="jn-code" maxlength="8" autocapitalize="characters" placeholder="ABC12" value="${escapeHtml(code)}"${deep ? " readonly" : ""} /></label>
        <label>Name <input id="jn-nick" maxlength="24" placeholder="z. B. Jörg" value="${escapeHtml(stored?.nickname ?? "")}" /></label>
        <button id="jn-btn">Beitreten</button>
      </section>
      <button id="back-btn">Zurück</button>
    </div>`;
  app.root.querySelector<HTMLButtonElement>("#jn-btn")!.onclick = () => {
    const typedCode = (input(app, "jn-code") || code).trim().toUpperCase();
    const nickname = input(app, "jn-nick");
    if (!typedCode) {
      setLocalError(app, "Bitte gib einen Raumcode ein.");
      return;
    }
    if (!nickname) {
      setLocalError(app, "Bitte gib einen Namen ein.");
      return;
    }
    const greet: GreetFn = () => {
      const session = loadSession(typedCode);
      return session
        ? { type: "join", code: typedCode, nickname: session.nickname, token: session.token }
        : { type: "join", code: typedCode, nickname };
    };
    startRoom(app, typedCode, greet);
  };
  app.root.querySelector<HTMLButtonElement>("#back-btn")!.onclick = () => backToHome(app);
  renderNotices(app);
}

function deepLinkCode(): string | null {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]+)\/?$/);
  return m && m[1] ? m[1].toUpperCase() : null;
}

/* ------------------------------------------------------------------ */
/* Room shell                                                          */
/* ------------------------------------------------------------------ */

function startRoom(app: App, code: string, greet: GreetFn): void {
  app.inRoom = true;
  app.roomCode = code;
  // View state is local to one room visit: a new room starts at the grouped
  // reveal order and 0° rotation (ADR-0024).
  app.view.reset();
  app.conn = app.connect({
    code,
    greet,
    listener: (msg) => onMessage(app, msg),
    onStatus: (status) => onStatus(app, status),
    onClose: (outcome) => onClose(app, outcome),
  });
  if (app.unsub) app.unsub();
  app.unsub = app.store.subscribe((kind) => render(app, kind));
  // A retry follows a prior home error (a validation request or a rejected
  // greeting); the fresh attempt owns the form from here.
  clearError(app);
  app.conn.start();
  // The address bar stays on the home URL until a snapshot names the room
  // (syncRoomUrl): a rejected greeting must never claim `/r/<code>`.
  render(app);
  if (app.renderTimer) clearInterval(app.renderTimer);
  app.renderTimer = setInterval(() => updateTimer(app), 250);
}

function onMessage(app: App, msg: ServerMessage): void {
  // A greeting the server rejects before any snapshot is neither an
  // in-room error nor an unexpected close: the connection never became a
  // room, so the typed German verdict belongs on the Create/Join screen the
  // attempt was made from. `room-not-found` keeps its dedicated outcome
  // screen (#21) instead.
  if (isGreetingRejection(app, msg) && msg.code !== "room-not-found") {
    return rejectGreeting(app, msg);
  }
  // The view state must be current before the store notifies subscribers and
  // renders the screen (ADR-0024).
  app.view.apply(msg);
  app.store.apply(msg);
  // Room end and kick are close outcomes, reported once by the connection
  // after this frame reached the store (see `onClose`). `room-not-found`
  // stays a frame-driven outcome: the server only emits it when the room
  // is gone (bad join, a room the seat outlived) — never as a transient
  // mid-game verdict.
  if (msg.type === "error" && msg.code === "room-not-found")
    return renderOutcome(app, roomNotFoundOutcome(app));
}

/** A greeting rejection: an `error` frame that arrives while the join is
 *  still unconfirmed — no snapshot has named the room yet. This is the
 *  state a rejected greeting must be told apart by, distinct from an
 *  in-room error (a room is known) and a close outcome. */
function isGreetingRejection(app: App, msg: ServerMessage): msg is ServerErrorMsg {
  return app.inRoom && !app.store.code && msg.type === "error";
}

/** Rejected greeting (join/create): stop the connection so a retry starts
 *  fresh, stay on the entry screen still on screen — its typed values
 *  survive — and surface the shared German copy in the floating error
 *  slot. */
function rejectGreeting(app: App, msg: ServerErrorMsg): void {
  app.store.lastError = msg;
  const errorText = app.store.errorText;
  if (app.conn) {
    app.conn.stop();
    app.conn = null;
  }
  if (app.unsub) {
    app.unsub();
    app.unsub = null;
  }
  app.inRoom = false;
  app.connStatus = null;
  teardown(app);
  app.store.reset();
  setLocalError(app, errorText);
}

/** The address bar tells the room's real deep link — but only once a
 *  snapshot has named the room; a rejected greeting never claims it. */
function syncRoomUrl(app: App): void {
  if (!app.store.code) return;
  const want = `/r/${app.store.code}`;
  if (location.pathname !== want) window.history.replaceState({}, "", want);
}

function onStatus(app: App, status: ConnStatus): void {
  app.connStatus = status;
  render(app);
}

/** The connection's one close outcome (#123): kicked, room ended (with its
 *  reason) or an orderly close that carried no end frame. Each renders its
 *  dedicated screen; there is no separate status to race with the frame. */
function onClose(app: App, outcome: CloseOutcome): void {
  if (outcome.kind === "kicked") return renderOutcome(app, kickedOutcome(app));
  if (outcome.kind === "room-ended") return renderOutcome(app, roomEndedOutcome(app, outcome.reason));
  renderOutcome(app, {
    titleHtml: "Verbindung beendet.",
    noteHtml: OUTCOME_NOTE,
  });
}

function leaveRoom(app: App): void {
  if (app.conn) app.conn.request({ type: "leave" });
  exitToHome(app);
}

function exitToHome(app: App): void {
  if (app.store.code) clearSession(app.store.code);
  if (app.conn) {
    app.conn.stop();
    app.conn = null;
  }
  app.inRoom = false;
  teardown(app);
  app.store.reset();
  window.history.pushState({}, "", "/");
  home(app);
}

function teardown(app: App): void {
  if (app.renderTimer) {
    clearInterval(app.renderTimer);
    app.renderTimer = null;
  }
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

function render(app: App, kind: DeltaKind = "structural"): void {
  // The notification layer sits outside the screen, so it is refreshed on
  // every path — including while a Create/Join screen stays put during a
  // greeting.
  renderNotices(app);
  if (!app.inRoom) return;
  // A play-time delta changes only live, already-rendered game state: it
  // refreshes the running ring timer, the scoreboard and the found-word chips
  // in place, so the `#timer` element and its digits keep their identity and
  // never flash the ring's full-circle default. Every structural change
  // rebuilds the whole screen below.
  if (kind === "reveal-links") {
    updateRevealLinks(app);
    return;
  }
  if (kind === "play-time") {
    updateLive(app);
    return;
  }
  syncRoomUrl(app);
  switch (app.store.phase) {
    case "lobby":
      if (app.store.code) renderLobby(app);
      return;
    case "playing":
      renderGame(app);
      return;
    case "intermission":
      renderIntermission(app);
      return;
    default:
      return;
  }
}

/* ------------------------------------------------------------------ */
/* Clock and formatting — the timer's own helpers                      */
/* ------------------------------------------------------------------ */

/**
 * Local countdown interpolation, per spec: clients never own the clock. The
 * server re-anchors every second with a `tick`; between ticks the renderer
 * interpolates against the last-known absolute deadline. A locally expired
 * countdown clamps at 0 and waits for the server's next message — phases
 * change only upon server messages, never self-transitioned.
 */
function remainingOf(store: GameStore): number {
  if (store.phase !== "playing") return 0;
  if (!store.deadline) return 0;
  return Math.max(0, store.deadline - Date.now());
}

/** Countdown digits, rounded up to the next whole second. */
function fmt(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** At ≤ 20 s remaining, the countdown takes the low-time look (ADR-0002):
 *  one shared class for digits and ring, coloured through `--ping`. */
const LOW_TIME_MS = 20_000;

/** The ring timer (ADR-0002): conic-gradient progress ring over a solid
 *  inner disc; digits and round score sit centered on the disc. The ring's
 *  fraction is a `--p` knob (0..1), and the shared low-time look is one
 *  `low` class styling both digits and ring through the `--ping` token. */
function timerHtml(app: App): string {
  const state = timerState(app);
  return `
    <div id="timer" class="timer area-timer${state.low ? " low" : ""}" style="--p:${state.fraction.toFixed(4)}">
      <span id="countdown" class="timer-digits">${fmt(remainingOf(app.store))}</span>
      <span id="round-score" class="timer-score">${app.store.selfRoundScore} P</span>
    </div>`;
}

/** The ring timer's live state: progress fraction (0..1) across the round,
 *  and the shared low-time look toggle. Only the round has a countdown. */
function timerState(app: App): { fraction: number; low: boolean } {
  const remaining = remainingOf(app.store);
  return {
    fraction: Math.min(1, Math.max(0, remaining / PROTOCOL.ROUND_MS)),
    low: remaining <= LOW_TIME_MS,
  };
}

function updateTimer(app: App): void {
  if (app.store.phase !== "playing") return;
  const el = app.root.querySelector<HTMLElement>("#countdown");
  if (!el) return;
  const remaining = remainingOf(app.store);
  el.textContent = fmt(remaining);
  const timer = app.root.querySelector<HTMLElement>("#timer");
  if (timer) {
    const { fraction, low } = timerState(app);
    timer.style.setProperty("--p", fraction.toFixed(4));
    timer.classList.toggle("low", low);
  }
  const score = app.root.querySelector<HTMLElement>("#round-score");
  if (score) score.textContent = `${app.store.selfRoundScore} P`;
}

/** The scoreboard's mode in the current phase: the ranked round scoreboard
 *  while playing, the cumulative session standings during the intermission,
 *  the join-ordered roster otherwise. This is the single place the mode is
 *  decided, so a screen's first paint and its in-place update cannot disagree. */
function scoreboardMode(phase: GameStore["phase"]): "seats" | "ranked" | "session" {
  if (phase === "playing") return "ranked";
  if (phase === "intermission") return "session";
  return "seats";
}

/** The current scoreboard chips, in the mode its phase prescribes — read by
 *  both the screen templates and the in-place updater. */
function scoreboardHtml(store: GameStore): string {
  return playerChipsHtml(store, scoreboardMode(store.phase));
}

/**
 * One live, play-time-updatable region of a screen (ADR-0009): the element
 * that anchors it and the in-place rewrite that refreshes it from the store.
 * A screen declares these beside its template; the play-time updater walks
 * the current screen's declarations and skips any whose element the screen
 * does not render, so the `#timer` identity survives.
 */
interface LiveRegion {
  /** Selector of the element that anchors the region. */
  selector: string;
  /** Rewrites the region's element(s) in place from current store state. */
  update(app: App): void;
}

const TIMER_REGION: LiveRegion = { selector: "#timer", update: updateTimer };
const SCOREBOARD_REGION: LiveRegion = { selector: "#players", update: updateScoreboard };
const FOUND_REGION: LiveRegion = { selector: "#found", update: updateFound };

/** Late-arriving Wiktionary links patch only the reveal rows: no store-wide
 *  live region walk, so the finished board, timer and standings keep their
 *  identity. */
function updateRevealLinks(app: App): void {
  const el = app.root.querySelector<HTMLElement>("#reveal");
  if (el) el.innerHTML = revealHtml(app.store, app.view.revealOrder);
}

/** The in-place refresh of every live region the current screen declares
 *  (ADR-0009), in declaration order. A region whose element is absent from
 *  the screen (a spectator's found-word chips, a screen without a timer) is
 *  skipped, so the `#timer` identity is never touched. */
function updateLive(app: App): void {
  for (const region of app.liveRegions) {
    if (app.root.querySelector(region.selector)) region.update(app);
  }
}

/** Rewrites the live player chips in place — chip children change, the
 *  `#players` list element itself survives. */
function updateScoreboard(app: App): void {
  const el = app.root.querySelector<HTMLElement>("#players");
  if (!el) return;
  el.innerHTML = scoreboardHtml(app.store);
}

/** Rewrites the private found-word chips in place; absent for spectators. */
function updateFound(app: App): void {
  const el = app.root.querySelector<HTMLElement>("#found");
  if (!el) return;
  el.innerHTML = foundHtml(app.store);
}

/** The lobby's live region: the join-ordered seat roster. A play-time delta
 *  never reaches the lobby, but the declaration keeps its refresh path
 *  uniform with the other screens. */
const LOBBY_LIVE_REGIONS: readonly LiveRegion[] = [SCOREBOARD_REGION];

function renderLobby(app: App): void {
  app.menu.screenChanged(`lobby:${app.store.code}`);
  document.title = `${APP_NAME} — Raum ${app.store.code}`;
  // One source of truth for the join target (#48): the QR payload and the
  // plain-text fallback are the same absolute deep link, code uppercased.
  const code = app.store.code.toUpperCase();
  const deepLink = `${location.origin}/r/${code}`;
  app.root.innerHTML = `
    <div class="sheet">
      <h1>Raum ${escapeHtml(app.store.code)}</h1>
      <section class="panel invite">
        <h2>Einladen</h2>
        <p class="note">Scanne den Code mit der Kamera, um beizutreten.</p>
        ${qrSvg(deepLink)}
        <p class="invite-link"><code id="join-link">${escapeHtml(location.origin)}<wbr />/r/${escapeHtml(code)}</code></p>
      </section>
      <section class="panel">
        <h2>Spieler</h2>
        <ul id="players" class="chips">${scoreboardHtml(app.store)}</ul>
        <p class="dim">${app.store.players.filter((p) => p.connected).length} von 8 verbunden</p>
        ${
          app.store.isHost
            ? `<button id="start-btn">Runde starten</button>`
            : `<p class="dim">Warte auf den Gastgeber …</p>`
        }
      </section>
      ${leaveButtonHtml()}
    </div>`;
  app.liveRegions = LOBBY_LIVE_REGIONS;
  const start = app.root.querySelector<HTMLButtonElement>("#start-btn");
  if (start) {
    start.onclick = () => {
      clearError(app);
      app.conn!.request({ type: "start-round" });
    };
  }
  app.root.querySelector<HTMLButtonElement>("#leave-btn")!.onclick = () => leaveRoom(app);
}

/** The game screen's live regions: the ring timer, the ranked scoreboard and
 *  the private found-word chips (absent for a spectator, and skipped then). */
const GAME_LIVE_REGIONS: readonly LiveRegion[] = [TIMER_REGION, SCOREBOARD_REGION, FOUND_REGION];

function renderGame(app: App): void {
  app.menu.screenChanged(`game:${app.store.roundNumber}`);
  document.title = `${APP_NAME} — Runde ${app.store.roundNumber}`;
  const board = app.store.round?.board ?? [];
  const spectating = app.store.self.role === "spectator";
  app.root.innerHTML = `
    <div class="sheet">
      <div id="dashboard" class="dashboard">
        <h1 class="area-title">Runde ${app.store.roundNumber}</h1>
        ${timerHtml(app)}
        <section class="panel area-board">
          <h2>Spielfeld</h2>
          ${spectating ? "" : `<div id="trace" class="trace hint">${TRACE_HINT}</div>`}
          ${boardHtml(board, app.view.boardRotation)}
          ${boardRotationHtml()}
        </section>
        ${
          spectating
            ? `<section class="panel area-found">
                 <h2>Zuschauer</h2>
                 <p class="note">Du schaust zu. Ab der nächsten Runde bist du dabei.</p>
               </section>`
            : `<section class="panel area-found">
                 <h2>Deine Wörter</h2>
                 <ul id="found" class="chips">${foundHtml(app.store)}</ul>
               </section>`
        }
        <section class="panel area-score">
          <h2>Punkte</h2>
          <ul id="players" class="chips">${scoreboardHtml(app.store)}</ul>
        </section>
      </div>
      ${leaveButtonHtml()}
    </div>`;
  measureBoardGap(app);
  app.liveRegions = GAME_LIVE_REGIONS;
  wireBoardRotation(app);
  app.root.querySelector<HTMLButtonElement>("#leave-btn")!.onclick = () => leaveRoom(app);
  // Re-render can happen mid-drag (server deltas don't pause the game);
  // rehydrate the trace paint onto the fresh DOM.
  paintTrace(app);
}

/** The intermission's live region: the session standings. The pause has no
 *  countdown and no private found-word chips. */
const INTERMISSION_LIVE_REGIONS: readonly LiveRegion[] = [SCOREBOARD_REGION];

function renderIntermission(app: App): void {
  app.menu.screenChanged(`intermission:${app.store.finishedRound?.roundNumber ?? app.store.roundNumber}`);
  document.title = `${APP_NAME} — Pause`;
  const finishedRoundNumber = app.store.finishedRound?.roundNumber ?? app.store.roundNumber;
  const reveal = app.store.finishedRound?.reveal;
  const hasRevealWords = reveal ? revealWordCount(reveal) > 0 : false;
  // The finished board stays on screen: for live players it survives from
  // the round, and the intermission snapshot re-anchors it for joiners.
  const board = app.store.round?.board ?? [];
  app.root.innerHTML = `
    <div class="sheet">
      <div id="dashboard" class="dashboard intermission">
        <h1 class="area-title">Pause</h1>
        <section class="panel area-board">
          <h2>Runde ${finishedRoundNumber}</h2>
          ${boardHtml(board, app.view.boardRotation)}
          ${boardRotationHtml()}
        </section>
        <section class="panel area-reveal">
          <h2>Gefundene Wörter</h2>
          ${hasRevealWords ? revealSortHtml(app.view.revealOrder) : ""}
          <dl id="reveal">${revealHtml(app.store, app.view.revealOrder)}</dl>
        </section>
        <section class="panel area-score">
          <h2>Punkte</h2>
          <ul id="players" class="chips">${scoreboardHtml(app.store)}</ul>
          <p class="dim">Es zählt das Gesamtergebnis der Sitzung.</p>
        </section>
      </div>
      ${
        app.store.isHost
          ? `<button id="start-btn">Nächste Runde starten</button>`
          : `<p class="dim next-round-hint">Der Gastgeber startet die nächste Runde.</p>`
      }
      ${leaveButtonHtml()}
    </div>`;
  measureBoardGap(app);
  app.liveRegions = INTERMISSION_LIVE_REGIONS;
  wireRevealOrder(app);
  wireBoardRotation(app);
  const start = app.root.querySelector<HTMLButtonElement>("#start-btn");
  if (start)
    start.onclick = () => {
      clearError(app);
      app.conn!.request({ type: "start-round" });
    };
  app.root.querySelector<HTMLButtonElement>("#leave-btn")!.onclick = () => leaveRoom(app);
}

/**
 * The out-of-room outcome screens (#21): kicked, room ended (host
 * closed or expired), room not found and an unexpected connection
 * close — one settled screen each, a real action (back to home), built
 * from the same component vocabulary and tokens as the in-room screens
 * (ADR-0002). All texts are hardcoded German. Both fields carry the
 * final HTML (titles embed the room code as a `<code>` chip).
 */
interface OutcomeScreen {
  titleHtml: string;
  noteHtml: string;
}

function renderOutcome(app: App, outcome: OutcomeScreen): void {
  app.menu.screenChanged(`outcome:${outcome.titleHtml}`);
  if (app.conn) {
    app.conn.stop();
    app.conn = null;
  }
  app.inRoom = false;
  // Outcome screens are their own full explanation: no notice rides over
  // them, and the torn-down connection has no status.
  app.connStatus = null;
  app.localError = null;
  app.store.lastError = null;
  teardown(app);
  renderNotices(app);
  document.title = APP_NAME;
  app.liveRegions = [];
  app.root.innerHTML = `
    <div class="sheet">
      <h1>${outcome.titleHtml}</h1>
      <section class="panel">
        <p class="note">${outcome.noteHtml}</p>
        <button id="home-btn" class="icon-text-btn">${homeIcon}<span>Zur Startseite</span></button>
      </section>
    </div>`;
  app.root.querySelector<HTMLButtonElement>("#home-btn")!.onclick = () => exitToHome(app);
}

const OUTCOME_NOTE = "Du kannst einen neuen Raum erstellen oder einem anderen beitreten.";

function roomCodeHtml(code: string): string {
  return `<code>${escapeHtml(code)}</code>`;
}

function kickedOutcome(app: App): OutcomeScreen {
  return {
    titleHtml: `Du wurdest aus dem Raum ${roomCodeHtml(app.store.code)} entfernt.`,
    noteHtml: `Der Gastgeber hat dich aus dem Raum entfernt. ${OUTCOME_NOTE}`,
  };
}

function roomEndedOutcome(app: App, reason: RoomEndReason): OutcomeScreen {
  const code = roomCodeHtml(app.store.code);
  if (reason === "expired")
    return {
      titleHtml: `Raum ${code} ist abgelaufen.`,
      noteHtml: OUTCOME_NOTE,
    };
  return {
    titleHtml: `Raum ${code} wurde beendet.`,
    noteHtml: OUTCOME_NOTE,
  };
}

function roomNotFoundOutcome(app: App): OutcomeScreen {
  // No snapshot ever named the store; the join code the user typed is
  // the greeting key of the connection (kept on the app in startRoom).
  return {
    titleHtml: `Raum ${roomCodeHtml(app.roomCode)} nicht gefunden oder abgelaufen.`,
    noteHtml: `Prüfe den Raumcode, oder erstelle einen neuen Raum.`,
  };
}

/* ------------------------------------------------------------------ */
/* Drag word-input                                                     */
/* ------------------------------------------------------------------ */

/**
 * The drag word-input surface (#19): pressing a tile begins the trace;
 * moving through 8-way adjacent tiles extends it; moving onto the
 * immediately previous tile deselects it (backtracking); releasing submits
 * the traced string. The trace paints directly onto the rendered DOM (no
 * full re-render mid-drag) and clears on release — the verdict arrives as a
 * server message either way.
 *
 * The rules live in the pure `gesture` module (#120); this wiring keeps only
 * event binding, the point→tile hit-test and painting. It turns each event
 * into a normalized `GestureSample`, feeds it to the reducer and paints or
 * submits what the reducer decides.
 *
 * One gesture, both streams (this supersedes the #19 "pointer events carry
 * touch; touch handlers no-op once a pointer drag is live" decision): a
 * gesture begun by a pointer event accepts continuation from touch events
 * and vice versa, because Android Firefox commits to a pointer drag while
 * delivering movement only as `touchmove`. Movement seen through both
 * streams hits the same tile, and a second real release finds no live
 * gesture, so each gesture submits exactly once. A `pointercancel` for a
 * touch pointer does not end a gesture the touch stream still carries; a
 * mouse/pen cancel, or a `touchcancel`, does end it. Scroll/zoom under the
 * finger stays prevented: `touch-action: none` on the board, plus
 * `preventDefault` while a touch sample is claimed.
 */
function wireDrag(app: App): () => void {
  const root = app.root;

  /**
   * One browser event as a normalized sample: the wiring resolves the point
   * to a tile and decides whether the finger is clearly inside it, so the
   * rules stay geometry-free.
   */
  const sampleFor = (
    phase: GesturePhase,
    stream: GestureStream,
    id: number,
    x: number,
    y: number,
    target: EventTarget | null,
    pointerType?: PointerKind
  ): GestureSample => {
    const tile = hitTileIndex(app, x, y, target);
    return {
      phase,
      stream,
      id,
      point: { x, y },
      tile,
      clear: tile >= 0 && clearHit(app, tile, x, y),
      ...(pointerType ? { pointerType } : {}),
    };
  };

  /** Feeds one sample to the rules and paints/submits what they decide.
   *  Returns whether the sample was claimed, so a touch handler can stop
   *  the page from scrolling or zooming under the finger. */
  const feed = (sample: GestureSample): boolean => {
    const outcome = applyGestureSample(app.view.gesture, sample);
    app.view.gesture = outcome.state;
    if (outcome.submit) submitTrace(app, outcome.submit);
    else if (outcome.traceChanged) paintTrace(app);
    return outcome.claimed;
  };

  /** A press only opens a gesture on the player's own, live board; a press
   *  during a live gesture only joins its stream. */
  const mayBegin = () => app.store.phase === "playing" && app.store.self.role !== "spectator";

  const onPointerDown = (ev: PointerEvent) => {
    if (!app.view.gesture && !mayBegin()) return;
    feed(sampleFor("down", "pointer", ev.pointerId, ev.clientX, ev.clientY, ev.target, pointerKind(ev)));
  };
  const onPointerMove = (ev: PointerEvent) => {
    feed(sampleFor("move", "pointer", ev.pointerId, ev.clientX, ev.clientY, ev.target, pointerKind(ev)));
  };
  const onPointerUp = (ev: PointerEvent) => {
    feed(sampleFor("up", "pointer", ev.pointerId, ev.clientX, ev.clientY, ev.target, pointerKind(ev)));
  };
  const onPointerCancel = (ev: PointerEvent) => {
    feed(sampleFor("cancel", "pointer", ev.pointerId, ev.clientX, ev.clientY, ev.target, pointerKind(ev)));
  };

  const onTouchStart = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    if (!t) return;
    if (!app.view.gesture && !mayBegin()) return;
    if (feed(sampleFor("down", "touch", t.identifier, t.clientX, t.clientY, t.target))) ev.preventDefault();
  };
  const onTouchMove = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    if (!t) return;
    if (feed(sampleFor("move", "touch", t.identifier, t.clientX, t.clientY, t.target))) ev.preventDefault();
  };
  const onTouchEnd = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    const id = t ? t.identifier : app.view.gesture?.touchId;
    if (id === null || id === undefined) return;
    feed(sampleFor("up", "touch", id, t?.clientX ?? 0, t?.clientY ?? 0, t?.target ?? null));
  };
  const onTouchCancel = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    const id = t ? t.identifier : app.view.gesture?.touchId;
    if (id === null || id === undefined) return;
    feed(sampleFor("cancel", "touch", id, t?.clientX ?? 0, t?.clientY ?? 0, t?.target ?? null));
  };

  root.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);
  document.addEventListener("touchstart", onTouchStart, { passive: false });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd);
  document.addEventListener("touchcancel", onTouchCancel);
  return () => {
    root.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("touchcancel", onTouchCancel);
  };
}

/** A pointer event's `pointerType` (`lib.dom` types it as a plain string). */
function pointerKind(ev: PointerEvent): PointerKind {
  return ev.pointerType === "touch" || ev.pointerType === "pen" ? ev.pointerType : "mouse";
}

/**
 * How far (px) inside every edge of a tile a movement sample must land to
 * count as a clear hit. `measureBoardGap` reads it from the board's computed
 * gap (the `--board-gap` token) when the board renders: a sample in that gap,
 * or clipping a tile's edge or corner, rounds unpredictably to whichever
 * neighbour the browser's sub-pixel arithmetic picks, so it must not move
 * the trace. The gap stays well below half a cell, so a genuinely crossed
 * tile still offers clear ground.
 */
function clearHit(app: App, tile: number, x: number, y: number): boolean {
  const el = app.root.querySelector("#board")?.children[tile];
  if (!el) return false;
  const box = el.getBoundingClientRect();
  return !(
    x - box.left < app.clearHitMargin ||
    box.right - x < app.clearHitMargin ||
    y - box.top < app.clearHitMargin ||
    box.bottom - y < app.clearHitMargin
  );
}

/** Ends the trace: painting restores the idle hint and, on a real release
 *  during play, the traced string crosses the boundary as `submit-word`. The
 *  gesture state is already cleared, so the paint goes idle. */
function submitTrace(app: App, trace: number[]): void {
  paintTrace(app);
  const word = traceWord(app, trace);
  if (word && app.store.phase === "playing") {
    // A new submit is the action that addresses the previous rejection, so
    // the old verdict leaves at once.
    clearError(app);
    app.conn?.request({ type: "submit-word", word });
  }
}

/** The string a release would submit: each traced cell's tile letters, in
 *  order. The trace holds grid cells, so the rotation maps a cell back to
 *  its server board index before reading the tile — the submitted word is
 *  always exactly what the tiles under the finger spell (issue #151).
 *  Either/or tiles contribute their first variant (swipes don't choose
 *  variants — later tickets own special-tile input). */
function traceWord(app: App, trace: readonly number[]): string {
  const board = app.store.round?.board ?? [];
  return trace
    .map((cell) => tileStrings(board[serverBoardIndex(cell, app.view.boardRotation)] ?? "")[0] ?? "")
    .join("");
}

/** Point → tile resolution, the same for mouse and finger. Real browsers
 *  answer with `elementFromPoint` (events retarget under touch, so the
 *  event target is not the current tile); the target is only a fallback. */
function hitTileIndex(app: App, x: number, y: number, target: EventTarget | null): number {
  if (!app.store.round) return -1;
  const board = app.root.querySelector("#board");
  if (!board) return -1;
  let el: Element | null = document.elementFromPoint(x, y);
  el = el ? el.closest(".tile") : null;
  if (!el && target instanceof Element) el = target.closest(".tile");
  if (!el || !board.contains(el)) return -1;
  const parent = el.parentElement;
  if (!parent) return -1;
  return Array.prototype.indexOf.call(parent.children, el);
}

/** Paints the trace onto the live DOM: `.sel` on selected tiles, the
 *  would-be word (or the idle hint) in the trace line. */
function paintTrace(app: App): void {
  const trace = app.view.gesture?.trace ?? [];
  const board = app.root.querySelector("#board");
  if (board) {
    for (const el of board.children) el.classList.remove("sel");
    for (const idx of trace) {
      const el = board.children[idx];
      if (el) el.classList.add("sel");
    }
  }
  const el = app.root.querySelector<HTMLElement>("#trace");
  if (!el) return;
  if (trace.length > 0) {
    el.classList.remove("hint");
    el.textContent = displayWord(traceWord(app, trace));
  } else {
    el.classList.add("hint");
    el.textContent = TRACE_HINT;
  }
}

/* ------------------------------------------------------------------ */
/* Fragments / helpers                                                 */
/* ------------------------------------------------------------------ */

function statusNoticeText(app: App): string {
  if (app.connStatus === "connecting") return "Verbinde …";
  if (app.connStatus === "retrying") return "Verbindung wird wiederhergestellt …";
  return "";
}

/** The error slot's one message: the server's catalogue text when present,
 *  otherwise the current local validation string. */
function errorNoticeText(app: App): string {
  return app.store.lastError ? app.store.errorText : (app.localError ?? "");
}

/** Refreshes the two app-owned slots from existing state. A slot whose text
 *  is unchanged is left untouched: no re-announcement, no entry animation. */
function renderNotices(app: App): void {
  setNotice(app.noticeStatus, statusNoticeText(app));
  setNotice(app.noticeError, errorNoticeText(app));
}

function setNotice(el: HTMLElement, text: string): void {
  if (el.textContent === text) return;
  el.textContent = text;
  if (text === "") {
    el.classList.remove("enter");
    return;
  }
  // Restart the entry animation for a genuinely new message, but never for
  // an identical repeat (the early return above).
  el.classList.remove("enter");
  void el.offsetWidth;
  el.classList.add("enter");
}

/** A fresh action (retry, new submit, new start attempt) addresses the
 *  current error: both sources clear together. */
function clearError(app: App): void {
  app.localError = null;
  app.store.lastError = null;
  renderNotices(app);
}

/** Local validation copy goes to the same error slot as server errors. */
function setLocalError(app: App, msg: string): void {
  app.localError = msg;
  app.store.lastError = null;
  renderNotices(app);
}

/**
 * The shared player chip (ADR-0002's one component vocabulary): nickname,
 * role and connection state live on one chip per person — a person renders
 * exactly once per screen, in lobby and game alike.
 *
 * Modes:
 * - `seats`: the lobby's join-ordered roster, numbered by seat order.
 * - `ranked`: the live scoreboard — ordered by round score, ties share a
 *   place, join order settles the display order inside a tie.
 * - `session`: the intermission standings (#22) — round score and
 *   cumulative session score side by side on one chip, ordered by
 *   cumulative score (the session's winner key), ties sharing a place.
 */
function playerChipsHtml(store: GameStore, mode: "seats" | "ranked" | "session" = "seats"): string {
  const render = (p: PlayerInfo, prefixHtml: string, scoreHtml: string, modifier = ""): string => {
    const self = p.seatId === store.self.seatId;
    const me = self ? " me" : "";
    const host = p.seatId === store.hostSeatId ? `<span class="badge host">Gastgeber</span>` : "";
    const spectator = p.role === "spectator" ? `<span class="badge spec">Zuschauer</span>` : "";
    const linked = p.connected
      ? `<span class="dot on"></span>`
      : `<span class="dot off"></span><span class="away">unterbrochen</span>`;
    return `<li class="chip player${modifier}${me}">${prefixHtml}<span class="nick">${escapeHtml(p.nickname)}</span>${host}${spectator}${scoreHtml}${linked}</li>`;
  };
  if (mode === "ranked") {
    return store
      .rankedPlayers()
      .map((r) =>
        render(
          r.player,
          `<span class="place">${r.place}</span>`,
          `<small class="score">${r.roundScore} P</small>`
        )
      )
      .join("");
  }
  if (mode === "session") {
    // The session standings chip wraps internally: each segment is its own
    // flex item, so a narrow Punkte panel breaks the row instead of letting
    // it overflow. Both scores stay separately addressable — and visible.
    return store
      .sessionRanked()
      .map((r) =>
        render(
          r.player,
          `<span class="place">${r.place}</span>`,
          `<small class="score round-score">Runde ${r.roundScore} P</small>` +
            `<span class="score-sep"> · </span>` +
            `<small class="score cumulative-score">Gesamt ${r.cumulativeScore} P</small>`,
          " session"
        )
      )
      .join("");
  }
  return store.players.map((p, i) => render(p, `<span class="no">${i + 1}.</span> `, "")).join("");
}

/**
 * The concrete reveal (#17, #22). `length` keeps the server's grouped
 * default untouched: groups ascend by length and each group's word order is
 * exactly what the server sent. `points` and `alphabet` flatten the same
 * payload into one list, both compared with a German collator so umlauts
 * sort near their base vowels and `ß` sorts as `ss`. Missed words stay
 * visible — dimmed, without invented credit. No tile paths, no first-finder
 * marks.
 */
function revealHtml(store: GameStore, mode: RevealOrder): string {
  const reveal = store.finishedRound?.reveal;
  if (!reveal || revealWordCount(reveal) === 0) return "<dt>Ergebnisse</dt><dd>—</dd>";
  if (mode === "length") {
    return reveal.groups
      .map(
        (g) =>
          `<dt>${g.length} Buchstaben</dt><dd>${g.words.map((w) => revealWordHtml(store, w)).join(" ")}</dd>`
      )
      .join("");
  }
  const words = reveal.groups.flatMap((g) => g.words);
  const ordered =
    mode === "points"
      ? [...words].sort((a, b) => b.points - a.points || germanCompare(a, b))
      : [...words].sort(germanCompare);
  return `<dd class="reveal-flat">${ordered.map((w) => revealWordHtml(store, w)).join(" ")}</dd>`;
}

/** One word in every reveal mode: its points, one found-by chip per finder
 *  and the dimmed treatment for a word nobody found. A word with a resolved
 *  Wiktionary entry carries a quiet outbound link after the word itself. */
function revealWordHtml(store: GameStore, w: RevealWord): string {
  const by = w.foundBy
    .map((id) => store.players.find((p) => p.seatId === id)?.nickname)
    .filter((n): n is string => Boolean(n))
    .map((n) => `<span class="fby">${escapeHtml(n)}</span>`)
    .join("");
  const missed = w.foundBy.length === 0 ? " missed" : "";
  const url = store.wikiLinks.get(w.word);
  const link = url
    ? `<a class="rw-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${WIKTIONARY_LABEL}" title="${WIKTIONARY_LABEL}">↗</a>`
    : "";
  return `<span class="rw${missed}"><span class="rw-word">${escapeHtml(displayWord(w.word))}</span>${link}<small class="rw-pts">+${w.points}</small>${by}</span>`;
}

/** The German accessible name and tooltip of a reveal's outbound link. */
const WIKTIONARY_LABEL = "Bei Wiktionary nachschlagen";

const GERMAN_COLLATOR = new Intl.Collator("de");

function germanCompare(a: RevealWord, b: RevealWord): number {
  return GERMAN_COLLATOR.compare(a.word, b.word);
}

function revealWordCount(reveal: RevealPayload): number {
  return reveal.groups.reduce((count, group) => count + group.words.length, 0);
}

/** The reveal's three local sort modes, in display order. Each label is
 *  the one string used as both the accessible name and the tooltip. */
const REVEAL_SORTS: readonly { mode: RevealOrder; icon: string; label: string }[] = [
  { mode: "length", icon: sortLengthIcon, label: "Nach Länge sortieren" },
  { mode: "points", icon: sortPointsIcon, label: "Nach Punkten sortieren" },
  { mode: "alphabet", icon: sortAlphabetIcon, label: "Alphabetisch sortieren" },
];

/** The pressed-state button group. Selection is announced by
 *  `aria-pressed` and shown by a filled target plus an underline, never by
 *  colour alone. The group label itself is gone (ADR-0022). */
function revealSortHtml(active: RevealOrder): string {
  return `<div id="reveal-sort" class="reveal-sort">
    ${REVEAL_SORTS.map(({ mode, icon, label }) =>
      iconButtonHtml({
        className: `icon-btn sort-btn${mode === active ? " active" : ""}`,
        icon,
        label,
        data: `data-sort="${mode}"`,
        pressed: mode === active,
      })
    ).join("")}
  </div>`;
}

/** Wires the sort buttons to a reveal-only repaint: no store notification,
 *  no rebuild, no wire message, so the finished board keeps its identity and
 *  the hidden intermission timer (if any) is never touched. */
function wireRevealOrder(app: App): void {
  for (const button of app.root.querySelectorAll<HTMLButtonElement>("#reveal-sort button")) {
    button.onclick = () => {
      const mode = button.dataset.sort as RevealOrder | undefined;
      if (!mode || mode === app.view.revealOrder) return;
      app.view.revealOrder = mode;
      const reveal = app.root.querySelector<HTMLElement>("#reveal");
      if (reveal) reveal.innerHTML = revealHtml(app.store, app.view.revealOrder);
      for (const other of app.root.querySelectorAll<HTMLButtonElement>("#reveal-sort button")) {
        const pressed = other.dataset.sort === app.view.revealOrder;
        other.setAttribute("aria-pressed", String(pressed));
        other.classList.toggle("active", pressed);
      }
    };
  }
}

/** Wires the one rotation button to an arrangement-only repaint: no store
 *  notification and no wire message, so the board data, score and timer
 *  identity stay untouched. View state owns the quarter turn and ends any
 *  live gesture first, so a trace can never span two arrangements
 *  (issue #151). */
function wireBoardRotation(app: App): void {
  const button = app.root.querySelector<HTMLButtonElement>("#board-rotation");
  if (!button) return;
  button.onclick = () => {
    app.view.rotate();
    repaintBoard(app);
    paintTrace(app);
  };
}

/** Re-renders only the board tiles in place: the board element survives, as
 *  do the timer, scoreboard and found-word chips around it. The stable
 *  control needs no pressed-state repaint. */
function repaintBoard(app: App): void {
  const board = app.store.round?.board ?? [];
  const el = app.root.querySelector<HTMLElement>("#board");
  if (el) {
    el.dataset.rotation = String(app.view.boardRotation);
    el.setAttribute("style", boardSpanStyle(board));
    el.innerHTML = boardTilesHtml(board, app.view.boardRotation);
  }
}

/** The private found-word chips: what I found this round, with each word's
 *  points value. Cleared at every round start. */
function foundHtml(store: GameStore): string {
  const chips = [...store.roundWords]
    .map(
      ([word, points]) =>
        `<li class="chip find"><span>${escapeHtml(displayWord(word))}</span> <small>+${points}</small></li>`
    )
    .join("");
  return chips || `<li class="chip none">—</li>`;
}

function input(app: App, id: string): string {
  const el = app.root.querySelector<HTMLInputElement>(`#${id}`);
  return el ? el.value.trim() : "";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}
