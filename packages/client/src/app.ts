import { loadSession, clearSession, type ConnStatus } from "./api.js";
import { applyDelta, remainingOf, fmt } from "./deltas.js";
import { GameStore } from "./store.js";
import type { ClientMessage, ServerMessage } from "@wordament/shared";
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

interface App {
  root: HTMLElement;
  connect: ConnFactory;
  store: GameStore;
  conn: RoomConn | null;
  renderTimer: ReturnType<typeof setInterval> | null;
  inRoom: boolean;
  connStatus: ConnStatus;
  unsub: Unsubscribe | null;
  onPopState: () => void;
}

/**
 * Mounts the app into `rootEl`, which renders to the home screen
 * immediately. Returns the unmount function: it stops the countdown
 * render timer, stops any live connection, unsubscribes, removes the
 * popstate listener and clears the root. Call exactly once per mount.
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
    onPopState: () => {
      if (!app.inRoom) home(app);
    },
  };
  window.addEventListener("popstate", app.onPopState);
  home(app);
  return () => {
    teardown(app);
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
      <p>Gemeinsam deutsche Wörter finden — real-time, privat, ohne Konto.</p>
      <section class="panel">
        <h2>Raum erstellen</h2>
        <label>Spitzname <input id="mk-nick" maxlength="24" placeholder="z. B. Lena" /></label>
        <button id="mk-btn">Neuen Raum erstellen</button>
      </section>
      <section class="panel">
        <h2>Raum beitreten</h2>
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
  app.renderTimer = setInterval(() => interpolateCountdown(app), 250);
}

function onMessage(app: App, msg: ServerMessage): void {
  const before = app.store.outcome;
  applyDelta(app.store, msg);
  if (msg.type === "error" && app.store.phase === "lobby" && msg.code === "room-not-found") {
    renderEnded(app, "Raum nicht gefunden oder abgelaufen.");
    return;
  }
  if (app.store.outcome !== before) render(app);
}

function onStatus(app: App, status: ConnStatus): void {
  app.connStatus = status;
  if (status === "closed" && app.store.outcome === "none") {
    renderEnded(app, "Verbindung beendet.");
    return;
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
  if (app.store.outcome === "kicked")
    return renderEnded(app, `Du wurdest aus dem Raum ${escapeHtml(app.store.code)} entfernt.`);
  if (app.store.outcome === "room-ended")
    return renderEnded(app, `Raum ${escapeHtml(app.store.code)} wurde beendet.`);
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

function interpolateCountdown(app: App): void {
  if (app.store.phase !== "playing" && app.store.phase !== "intermission") return;
  const el = app.root.querySelector<HTMLElement>("#countdown");
  if (el) el.textContent = fmt(remainingOf(app.store));
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
        <ul id="players">${playersHtml(app.store)}</ul>
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
  app.root.innerHTML = `
    <div class="sheet">
      <h1>Runde ${app.store.roundNumber} <span id="countdown">${fmt(remainingOf(app.store))}</span></h1>
      ${statusHtml(app)}
      ${app.store.lastError ? `<p id="error">${escapeHtml(app.store.errorText)}</p>` : ""}
      <section class="panel">
        <h2>Spielbrett</h2>
        <div id="board" class="board">${board
          .map((t, i) => `<div class="tile">${escapeHtml(t)}<span class="idx">${i}</span></div>`)
          .join("")}</div>
      </section>
      <section class="panel">
        <h2>Dein Wort</h2>
        ${
          spectating
            ? `<p class="dim">Du schaust zu — ab der nächsten Runde spielst du mit.</p>`
            : `<form id="word-form">
                 <input id="word-input" maxlength="16" placeholder="Wort eintippen, Enter" autocomplete="off" autocapitalize="off" />
                 <button>OK</button>
               </form>
               <p class="dim">Gefunden: ${[...app.store.roundWords].map(escapeHtml).join(" · ") || "—"}</p>`
        }
      </section>
      <section class="panel">
        <h2>Punkte</h2>
        <ul id="players">${playersHtml(app.store)}</ul>
      </section>
      <button id="leave-btn">Raum verlassen</button>
    </div>`;
  const form = app.root.querySelector<HTMLFormElement>("#word-form");
  if (form) {
    const inputEl = app.root.querySelector<HTMLInputElement>("#word-input")!;
    inputEl.focus();
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const word = inputEl.value.trim();
      if (!word) return;
      app.conn!.request({ type: "submit-word", word });
      inputEl.value = "";
    };
  }
  app.root.querySelector<HTMLButtonElement>("#leave-btn")!.onclick = () => leaveRoom(app);
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
          .map((t) => `<div class="tile">${escapeHtml(t)}</div>`)
          .join("")}</div>
        <dl id="reveal">${revealHtml(app.store)}</dl>
      </section>
      <section class="panel">
        <h2>Punkte</h2>
        <ul id="players">${playersHtml(app.store)}</ul>
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

function renderEnded(app: App, title: string): void {
  if (app.conn) {
    app.conn.stop();
    app.conn = null;
  }
  app.inRoom = false;
  teardown(app);
  document.title = "WortMeister";
  app.root.innerHTML = `
    <div class="sheet">
      <h1>${escapeHtml(title)}</h1>
      <button id="home-btn">Zur Startseite</button>
    </div>`;
  app.root.querySelector<HTMLButtonElement>("#home-btn")!.onclick = () => exitToHome(app);
}

/* ------------------------------------------------------------------ */
/* Fragments / helpers                                                 */
/* ------------------------------------------------------------------ */

function statusHtml(app: App): string {
  if (app.connStatus === "open") return "";
  return `<p class="dim">${app.connStatus === "retrying" ? "Verbindung wird wiederhergestellt …" : "Verbinde …"}</p>`;
}

function playersHtml(store: GameStore): string {
  return store.players
    .map((p) => {
      const self = p.seatId === store.self.seatId;
      const host = p.seatId === store.hostSeatId ? " 🏠" : "";
      const role = p.role === "spectator" ? " (Zuschauer)" : "";
      const away = p.connected ? "" : " (unterbrochen)";
      return `<li ${self ? 'class="me"' : ""}>${escapeHtml(p.nickname)}${host}${role} — ${p.cumulativeScore}${away}</li>`;
    })
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
