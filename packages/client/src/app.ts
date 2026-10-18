import { loadSession, clearSession, type ConnStatus } from "./api.js";
import { applyDelta, remainingOf, fmt, LOW_TIME_MS } from "./deltas.js";
import { GameStore, type DeltaKind } from "./store.js";
import { qrSvg } from "./qr.js";
import { applySkin, loadSkin, skinSwitcherHtml, wireSkinSwitcher } from "./skins.js";
import type {
  ClientMessage,
  PlayerInfo,
  RoomsEndedMsg,
  ServerErrorMsg,
  ServerMessage,
} from "@wortschatz/shared";
import { PROTOCOL, tileSpellingLength, tileStrings } from "@wortschatz/shared";
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

/**
 * The live drag state: one gesture plus whichever event streams report it.
 * A gesture begun by either stream accepts movement from both — Android
 * Firefox begins with `pointerdown` but keeps sending `touchmove` — and
 * whichever stream releases first ends it, so the browser reporting the
 * same finger twice still submits exactly once. `null` between drags.
 */
interface DragGesture {
  /** The pointer stream's id, once a pointer event has joined the gesture. */
  pointerId: number | null;
  /** A `pointercancel` has already dropped the pointer stream. */
  pointerCancelled: boolean;
  /** The touch stream's identifier, once a touch event has joined. */
  touchId: number | null;
}
type DragHandle = DragGesture | null;

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

/** The user-facing app name: the browser title and the home heading. */
const APP_NAME = "Wortschatz";

/** The one sentence the drag surface shows between words. */
const TRACE_HINT = "Wische über die Felder, um ein Wort zu bilden.";

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
  // The skin choice is page-level (ADR-0002): the restored selection
  // rides on the root attribute before the first screen renders, so a
  // returning visitor never glimpses the wrong design.
  applySkin(loadSkin());
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
  document.title = APP_NAME;
  const deepCode = deepLinkCode();
  const stored = deepCode ? loadSession(deepCode) : null;
  app.root.innerHTML = `
    <div class="sheet">
      <h1>${APP_NAME}</h1>
      <p class="dim">Ein Mehrspieler-Wörterspiel.</p>
      <section class="panel">
        <h2>Raum erstellen</h2>
        <label>Name <input id="mk-nick" maxlength="24" placeholder="z. B. Anja" /></label>
        <button id="mk-btn">Raum erstellen</button>
      </section>
      <section class="panel">
        <h2>Raum beitreten</h2>
        ${deepCode ? `<p class="note">Du wurdest in Raum ${escapeHtml(deepCode)} eingeladen.</p>` : ""}
        <label>Raumcode <input id="jn-code" maxlength="8" autocapitalize="characters" placeholder="ABC12" value="${deepCode ?? ""}" /></label>
        <label>Name <input id="jn-nick" maxlength="24" placeholder="z. B. Jörg" value="${stored?.nickname ?? ""}" /></label>
        <button id="jn-btn">Beitreten</button>
      </section>
      <p id="home-errors"></p>
      ${skinSwitcherHtml(loadSkin())}
    </div>`;
  app.root.querySelector<HTMLButtonElement>("#mk-btn")!.onclick = () => {
    const nickname = input(app, "mk-nick");
    if (!nickname) {
      setHomeError(app, "Bitte gib einen Namen ein.");
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
      setHomeError(app, "Bitte gib einen Namen ein.");
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
  wireSkinSwitcher(app.root);
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
  app.unsub = app.store.subscribe((kind) => render(app, kind));
  // A retry follows a prior home error (a validation request or a rejected
  // greeting); the fresh attempt owns the form from here.
  setHomeError(app, "");
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
  // room, so the typed German verdict belongs on the home join form.
  // `room-not-found` keeps its dedicated outcome screen (#21) instead.
  if (isGreetingRejection(app, msg) && msg.code !== "room-not-found") {
    return rejectGreeting(app, msg);
  }
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

/** A greeting rejection: an `error` frame that arrives while the join is
 *  still unconfirmed — no snapshot has named the room yet. This is the
 *  status a rejected greeting must be told apart by, distinct from an
 *  in-room error (a room is known) and an unexpected close (a status). */
function isGreetingRejection(app: App, msg: ServerMessage): msg is ServerErrorMsg {
  return app.inRoom && !app.store.code && msg.type === "error";
}

/** Rejected greeting (join/create): stop the connection so a retry starts
 *  fresh, stay on the home form still on screen — its typed code and
 *  nickname survive — and surface the shared German copy in `#home-errors`. */
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
  teardown(app);
  app.store.reset();
  setHomeError(app, errorText);
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

function render(app: App, kind: DeltaKind = "structural"): void {
  if (!app.inRoom) return;
  // A play-time delta changes only live, already-rendered game state: it
  // refreshes the running ring timer, the scoreboard and the found-word chips
  // in place, so the `#timer` element and its digits keep their identity and
  // never flash the ring's full-circle default. Every structural change
  // rebuilds the whole screen below.
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

/** The in-place refresh of every live, play-time region (ADR-0009): the ring
 *  timer, the scoreboard/standings and the private found-word chips. Each
 *  helper targets its own rendered element and no-ops when the current screen
 *  has none, so the `#timer` identity is never touched. */
function updateLive(app: App): void {
  updateTimer(app);
  updateScoreboard(app);
  updateFound(app);
}

/** The scoreboard's mode in the current phase: the ranked round scoreboard
 *  while playing, the cumulative session standings during the intermission,
 *  the join-ordered roster otherwise. */
function scoreboardMode(phase: GameStore["phase"]): "seats" | "ranked" | "session" {
  if (phase === "playing") return "ranked";
  if (phase === "intermission") return "session";
  return "seats";
}

/** Rewrites the live player chips in place — chip children change, the
 *  `#players` list element itself survives. */
function updateScoreboard(app: App): void {
  const el = app.root.querySelector<HTMLElement>("#players");
  if (!el) return;
  el.innerHTML = playerChipsHtml(app.store, scoreboardMode(app.store.phase));
}

/** Rewrites the private found-word chips in place; absent for spectators. */
function updateFound(app: App): void {
  const el = app.root.querySelector<HTMLElement>("#found");
  if (!el) return;
  el.innerHTML = foundHtml(app.store);
}

function renderLobby(app: App): void {
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
      ${statusHtml(app)}
      <section class="panel">
        <h2>Spieler</h2>
        <ul id="players" class="chips">${playerChipsHtml(app.store)}</ul>
        <p class="dim">${app.store.players.filter((p) => p.connected).length} von 8 verbunden</p>
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
  document.title = `${APP_NAME} — Runde ${app.store.roundNumber}`;
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
          <h2>Spielfeld</h2>
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
                 <p class="note">Du schaust zu. Ab der nächsten Runde bist du dabei.</p>
               </section>`
            : `<section class="panel area-found">
                 <h2>Deine Wörter</h2>
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
  document.title = `${APP_NAME} — Pause`;
  const finishedRoundNumber = app.store.finishedRound?.roundNumber ?? app.store.roundNumber;
  // The finished board stays on screen: for live players it survives from
  // the round, and the intermission snapshot re-anchors it for joiners.
  const board = app.store.round?.board ?? [];
  const tileSpan = Math.max(1, ...board.map((t) => tileSpellingLength(t)));
  app.root.innerHTML = `
    <div class="sheet">
      ${statusHtml(app)}
      <div id="dashboard" class="dashboard intermission">
        <h1 class="area-title">Pause</h1>
        ${timerHtml(app)}
        <section class="panel area-board">
          <h2>Runde ${finishedRoundNumber}</h2>
          <div id="board" class="board" style="--tile-span:${tileSpan}">${board
            .map((t) => `<div class="tile">${escapeHtml(displayTile(t))}</div>`)
            .join("")}</div>
        </section>
        <section class="panel area-reveal">
          <h2>Gefundene Wörter</h2>
          <dl id="reveal">${revealHtml(app.store)}</dl>
        </section>
        <section class="panel area-score">
          <h2>Punkte</h2>
          <ul id="players" class="chips">${playerChipsHtml(app.store, "session")}</ul>
          <p class="dim">Es zählt das Gesamtergebnis der Sitzung.</p>
        </section>
      </div>
      ${
        app.store.isHost
          ? `<button id="skip-btn">Nächste Runde starten</button>`
          : `<p class="dim next-round-hint">Die nächste Runde startet gleich …</p>`
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
  document.title = APP_NAME;
  app.root.innerHTML = `
    <div class="sheet">
      <h1>${outcome.titleHtml}</h1>
      <section class="panel">
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
 * The drag word-input surface replacing the typed input (#19): pressing a
 * tile begins the trace; moving through 8-way adjacent tiles extends it;
 * moving onto the immediately previous tile deselects it (backtracking);
 * releasing submits the traced string. The trace paints directly onto the
 * rendered DOM (no full re-render mid-drag) and clears on release — the
 * verdict arrives as a server message either way.
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
 * `preventDefault` while a touch drag moves.
 */
function wireDrag(app: App): () => void {
  const root = app.root;

  const onPointerDown = (ev: PointerEvent) => {
    const gesture = app.dragging;
    if (!gesture) {
      const drag = beginTrace(app, ev.clientX, ev.clientY, ev.target);
      if (!drag) return;
      drag.pointerId = ev.pointerId;
      return;
    }
    // The same gesture reported through its pointer stream after touch
    // already began it: join the pointer for movement and release dedupe
    // rather than starting a second gesture.
    if (!gesture.pointerCancelled && gesture.pointerId === null) {
      gesture.pointerId = ev.pointerId;
    }
  };
  const onPointerMove = (ev: PointerEvent) => {
    const gesture = app.dragging;
    if (!gesture || gesture.pointerCancelled || gesture.pointerId !== ev.pointerId) return;
    continueTrace(app, ev.clientX, ev.clientY, ev.target);
  };
  const onPointerUp = (ev: PointerEvent) => {
    const gesture = app.dragging;
    if (!gesture || gesture.pointerCancelled || gesture.pointerId !== ev.pointerId) return;
    releaseTrace(app, true);
  };
  const onPointerCancel = (ev: PointerEvent) => {
    const gesture = app.dragging;
    if (!gesture || gesture.pointerId !== ev.pointerId) return;
    // A touch pointer's cancel is not the gesture's end while the touch
    // stream keeps delivering the same finger: defer to `touchend` /
    // `touchcancel`. A mouse or pen cancel has no touch fallback and ends
    // the gesture without submitting.
    if (ev.pointerType === "touch" && gesture.touchId !== null) {
      gesture.pointerCancelled = true;
      return;
    }
    releaseTrace(app, false);
  };

  const onTouchStart = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    if (!t) return;
    const gesture = app.dragging;
    if (!gesture) {
      const drag = beginTrace(app, t.clientX, t.clientY, t.target);
      if (!drag) return;
      drag.touchId = t.identifier;
      ev.preventDefault();
      return;
    }
    // The pointer-first stream: join the touch stream to the live gesture
    // so its moves continue the trace (Android Firefox).
    if (gesture.touchId === null) {
      gesture.touchId = t.identifier;
      ev.preventDefault();
    }
  };
  const onTouchMove = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    if (!t) return;
    const gesture = app.dragging;
    if (!gesture || gesture.touchId !== t.identifier) return;
    if (continueTrace(app, t.clientX, t.clientY, t.target)) ev.preventDefault();
  };
  const onTouchEnd = (ev: TouchEvent) => {
    const gesture = app.dragging;
    if (!gesture || gesture.touchId === null) return;
    const t = ev.changedTouches[0];
    if (t && t.identifier !== gesture.touchId) return;
    releaseTrace(app, true);
  };
  const onTouchCancel = (ev: TouchEvent) => {
    const gesture = app.dragging;
    if (!gesture || gesture.touchId === null) return;
    const t = ev.changedTouches[0];
    if (t && t.identifier !== gesture.touchId) return;
    releaseTrace(app, false);
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

/** Starts a gesture if the press lands on a rendered game tile during play.
 *  Returns the new gesture (and thus whether the event stream was claimed —
 *  touch handlers preventDefault only then), or `null` when a gesture is
 *  already live or the board is not the player's to drag. */
function beginTrace(app: App, x: number, y: number, target: EventTarget | null): DragGesture | null {
  if (app.dragging) return null;
  if (app.store.phase !== "playing" || app.store.self.role === "spectator") return null;
  const idx = hitTileIndex(app, x, y, target);
  if (idx < 0) return null;
  const gesture: DragGesture = {
    pointerId: null,
    pointerCancelled: false,
    touchId: null,
  };
  app.trace = [idx];
  app.dragging = gesture;
  paintTrace(app);
  return gesture;
}

/**
 * Extends/unwinds the live trace for the tile under the pointer. Callers
 * check the movement sample belongs to the live gesture before calling.
 *
 * A movement sample normally lands on one 8-way neighbour. A fast swipe can
 * deliver two consecutive samples of one gesture more than one tile apart;
 * then the tiles between them are appended as an 8-way **stair-step walk**
 * from the last selected tile toward the new sample, so no crossed tile is
 * lost. The path stays valid: a step onto an already-selected tile is
 * rejected, and a sample landing on the immediately previous tile unwinds it.
 */
function continueTrace(app: App, x: number, y: number, target: EventTarget | null): boolean {
  const idx = hitTileIndex(app, x, y, target);
  if (idx < 0) return false;
  const trace = app.trace;
  const last = trace[trace.length - 1];
  if (last === undefined) return false;
  const prev = trace[trace.length - 2];
  if (idx === last) return false; // still on the current tile
  if (idx === prev) {
    trace.pop(); // backtracking unwinds the previous tile
  } else {
    const steps = bridgeSteps(last, idx);
    if (steps.length === 0) return false;
    if (steps.some((step) => trace.includes(step))) return false; // no tile twice
    trace.push(...steps);
  }
  paintTrace(app);
  return true;
}

/**
 * The run of 8-way adjacent tiles from `from` to `to` that closes a gap
 * between sparse samples: it excludes `from`, ends at `to`, and takes one
 * row and/or column toward the target each step (diagonal-first stair-step).
 * Empty when `from === to`.
 */
function bridgeSteps(from: number, to: number): number[] {
  const steps: number[] = [];
  let row = Math.floor(from / 4);
  let col = from % 4;
  const toRow = Math.floor(to / 4);
  const toCol = to % 4;
  while (row !== toRow || col !== toCol) {
    row += Math.sign(toRow - row);
    col += Math.sign(toCol - col);
    steps.push(row * 4 + col);
  }
  return steps;
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
 * - `session`: the intermission standings (#22) — round score and
 *   cumulative session score side by side on one chip, ordered by
 *   cumulative score (the session's winner key), ties sharing a place.
 */
function playerChipsHtml(store: GameStore, mode: "seats" | "ranked" | "session" = "seats"): string {
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
  if (mode === "session") {
    return store
      .sessionRanked()
      .map((r) =>
        render(
          r.player,
          `<span class="place">${r.place}</span>`,
          `Runde ${r.roundScore} P · Gesamt ${r.cumulativeScore} P`
        )
      )
      .join("");
  }
  return store.players.map((p, i) => render(p, `<span class="no">${i + 1}.</span> `, "")).join("");
}

/**
 * The concrete reveal (#17, #22): groups ascend by length; each word shows
 * its points and one found-by chip per finder. Missed words stay visible —
 * dimmed, without invented credit. No tile paths, no first-finder marks.
 */
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
              .filter((n): n is string => Boolean(n))
              .map((n) => `<span class="fby">${escapeHtml(n)}</span>`)
              .join("");
            const missed = w.foundBy.length === 0 ? " missed" : "";
            return `<span class="rw${missed}"><span class="rw-word">${escapeHtml(w.word)}</span><small class="rw-pts">+${w.points}</small>${by}</span>`;
          })
          .join(" ")}</dd>`
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
