import type { ServerErrorMsg, ServerMessage } from "@wortschatz/shared";
import {
  clearSession,
  type CloseOutcome,
  type ConnFactory,
  type ConnStatus,
  type GreetFn,
  type RoomConn,
} from "./connection.js";
import { createGameDrag, type GameDrag } from "./game-drag.js";
import { InstallState, type InstallStateOptions } from "./install-state.js";
import { menuHtml, wireMenu, type MenuSurface } from "./menu.js";
import type { ScreenContext, ScreenPaint } from "./screens/contract.js";
import * as createScreen from "./screens/create.js";
import * as gameScreen from "./screens/game.js";
import * as homeScreen from "./screens/home.js";
import * as intermissionScreen from "./screens/intermission.js";
import * as joinScreen from "./screens/join.js";
import * as lobbyScreen from "./screens/lobby.js";
import * as outcomeScreen from "./screens/outcome.js";
import { applySkin, loadSkin } from "./skins.js";
import { GameStore, type DeltaKind } from "./store.js";
import { ViewState } from "./view-state.js";
import "./style.css";

/**
 * The app shell (ADR-0030). It owns the mount root, the connection and its
 * message handling, the render shortcuts, entry routing and browser history,
 * the notification state, the 250 ms timer interval and the drag lifecycle.
 * Seven screen modules under `screens/` own their templates, ids, live
 * regions, wiring and Menu identity. A screen receives only the narrow
 * `ScreenContext`; the connection, timer handle, store subscription, history
 * state and Menu surface stay here.
 *
 * `mount` is the shell's one export: production boot (main.ts) and the mount
 * test harness share it, and every screen is proved through that same seam.
 */

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
  /** The app-owned update notice, a sibling of the notification layer
   *  outside every screen (ADR-0029, #258). */
  noticeUpdate: HTMLElement;
  /** The app-owned Menü surface (ADR-0023), created once outside the screen
   *  markup so a rebuild can neither remove it nor lose its wiring. */
  menu: MenuSurface;
  /** The one owner of install state (ADR-0029): Home reads it, and only this
   *  module touches the browser's install APIs. */
  install: InstallState;
  unsub: Unsubscribe | null;
  /** Client-only view state (ADR-0024): the reveal order, the Board
   *  rotation and the live Gesture, together with their reset rules. */
  view: ViewState;
  /** The room code this mount's connection was built for — creating a
   *  room greets with the nickname, and the server names the room later
   *  (first snapshot). The outcome screens that fire without a snapshot
   *  (room-not-found) still name the code the user typed. */
  roomCode: string;
  /** Whether the current Create/Join entry was pushed from Home, which is
   *  what lets the in-screen Zurück walk history back to Home. */
  screenFromHome: boolean;
  onPopState: (ev: PopStateEvent) => void;
}

/** The one offline line (ADR-0029): the Notification layer's status slot. */
const OFFLINE_NOTICE = "Du bist offline.";

/** The update notice's German copy (ADR-0029, #258). */
const UPDATE_NOTICE = "Neue Version verfügbar.";
const UPDATE_ACTION = "Neu laden";

/** The deep-linked room code, if the current path is `/r/<code>`. */
function deepLinkCode(): string | null {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]+)\/?$/);
  return m && m[1] ? m[1].toUpperCase() : null;
}

/**
 * Mounts the app into `rootEl`, which renders to the home screen
 * immediately. Returns the unmount function: it stops the countdown
 * render timer, stops any live connection, unsubscribes, removes the
 * popstate listener, unbinds the drag surface and clears the root. Call
 * exactly once per mount.
 */
export function mount(
  rootEl: HTMLElement,
  connect: ConnFactory,
  installOptions: InstallStateOptions = {}
): () => void {
  // The app root is a shell (ADR-0018): one screen container that every
  // render replaces, beside the app-owned Menü (ADR-0023) and the one
  // notification layer created here once. The update notice is a sibling of
  // that layer (ADR-0029, #258), so a screen rebuild can never remove it.
  // Unmount removes all four.
  rootEl.innerHTML = `
    <div id="screen"></div>
    ${menuHtml()}
    <div id="notice-stack" class="notice-stack">
      <div id="update-notice" class="update-notice" hidden>
        <p>${UPDATE_NOTICE}</p>
        <button id="update-reload-btn" type="button">${UPDATE_ACTION}</button>
      </div>
      <div id="notifications" class="notifications">
        <p id="notice-status" class="notice status" role="status" aria-live="polite"></p>
        <p id="notice-error" class="notice error" role="alert" aria-live="assertive"></p>
      </div>
    </div>`;
  const app: App = {
    root: rootEl.querySelector<HTMLElement>("#screen")!,
    connect,
    store: new GameStore(),
    conn: null,
    renderTimer: null,
    inRoom: false,
    connStatus: null,
    localError: null,
    noticeStatus: rootEl.querySelector<HTMLElement>("#notice-status")!,
    noticeError: rootEl.querySelector<HTMLElement>("#notice-error")!,
    noticeUpdate: rootEl.querySelector<HTMLElement>("#update-notice")!,
    menu: wireMenu(rootEl),
    install: new InstallState(installOptions),
    unsub: null,
    view: new ViewState(),
    roomCode: "",
    screenFromHome: false,
    onPopState: (ev) => {
      // A live room owns the screen (ADR-0021): history never competes with
      // the connection's snapshots and close outcomes.
      if (!app.inRoom) showEntry(ev.state as EntryState | null);
    },
  };

  /** The installed paint: the one source of the current screen's live regions
   *  and late-link hook. The dead app-record fields are gone. */
  let currentPaint: ScreenPaint | null = null;

  // The drag/trace subsystem is created once per mount (ADR-0030): its
  // listeners are app-lifetime, so a Game rebuild cannot double-submit.
  const drag: GameDrag = createGameDrag({
    root: app.root,
    store: app.store,
    view: app.view,
    submit(word, alternate) {
      clearError(app);
      app.conn?.request({ type: "submit-word", word, ...(alternate ? { alternate } : {}) });
    },
  });

  /** The narrow screen context. `roomCode` is a getter because routing owns
   *  it and a paint may outlive the current value. */
  const ctx: ScreenContext = {
    root: app.root,
    store: app.store,
    view: app.view,
    get roomCode() {
      return app.roomCode;
    },
    drag,
    install: app.install,
    notices: {
      clearError: () => clearError(app),
      setLocalError: (message) => setLocalError(app, message),
    },
    actions: {
      startRoom: (nickname, greet) => startRoom(nickname, greet),
      startRound: () => {
        clearError(app);
        app.conn?.request({ type: "start-round" });
      },
      leaveRoom: () => leaveRoom(),
      exitToHome: () => exitToHome(),
      openCreate: () => openCreate(),
      openJoin: () => openJoin(),
      backToHome: () => backToHome(),
    },
  };

  /** Installing a paint, in order (ADR-0030): dispose the previous paint;
   *  set the Menu key; set the title; replace only `#screen`'s contents;
   *  retain the paint; wire it; refresh the notification layer. The shell
   *  never writes a screen's markup and a screen never writes outside
   *  `#screen`. */
  function install(screen: ScreenPaint): void {
    currentPaint?.dispose?.();
    app.menu.screenChanged(screen.menuKey);
    document.title = screen.title;
    app.root.innerHTML = screen.html;
    currentPaint = screen;
    screen.wire(app.root, ctx);
    renderNotices(app);
  }

  function renderHome(): void {
    app.screenFromHome = false;
    resetEntryNotices(app);
    install(homeScreen.paint(ctx));
  }

  function openCreate(): void {
    pushEntry({ screen: "create", fromHome: true });
    app.roomCode = "";
    resetEntryNotices(app);
    install(createScreen.paint(ctx));
  }

  /** Enter Join as a new history entry. A deep link skips this: it renders
   *  Join in place and never pushes, so Back still leaves the app. */
  function openJoin(): void {
    pushEntry({ screen: "join", fromHome: true });
    app.roomCode = "";
    resetEntryNotices(app);
    install(joinScreen.paint(ctx));
  }

  function pushEntry(state: EntryState): void {
    // The address bar keeps today's rule: entering an entry screen changes no
    // URL; only a snapshot naming a room claims `/r/<code>`.
    window.history.pushState(state, "", location.pathname);
    app.screenFromHome = true;
  }

  /** Renders the screen a history entry names. Called on popstate only. */
  function showEntry(state: EntryState | null): void {
    if (state?.screen === "create") {
      app.screenFromHome = state.fromHome ?? false;
      app.roomCode = "";
      resetEntryNotices(app);
      install(createScreen.paint(ctx));
      return;
    }
    if (state?.screen === "join") {
      app.screenFromHome = state.fromHome ?? false;
      app.roomCode = state.code ?? "";
      resetEntryNotices(app);
      install(joinScreen.paint(ctx));
      return;
    }
    renderHome();
  }

  /** The in-screen Zurück: walk back to Home through history when this screen
   *  was entered from Home, otherwise (a deep link) replace the entry so the
   *  app stays here rather than falling out of the page. */
  function backToHome(): void {
    if (app.screenFromHome) {
      // Paint Home immediately; the popstate that follows confirms the same
      // entry, so the click never waits on browser history timing.
      window.history.back();
      renderHome();
      return;
    }
    window.history.replaceState({ screen: "home" } satisfies EntryState, "", "/");
    renderHome();
  }

  function resetEntryNotices(app: App): void {
    app.localError = null;
    app.store.lastError = null;
    app.connStatus = null;
  }

  /* ---- room shell ------------------------------------------------- */

  function startRoom(nickname: string, greet: GreetFn): void {
    app.inRoom = true;
    // The greeting is the only place a not-yet-confirmed room code exists: a
    // create greets with the nickname, a join with the typed code. The
    // connection core invokes the same builder when its transport opens.
    const greeting = greet();
    app.roomCode = greeting?.type === "join" ? greeting.code : nickname;
    // View state is local to one room visit: a new room starts at the grouped
    // reveal order and 0° rotation (ADR-0024).
    app.view.reset();
    app.conn = app.connect({
      greet,
      listener: (msg) => onMessage(msg),
      onStatus: (status) => onStatus(status),
      onClose: (outcome) => onClose(outcome),
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
    // The interval is shell-owned; only the installed paint decides whether
    // it has a tick (Game does, every other screen does not).
    app.renderTimer = setInterval(() => currentPaint?.tick?.(ctx), 250);
  }

  function onMessage(msg: ServerMessage): void {
    // A greeting the server rejects before any snapshot is neither an
    // in-room error nor an unexpected close: the connection never became a
    // room, so the typed German verdict belongs on the Create/Join screen the
    // attempt was made from. `room-not-found` keeps its dedicated outcome
    // screen (#21) instead.
    if (isGreetingRejection(msg) && msg.code !== "room-not-found") {
      return rejectGreeting(msg);
    }
    // The view state must be current before the store notifies subscribers
    // and renders the screen (ADR-0024).
    app.view.apply(msg);
    app.store.apply(msg);
    // Room end and kick are close outcomes, reported once by the connection
    // after this frame reached the store (see `onClose`). `room-not-found`
    // stays a frame-driven outcome: the server only emits it when the room
    // is gone (bad join, a room the seat outlived) — never as a transient
    // mid-game verdict.
    if (msg.type === "error" && msg.code === "room-not-found") return showOutcome({ kind: "room-not-found" });
  }

  /** A greeting rejection: an `error` frame that arrives while the join is
   *  still unconfirmed — no snapshot has named the room yet. This is the
   *  state a rejected greeting must be told apart by, distinct from an
   *  in-room error (a room is known) and a close outcome. */
  function isGreetingRejection(msg: ServerMessage): msg is ServerErrorMsg {
    return app.inRoom && !app.store.code && msg.type === "error";
  }

  /** Rejected greeting (join/create): stop the connection so a retry starts
   *  fresh, stay on the entry screen still on screen — its typed values
   *  survive — and surface the shared German copy in the floating error
   *  slot. */
  function rejectGreeting(msg: ServerErrorMsg): void {
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

  function onStatus(status: ConnStatus): void {
    app.connStatus = status;
    render(app);
  }

  /** The connection's one close outcome (#123): kicked, room ended (with its
   *  reason) or an orderly close that carried no end frame. Each renders its
   *  dedicated screen; there is no separate status to race with the frame. */
  function onClose(outcome: CloseOutcome): void {
    if (outcome.kind === "kicked") return showOutcome({ kind: "kicked" });
    if (outcome.kind === "room-ended") return showOutcome({ kind: "room-ended", reason: outcome.reason });
    showOutcome({ kind: "connection-lost" });
  }

  /** The out-of-room path: stop the connection, leave the room, clear status
   *  and error, tear down the timers, then install the Outcome paint. The
   *  typed room code stays on the app for the room-not-found screen. */
  function showOutcome(outcome: outcomeScreen.Outcome): void {
    if (app.conn) {
      app.conn.stop();
      app.conn = null;
    }
    app.inRoom = false;
    app.connStatus = null;
    app.localError = null;
    app.store.lastError = null;
    teardown(app);
    install(outcomeScreen.paint(ctx, outcome));
  }

  function leaveRoom(): void {
    if (app.conn) app.conn.request({ type: "leave" });
    exitToHome();
  }

  function exitToHome(): void {
    if (app.store.code) clearSession(app.store.code);
    if (app.conn) {
      app.conn.stop();
      app.conn = null;
    }
    app.inRoom = false;
    teardown(app);
    app.store.reset();
    window.history.pushState({}, "", "/");
    renderHome();
  }

  function teardown(app: App): void {
    if (app.renderTimer) {
      clearInterval(app.renderTimer);
      app.renderTimer = null;
    }
  }

  /* ---- render ----------------------------------------------------- */

  function render(app: App, kind: DeltaKind = "structural"): void {
    // The notification layer sits outside the screen, so it is refreshed on
    // every path — including while a Create/Join screen stays put during a
    // greeting.
    renderNotices(app);
    if (!app.inRoom) return;
    // A play-time delta changes only live, already-rendered game state: it
    // refreshes the running ring timer, the scoreboard and the found-word
    // chips in place, so the `#timer` element and its digits keep their
    // identity and never flash the ring's full-circle default. Every
    // structural change rebuilds the whole screen below.
    if (kind === "reveal-links") {
      currentPaint?.lateLinks?.(app.root, ctx);
      return;
    }
    if (kind === "play-time") {
      updateLive(app);
      return;
    }
    syncRoomUrl(app);
    switch (app.store.phase) {
      case "lobby":
        if (app.store.code) install(lobbyScreen.paint(ctx));
        return;
      case "playing":
        install(gameScreen.paint(ctx));
        return;
      case "intermission":
        install(intermissionScreen.paint(ctx));
        return;
      case "closed":
        return;
      default: {
        // An exhaustive phase dispatch: a missing screen is a compile error
        // rather than a blank page.
        const exhaustive: never = app.store.phase;
        return exhaustive;
      }
    }
  }

  /** The in-place refresh of every live region the installed paint declares
   *  (ADR-0009, ADR-0013), in declaration order. A region whose element is
   *  absent from the screen (a spectator's found-word chips, a screen without
   *  a timer) is skipped, so the `#timer` identity is never touched. */
  function updateLive(app: App): void {
    for (const region of currentPaint?.liveRegions ?? []) {
      if (app.root.querySelector(region.selector)) region.update(ctx);
    }
  }

  /* ---- notices ---------------------------------------------------- */

  function statusNoticeText(app: App): string {
    if (navigator.onLine === false) return OFFLINE_NOTICE;
    if (app.connStatus === "connecting") return "Verbinde …";
    if (app.connStatus === "retrying") return "Verbindung wird wiederhergestellt …";
    return "";
  }

  /** The error slot's one message: the server's catalogue text when present,
   *  otherwise the current local validation string. */
  function errorNoticeText(app: App): string {
    return app.store.lastError ? app.store.errorText : (app.localError ?? "");
  }

  /** The update notice waits for a safe phase (ADR-0029, #258): a waiting
   *  worker is offered only when no Round is running, so a reload can never
   *  destroy words or points. Home and every non-playing screen see it. */
  function renderUpdateNotice(app: App): void {
    app.noticeUpdate.hidden = !(app.install.updateAvailable && app.store.phase !== "playing");
  }

  /** Refreshes the two app-owned slots from existing state. A slot whose text
   *  is unchanged is left untouched: no re-announcement, no entry animation. */
  function renderNotices(app: App): void {
    setNotice(app.noticeStatus, statusNoticeText(app));
    setNotice(app.noticeError, errorNoticeText(app));
    renderUpdateNotice(app);
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

  /* ---- boot and teardown ------------------------------------------ */

  window.addEventListener("popstate", app.onPopState);
  const refreshNotices = () => renderNotices(app);
  window.addEventListener("online", refreshNotices);
  window.addEventListener("offline", refreshNotices);
  // The browser may offer its install prompt after Home first painted. Only
  // Home owns the card, so only a Home render reads the fresh state.
  const unsubscribeInstall = app.install.subscribe(() => {
    if (!app.inRoom && currentPaint?.menuKey === "home") renderHome();
  });
  // The update notice is app-owned: a change in waiting-worker state only
  // refreshes that surface, leaving the current screen untouched.
  const unsubscribeUpdate = app.install.subscribeUpdate(() => renderUpdateNotice(app));
  app.noticeUpdate.querySelector<HTMLButtonElement>("#update-reload-btn")!.onclick = () =>
    app.install.applyUpdate();
  // The skin choice is page-level (ADR-0002): the restored selection
  // rides on the root attribute before the first screen renders, so a
  // returning visitor never glimpses the wrong design.
  applySkin(loadSkin());
  // The initial entry names its screen too (ADR-0021). A deep link lands on
  // Join without pushing an entry, so browser Back still leaves the app.
  const deepCode = deepLinkCode();
  if (deepCode) {
    app.roomCode = deepCode;
    window.history.replaceState(
      { screen: "join", code: deepCode, fromHome: false } satisfies EntryState,
      "",
      location.pathname
    );
    resetEntryNotices(app);
    install(joinScreen.paint(ctx));
  } else {
    window.history.replaceState({ screen: "home" } satisfies EntryState, "", location.pathname);
    renderHome();
  }
  return () => {
    teardown(app);
    currentPaint?.dispose?.();
    drag.stop();
    app.menu.dispose();
    app.install.dispose();
    unsubscribeInstall();
    unsubscribeUpdate();
    if (app.conn) {
      app.conn.stop();
      app.conn = null;
    }
    if (app.unsub) app.unsub();
    window.removeEventListener("popstate", app.onPopState);
    window.removeEventListener("online", refreshNotices);
    window.removeEventListener("offline", refreshNotices);
    rootEl.textContent = "";
  };
}
