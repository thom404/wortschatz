import { loadSession, clearSession, type CloseOutcome, type ConnStatus, type GreetFn } from "./api.js";
import { GameStore, type DeltaKind } from "./store.js";
import {
  applyGestureSample,
  type GesturePhase,
  type GestureSample,
  type GestureState,
  type GestureStream,
  type PointerKind,
} from "./gesture.js";
import { qrSvg } from "./qr.js";
import { applySkin, loadSkin, skinSwitcherHtml, wireSkinSwitcher } from "./skins.js";
import type {
  ClientMessage,
  PlayerInfo,
  RoomEndReason,
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
  /** The live board drag, or `null` between drags. The pure gesture module
   *  owns its rules; the app only holds the state and paints it. */
  gesture: GestureState | null;
  /** The live regions the current screen declares beside its template
   *  (ADR-0009). The play-time updater walks exactly these. */
  liveRegions: readonly LiveRegion[];
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
    gesture: null,
    liveRegions: [],
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
  app.liveRegions = [];
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
    onClose: (outcome) => onClose(app, outcome),
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
  if (store.phase !== "playing" && store.phase !== "intermission") return 0;
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

/** The ring timer's live state: progress fraction (0..1) across the wall
 *  length of the current phase, and the shared low-time look toggle. */
function timerState(app: App): { fraction: number; low: boolean } {
  const remaining = remainingOf(app.store);
  return {
    fraction: Math.min(1, Math.max(0, remaining / totalPhaseMs())),
    low: remaining <= LOW_TIME_MS,
  };
}

/** The wall length of the round clock — the ring's 1.0 point. The pause has
 *  no clock, so `playing` is the only phase that ever renders a timer. */
function totalPhaseMs(): number {
  return PROTOCOL.ROUND_MS;
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
        <ul id="players" class="chips">${scoreboardHtml(app.store)}</ul>
        <p class="dim">${app.store.players.filter((p) => p.connected).length} von 8 verbunden</p>
        ${
          app.store.isHost
            ? `<button id="start-btn">Runde starten</button><span id="start-hint" class="dim"></span>`
            : `<p class="dim">Warte auf den Gastgeber …</p>`
        }
      </section>
      <button id="leave-btn">Zurück zur Startseite</button>
    </div>`;
  app.liveRegions = LOBBY_LIVE_REGIONS;
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

/** The game screen's live regions: the ring timer, the ranked scoreboard and
 *  the private found-word chips (absent for a spectator, and skipped then). */
const GAME_LIVE_REGIONS: readonly LiveRegion[] = [TIMER_REGION, SCOREBOARD_REGION, FOUND_REGION];

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
          <ul id="players" class="chips">${scoreboardHtml(app.store)}</ul>
        </section>
      </div>
      <button id="leave-btn">Raum verlassen</button>
    </div>`;
  app.liveRegions = GAME_LIVE_REGIONS;
  app.root.querySelector<HTMLButtonElement>("#leave-btn")!.onclick = () => leaveRoom(app);
  // Re-render can happen mid-drag (server deltas don't pause the game);
  // rehydrate the trace paint onto the fresh DOM.
  paintTrace(app);
}

/** The intermission's live regions: the countdown and the session standings.
 *  The private found-word chips are not part of this screen. */
const INTERMISSION_LIVE_REGIONS: readonly LiveRegion[] = [TIMER_REGION, SCOREBOARD_REGION];

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
          <ul id="players" class="chips">${scoreboardHtml(app.store)}</ul>
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
  app.liveRegions = INTERMISSION_LIVE_REGIONS;
  const skip = app.root.querySelector<HTMLButtonElement>("#skip-btn");
  if (skip) skip.onclick = () => app.conn!.request({ type: "start-round" });
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
  app.liveRegions = [];
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
    const outcome = applyGestureSample(app.gesture, sample);
    app.gesture = outcome.state;
    if (outcome.submit) submitTrace(app, outcome.submit);
    else if (outcome.traceChanged) paintTrace(app);
    return outcome.claimed;
  };

  /** A press only opens a gesture on the player's own, live board; a press
   *  during a live gesture only joins its stream. */
  const mayBegin = () => app.store.phase === "playing" && app.store.self.role !== "spectator";

  const onPointerDown = (ev: PointerEvent) => {
    if (!app.gesture && !mayBegin()) return;
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
    if (!app.gesture && !mayBegin()) return;
    if (feed(sampleFor("down", "touch", t.identifier, t.clientX, t.clientY, t.target))) ev.preventDefault();
  };
  const onTouchMove = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    if (!t) return;
    if (feed(sampleFor("move", "touch", t.identifier, t.clientX, t.clientY, t.target))) ev.preventDefault();
  };
  const onTouchEnd = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    const id = t ? t.identifier : app.gesture?.touchId;
    if (id === null || id === undefined) return;
    feed(sampleFor("up", "touch", id, t?.clientX ?? 0, t?.clientY ?? 0, t?.target ?? null));
  };
  const onTouchCancel = (ev: TouchEvent) => {
    const t = ev.changedTouches[0];
    const id = t ? t.identifier : app.gesture?.touchId;
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
 * count as a clear hit. It is the gap between adjacent board tiles
 * (`--board-gap` in `style.css`): a sample in that gap, or clipping a tile's
 * edge or corner, rounds unpredictably to whichever neighbour the browser's
 * sub-pixel arithmetic picks, so it must not move the trace. Kept well below
 * half a cell, so a genuinely crossed tile still offers clear ground.
 */
const CLEAR_HIT_MARGIN = 6;

/**
 * Whether a sample resolved to `tile` is clearly inside it: farther than the
 * board-gap margin from every edge. `hitTileIndex` resolves a sample to
 * exactly one tile — the browser's sub-pixel rounding decides which — and
 * this filters out every resolution the finger is not well inside. Ignoring
 * those samples lets a stair-step bridge to the next clear sample cover the
 * ground, so no crossed tile is lost while a corner clip neither adds nor
 * unwinds a tile. The opening press stays lenient and uses `hitTileIndex`
 * directly.
 */
function clearHit(app: App, tile: number, x: number, y: number): boolean {
  const el = app.root.querySelector("#board")?.children[tile];
  if (!el) return false;
  const box = el.getBoundingClientRect();
  return !(
    x - box.left < CLEAR_HIT_MARGIN ||
    box.right - x < CLEAR_HIT_MARGIN ||
    y - box.top < CLEAR_HIT_MARGIN ||
    box.bottom - y < CLEAR_HIT_MARGIN
  );
}

/** Ends the trace: painting restores the idle hint and, on a real release
 *  during play, the traced string crosses the boundary as `submit-word`. The
 *  gesture state is already cleared, so the paint goes idle. */
function submitTrace(app: App, trace: number[]): void {
  paintTrace(app);
  const word = traceWord(app, trace);
  if (word && app.store.phase === "playing") {
    app.conn?.request({ type: "submit-word", word });
  }
}

/** The string a release would submit: each traced tile's letters, in
 *  order. Either/or tiles contribute their first variant (swipes don't
 *  choose variants — later tickets own special-tile input). */
function traceWord(app: App, trace: readonly number[]): string {
  const board = app.store.round?.board ?? [];
  return trace.map((i) => tileStrings(board[i] ?? "")[0] ?? "").join("");
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
  const trace = app.gesture?.trace ?? [];
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
    el.textContent = traceWord(app, trace);
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
