import { loadSession, clearSession, type ConnStatus } from "./api.js";
import { applyDelta, remainingOf, fmt, LOW_TIME_MS } from "./deltas.js";
import { GameStore } from "./store.js";
import type { ClientMessage, PlayerInfo, RoomsEndedMsg, ServerMessage } from "@wordament/shared";
import { neighbors, PROTOCOL, tileSpellingLength, tileStrings } from "@wordament/shared";
import "./style.css";

/**
 * Screens of the minimal functional shell (visual language is ticket #8):
 * - Home: create a room / join by code (a stored session auto-reclaims).
 * - Lobby: waiting room; the host starts at >= 2 players.
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

/** Builds the greeting message the connection sends once its transport is
 *  up (create-room, or join with a stored session token). */
export type GreetFn = () => ClientMessage | null;

/** How a room connection comes to be. The factory receives the room code,
 *  the greeting builder and the app's two callbacks; it returns an
 *  unstarted connection the app then `start()`s. */
export type ConnFactory = (opts: {
  code: string;
  greet: GreetFn;
  listener: (msg: ServerMessage) => void;
  onStatus: (status: ConnStatus) => void;
}) => RoomConn;

type Unsubscribe = () => void;

/** The live drag state: a selected tile path. `null` between drags. */
type DragHandle = { kind: "pointer" | "touch"; id: number } | null;

interface App {
  root: HTMLElement;
  connect: ConnFactory;
  store: GameStore;
  conn: RoomConn | null;
  renderTimer: ReturnType<typeof setInterval> | null;
  inRoom: boolean;
  connStatus: ConnStatus;
  unsub: Unsubscribe | null;
  /** The room code this mount's connection was built for — creating a
   *  room greets with the nickname, and the server names the room later
   *  (first snapshot). The outcome screens that fire without a snapshot
   *  (room-not-found) still name the code the user typed. */
  roomCode: string;
  onPopState: () => void;
  stopDrag: () => void;
  trace: number[];
  dragging: DragHandle;
}

/** The one sentence the drag surface shows between words. */
const TRACE_HINT = "Ziehe über die Felder, um ein Wort zu bilden.";

/** Display is independent of data (ADR-0002): the notation's markers drop
 *  off — prefixes render without their trailing `-`, suffixes without
 *  their leading `-`; either/or tiles show both candidate variants. The
 *  trace and scores keep spelling the data's real letters. */
function displayTile(t: string): string {
  if (t.includes("/")) return t;
  return t.replace(/^-|-$/g, "");
}

/**
 * Mounts the app into `rootEl`, which renders to the home screen
 * immediately. Returns the unmount function: it stops the countdown
 * render timer, stops any live connection, unsubscribes, removes the
 * popstate listener, unbinds the drag surface and clears the root. Call
 * exactly once per mount.
 */
export function mount(rootEl: HTMLElement, connect: ConnFactory): () => void {
  const app: App = {
    root: rootEl,
    connect,
    store: new GameStore(),
    conn: null,
    renderTimer: null,
    inRoom: false,
    connStatus: "connecting",
    unsub: null,
    roomCode: "",
    onPopState: () => {
      if (!app.inRoom) home(app);
    },
    stopDrag: () => {},
    trace: [],
    dragging: null,
  };
  window.addEventListener("popstate", app.onPopState);
  app.stopDrag = wireDrag(app);
  home(app);
  return () => {
    teardown(app);
    app.stopDrag();
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

function home(app: App): void {
  document.title = "WortMeister";
  const deepCode = deepLinkCode();
  const stored = deepCode ? loadSession(deepCode) : null;
  app.root.innerHTML = `
    <div class="sheet">
      <h1>WortMeister</h1>
      <p class="dim">Gemeinsam deutsche Wörter finden — real-time, privat, ohne Konto.</p>
      <section class="panel">
        <h2>Raum erstellen</h2>
        <label>Spitzname <input id="mk-nick" maxlength="24" placeholder="z. B. Lena" /></label>
        <button id="mk-btn">Neuen Raum erstellen</button>
      </section>
      <section class="panel">
        <h2>Raum beitreten</h2>
        ${deepCode ? `<p class="note">Du wurdest in Raum ${escapeHtml(deepCode)} eingeladen.</p>` : ""}
        <label>Raumcode <input id="jn-code" maxlength="8" autocapitalize="characters" placeholder="ABC12" value="${deepCode ?? ""}" /></label>
        <label>Spitzname <input id="jn-nick" maxlength="24" placeholder="z. B. Ben" value="${stored?.nickname ?? ""}" /></label>
        <button id="jn-btn">Beitreten</button>
      </section>
      <p id="home-errors"></p>
    </div>`;
  app.root.querySelector<HTMLButtonElement>("#mk-btn")!.onclick = () => {
    const nickname = input(app, "mk-nick");
    if (!nickname) {
      setHomeError(app, "Bitte gib einen Spitznamen ein.");
      return;
    }
    startRoom(app, nickname, () => ({ type: "create-room", nickname }));
  };
  app.root.querySelector<HTMLButtonElement>("#jn-btn")!.onclick = () => {
    const code = (input(app, "jn-code") || deepCode || "").trim().toUpperCase();
    const nickname = input(app, "jn-nick");
    if (!code) {
      setHomeError(app, "Bitte gib einen Raumcode ein.");
      return;
    }
    if (!nickname) {
      setHomeError(app, "Bitte gib einen Spitznamen ein.");
      return;
    }
    const greet: GreetFn = () => {
      const session = loadSession(code);
      return session
        ? { type: "join", code, nickname: session.nickname, token: session.token }
        : { type: "join", code, nickname };
    };
    startRoom(app, code, greet);
  };
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
  app.conn = app.connect({
    code,
    greet,
    listener: (msg) => onMessage(app, msg),
    onStatus: (status) => onStatus(app, status),
  });
  if (app.unsub) app.unsub();
  app.unsub = app.store.subscribe(() => render(app));
  app.conn.start();
  window.history.pushState({}, "", `/r/${code}`);
  render(app);
  if (app.renderTimer) clearInterval(app.renderTimer);
  app.renderTimer = setInterval(() => updateTimer(app), 250);
}

function onMessage(app: App, msg: ServerMessage): void {
  applyDelta(app.store, msg);
  // The outcome frames (#21) each render their own dedicated screen.
  // The connection's orderly close is reported first (RoomConnection
  // fires `closed` before the frame arrives), so the dispatch avoids
  // the `inRoom`-gated render() — the boundary's word is the trigger.
  // `room-not-found` fires the generic outcome wherever it lands: the
  // server only emits it when the room is gone (bad join, a room the
  // seat outlived) — never as a transient mid-game verdict.
  if (msg.type === "kicked") return renderOutcome(app, kickedOutcome(app));
  if (msg.type === "room-ended") return renderOutcome(app, roomEndedOutcome(app, msg));
  if (msg.type === "error" && msg.code === "room-not-found")
    return renderOutcome(app, roomNotFoundOutcome(app));
}

/** The address bar tells the room's real deep link: creating a room pushes
 *  the greeting key (nickname) before the server names the room, so the
 *  first snapshot replaces it with the true /r/<code>. */
function syncRoomUrl(app: App): void {
  if (!app.store.code) return;
  const want = `/r/${app.store.code}`;
  if (location.pathname !== want) window.history.replaceState({}, "", want);
}

function onStatus(app: App, status: ConnStatus): void {
  app.connStatus = status;
  if (status === "closed" && app.store.outcome === "none") {
    // An unexpected transport close arrives with no server frame ahead;
    // the boundary's own screen carries the generic German note (#21).
    return renderOutcome(app, {
      titleHtml: "Verbindung beendet.",
      noteHtml: OUTCOME_NOTE,
    });
  }
  render(app);
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

function render(app: App): void {
  if (!app.inRoom) return;
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

/** The ring timer's live state: progress fraction (0..1) across the wall
 *  length of the current phase, and the shared low-time look toggle. */
function timerState(app: App): { fraction: number; low: boolean } {
  const remaining = remainingOf(app.store);
  return {
    fraction: Math.min(1, Math.max(0, remaining / totalPhaseMs(app.store.phase))),
    low: remaining <= LOW_TIME_MS,
  };
}

/** The wall length of the current countdown phase — the ring's 1.0 point. */
function totalPhaseMs(phase: GameStore["phase"]): number {
  return phase === "playing" ? PROTOCOL.ROUND_MS : PROTOCOL.INTERMISSION_MS;
}

function updateTimer(app: App): void {
  if (app.store.phase !== "playing" && app.store.phase !== "intermission") return;
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

function renderLobby(app: App): void {
  document.title = `WortMeister — Raum ${app.store.code}`;
  app.root.innerHTML = `
    <div class="sheet">
      <h1>Raum ${escapeHtml(app.store.code)}</h1>
      <p>Lade Freunde über den Deep-Link ein:<br /><code>${escapeHtml(location.origin)}<wbr />/r/${escapeHtml(app.store.code)}</code></p>
      ${statusHtml(app)}
      <section class="panel">
        <h2>Spieler</h2>
        <ul id="players" class="chips">${playerChipsHtml(app.store)}</ul>
        <p class="dim">${app.store.players.filter((p) => p.connected).length} verbunden von max. 8</p>
        ${
          app.store.isHost
            ? `<button id="start-btn">Runde starten</button><span id="start-hint" class="dim"></span>`
            : `<p class="dim">Warte auf den Gastgeber …</p>`
        }
      </section>
      <button id="leave-btn">Zurück zur Startseite</button>
    </div>`;
  const start = app.root.querySelector<HTMLButtonElement>("#start-btn");
  if (start) {
    start.onclick = () => {
      app.conn!.request({ type: "start-round" });
    };
  }
  app.root.querySelector<HTMLButtonElement>("#leave-btn")!.onclick = () => leaveRoom(app);
  if (app.store.lastError) {
    const hint = app.root.querySelector("#start-hint");
    if (hint) hint.textContent = app.store.errorText;
  }
}

function renderGame(app: App): void {
  document.title = `WortMeister — Runde ${app.store.roundNumber}`;
  const board = app.store.round?.board ?? [];
  const spectating = app.store.self.role === "spectator";
  // Font sizing lives on the grid container via the widest tile span knob
  // (ADR-0002): per-tile `em` resolves against the parent and breaks.
  const tileSpan = Math.max(1, ...board.map((t) => tileSpellingLength(t)));
  app.root.innerHTML = `
    <div class="sheet">
      ${statusHtml(app)}
      ${app.store.lastError ? `<p id="error">${escapeHtml(app.store.errorText)}</p>` : ""}
      <div id="dashboard" class="dashboard">
        <h1 class="area-title">Runde ${app.store.roundNumber}</h1>
        ${timerHtml(app)}
        <section class="panel area-board">
          <h2>Spielbrett</h2>
          ${spectating ? "" : `<div id="trace" class="trace hint">${TRACE_HINT}</div>`}
          <div id="board" class="board" style="--tile-span:${tileSpan}">${board
            .map(
              (t, i) => `<div class="tile">${escapeHtml(displayTile(t))}<span class="idx">${i}</span></div>`
            )
            .join("")}</div>
        </section>
        ${
          spectating
            ? `<section class="panel area-found">
                 <h2>Zuschauer</h2>
                 <p class="note">Du schaust zu — ab der nächsten Runde spielst du mit.</p>
               </section>`
            : `<section class="panel area-found">
                 <h2>Deine Funde</h2>
                 <ul id="found" class="chips">${foundHtml(app.store)}</ul>
               </section>`
        }
        <section class="panel area-score">
          <h2>Punkte</h2>
          <ul id="players" class="chips">${playerChipsHtml(app.store, "ranked")}</ul>
        </section>
      </div>
      <button id="leave-btn">Raum verlassen</button>
    </div>`;
  app.root.querySelector<HTMLButtonElement>("#leave-btn")!.onclick = () => leaveRoom(app);
  // Re-render can happen mid-drag (server deltas don't pause the game);
  // rehydrate the trace paint onto the fresh DOM.
  paintTrace(app);
}

function renderIntermission(app: App): void {
  document.title = "WortMeister — Zwischenspiel";
  app.root.innerHTML = `
    <div class="sheet">
      <h1>Zwischenspiel <span id="countdown">${fmt(remainingOf(app.store))}</span></h1>
      ${statusHtml(app)}
      <section class="panel">
        <h2>Runde ${app.store.finishedRound?.roundNumber ?? app.store.roundNumber}</h2>
        <div class="board dim">${(app.store.round?.board ?? [])
          .map((t) => `<div class="tile">${escapeHtml(displayTile(t))}</div>`)
          .join("")}</div>
        <dl id="reveal">${revealHtml(app.store)}</dl>
      </section>
      <section class="panel">
        <h2>Punkte</h2>
        <ul id="players" class="chips">${playerChipsHtml(app.store, "totals")}</ul>
      </section>
      ${
        app.store.isHost
          ? `<button id="skip-btn">Nächste Runde starten</button>`
          : `<p class="dim">Die nächste Runde startet gleich …</p>`
      }
      <button id="leave-btn">Raum verlassen</button>
    </div>`;
  const skip = app.root.querySelector<HTMLButtonElement>("#skip-btn");
  if (skip) skip.onclick = () => app.conn!.request({ type: "skip" });
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
  if (app.conn) {
    app.conn.stop();
    app.conn = null;
  }
  app.inRoom = false;
  teardown(app);
  document.title = "WortMeister";
  app.root.innerHTML = `
    <div class="sheet">
      <h1>${outcome.titleHtml}</h1>
      <section class="panel">
        <h2>Wie geht es weiter?</h2>
        <p class="note">${outcome.noteHtml}</p>
        <button id="home-btn">Zur Startseite</button>
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

function roomEndedOutcome(app: App, msg: RoomsEndedMsg): OutcomeScreen {
  const code = roomCodeHtml(app.store.code);
  if (msg.reason === "expired")
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
 * The pointer drag surface replacing the typed input (#19): pressing a
 * tile begins the trace; moving through 8-way adjacent tiles extends it;
 * moving onto the immediately previous tile deselects it (backtracking);
 * releasing submits the traced string. The trace paints directly onto the
 * rendered DOM (no full re-render mid-drag) and clears on release — the
 * verdict arrives as a server message either way.
 *
 * Pointer events carry touch; touch events are bound too for platforms
 * without PointerEvent, and no-op when a pointer drag is already live
 * (browsers fire both for the same gesture). Scroll/zoom under the finger
 * is prevented on the wire: `touch-action: none` on the board, plus
 * `preventDefault` while a touch drag moves.
 */
function wireDrag(app: App): () => void {
  const root = app.root;

  const onPointerDown = (ev: PointerEvent) => {
    beginTrace(app, { kind: "pointer", id: ev.pointerId }, ev.clientX, ev.clientY, ev.target);
  };
  const onPointerMove = (ev: PointerEvent) => {
    continueTrace(
      app,
      ev.clientX,
      ev.clientY,
      ev.target,
      app.dragging?.kind === "pointer" && app.dragging.id === ev.pointerId
    );
  };
  const onPointerUp = (ev: PointerEvent) => {
    if (app.dragging?.kind === "pointer" && app.dragging.id === ev.pointerId) releaseTrace(app, true);
  };
  const onPointerCancel = () => {
    releaseTrace(app, false);
  };

  const onTouchStart = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    if (!t) return;
    if (beginTrace(app, { kind: "touch", id: t.identifier }, t.clientX, t.clientY, t.target))
      ev.preventDefault();
  };
  const onTouchMove = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    if (!t) return;
    if (
      continueTrace(
        app,
        t.clientX,
        t.clientY,
        t.target,
        app.dragging?.kind === "touch" && app.dragging.id === t.identifier
      )
    )
      ev.preventDefault();
  };
  const onTouchEnd = () => {
    if (app.dragging?.kind === "touch") releaseTrace(app, true);
  };

  root.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);
  document.addEventListener("touchstart", onTouchStart, { passive: false });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd);
  document.addEventListener("touchcancel", onPointerCancel);
  return () => {
    root.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("touchcancel", onPointerCancel);
  };
}

/** Starts a trace if the press lands on a rendered game tile during play.
 *  Returns whether the trace began (and thus whether the gesture was
 *  claimed — touch handlers preventDefault only then). */
function beginTrace(
  app: App,
  drag: NonNullable<DragHandle>,
  x: number,
  y: number,
  target: EventTarget | null
): boolean {
  if (app.dragging) return false;
  if (app.store.phase !== "playing" || app.store.self.role === "spectator") return false;
  const idx = hitTileIndex(app, x, y, target);
  if (idx < 0) return false;
  app.trace = [idx];
  app.dragging = drag;
  paintTrace(app);
  return true;
}

/** Extends/unwinds the live trace for the tile under the pointer. */
function continueTrace(app: App, x: number, y: number, target: EventTarget | null, mine: boolean): boolean {
  if (!mine) return false;
  const idx = hitTileIndex(app, x, y, target);
  if (idx < 0) return false;
  const trace = app.trace;
  const last = trace[trace.length - 1];
  if (last === undefined) return false;
  const prev = trace[trace.length - 2];
  if (idx === last) return false; // still on the current tile
  if (idx === prev)
    trace.pop(); // backtracking unwinds the previous tile
  else if (trace.includes(idx))
    return false; // crossings stay out
  else if (!neighbors(last).includes(idx))
    return false; // adjacent steps only
  else trace.push(idx);
  paintTrace(app);
  return true;
}

/** Ends the trace: painting restores the idle hint and, on a real release
 *  during play, the traced string crosses the boundary as `submit-word`. */
function releaseTrace(app: App, submit: boolean): void {
  const word = traceWord(app);
  app.trace = [];
  app.dragging = null;
  paintTrace(app);
  if (submit && word && app.store.phase === "playing") {
    app.conn?.request({ type: "submit-word", word });
  }
}

/** The string a release would submit: each traced tile's letters, in
 *  order. Either/or tiles contribute their first variant (swipes don't
 *  choose variants — later tickets own special-tile input). */
function traceWord(app: App): string {
  const board = app.store.round?.board ?? [];
  return app.trace.map((i) => tileStrings(board[i] ?? "")[0] ?? "").join("");
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
  const board = app.root.querySelector("#board");
  if (board) {
    for (const el of board.children) el.classList.remove("sel");
    for (const idx of app.trace) {
      const el = board.children[idx];
      if (el) el.classList.add("sel");
    }
  }
  const el = app.root.querySelector<HTMLElement>("#trace");
  if (!el) return;
  if (app.trace.length > 0) {
    el.classList.remove("hint");
    el.textContent = traceWord(app);
  } else {
    el.classList.add("hint");
    el.textContent = TRACE_HINT;
  }
}

/* ------------------------------------------------------------------ */
/* Fragments / helpers                                                 */
/* ------------------------------------------------------------------ */

function statusHtml(app: App): string {
  if (app.connStatus === "open") return "";
  return `<p class="dim">${app.connStatus === "retrying" ? "Verbindung wird wiederhergestellt …" : "Verbinde …"}</p>`;
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
 * - `totals`: cumulative standing (intermission; #22 owns its revisiting).
 */
function playerChipsHtml(store: GameStore, mode: "seats" | "ranked" | "totals" = "seats"): string {
  const render = (p: PlayerInfo, prefixHtml: string, scoreText: string): string => {
    const self = p.seatId === store.self.seatId;
    const me = self ? " me" : "";
    const host = p.seatId === store.hostSeatId ? `<span class="badge host">Gastgeber</span>` : "";
    const spectator = p.role === "spectator" ? `<span class="badge spec">Zuschauer</span>` : "";
    const linked = p.connected
      ? `<span class="dot on"></span>`
      : `<span class="dot off"></span><span class="away">unterbrochen</span>`;
    return `<li class="chip player${me}">${prefixHtml}<span class="nick">${escapeHtml(p.nickname)}</span>${host}${spectator}${
      scoreText ? `<small class="score">${scoreText}</small>` : ""
    }${linked}</li>`;
  };
  if (mode === "ranked") {
    return store
      .rankedPlayers()
      .map((r) => render(r.player, `<span class="place">${r.place}</span>`, `${r.roundScore} P`))
      .join("");
  }
  return store.players
    .map((p, i) =>
      render(p, `<span class="no">${i + 1}.</span> `, mode === "totals" ? `${p.cumulativeScore} P` : "")
    )
    .join("");
}

/** The concrete reveal (#17): groups ascend by length; each word shows its
 *  points and the nicknames of the seats that found it. */
function revealHtml(store: GameStore): string {
  const reveal = store.finishedRound?.reveal;
  if (!reveal || reveal.groups.length === 0) return "<dt>Ergebnisse</dt><dd>—</dd>";
  return reveal.groups
    .map(
      (g) =>
        `<dt>${g.length} Buchstaben</dt><dd>${g.words
          .map((w) => {
            const by = w.foundBy
              .map((id) => store.players.find((p) => p.seatId === id)?.nickname)
              .filter(Boolean)
              .join(", ");
            const cls = w.foundBy.length === 0 ? ` class="missed"` : "";
            return `<span${cls}>${escapeHtml(w.word)} <small>+${w.points}${by ? ` · ${escapeHtml(by)}` : ""}</small></span>`;
          })
          .join(" · ")}</dd>`
    )
    .join("");
}

/** The private found-word chips: what I found this round, with each word's
 *  points value. Cleared at every round start. */
function foundHtml(store: GameStore): string {
  const chips = [...store.roundWords]
    .map(
      ([word, points]) =>
        `<li class="chip find"><span>${escapeHtml(word)}</span> <small>+${points}</small></li>`
    )
    .join("");
  return chips || `<li class="chip none">—</li>`;
}

function setHomeError(app: App, msg: string): void {
  const box = app.root.querySelector("#home-errors");
  if (box) box.textContent = msg;
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
