import { RoomConnection, loadSession, clearSession, type GreetFn, type ConnStatus } from "./api.js";
import { applyDelta, remainingOf, fmt } from "./deltas.js";
import { GameStore, GERMAN_ERRORS } from "./store.js";
import type { ServerMessage } from "@wordament/shared";
import "./style.css";

/**
 * Screens of the minimal functional shell (visual language is ticket #8):
 * - Home: create a room / join by code (a stored session auto-reclaims).
 * - Lobby: waiting room; the host starts at >= 2 players.
 * - Game: board, interpolated countdown, scoreboard, typed word input.
 * - Intermission: finished round's board + reveal until the next round.
 * - Ended: kicked / room-ended outcomes, each with a real action.
 */

const app = document.getElementById("app")!;

const store = new GameStore();
let conn: RoomConnection | null = null;
let renderTimer: ReturnType<typeof setInterval> | null = null;
let inRoom = false;
let connStatus: ConnStatus = "connecting";

/* ------------------------------------------------------------------ */
/* Boot / routes                                                       */
/* ------------------------------------------------------------------ */

home();

window.addEventListener("popstate", () => {
  if (!inRoom) home();
});

function home(): void {
  document.title = "WortMeister";
  const deepCode = deepLinkCode();
  const stored = deepCode ? loadSession(deepCode) : null;
  app.innerHTML = `
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
  document.getElementById("mk-btn")!.onclick = () => {
    const nickname = input("mk-nick");
    if (!nickname) {
      setHomeError("Bitte gib einen Spitznamen ein.");
      return;
    }
    startRoom(nickname, () => ({ type: "create-room", nickname }));
  };
  document.getElementById("jn-btn")!.onclick = () => {
    const code = (input("jn-code") || deepCode || "").trim().toUpperCase();
    const nickname = input("jn-nick");
    if (!code) {
      setHomeError("Bitte gib einen Raumcode ein.");
      return;
    }
    if (!nickname) {
      setHomeError("Bitte gib einen Spitznamen ein.");
      return;
    }
    const greet: GreetFn = () => {
      const session = loadSession(code);
      return session
        ? { type: "join", code, nickname: session.nickname, token: session.token }
        : { type: "join", code, nickname };
    };
    startRoom(code, greet);
  };
}

function deepLinkCode(): string | null {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]+)\/?$/);
  return m && m[1] ? m[1].toUpperCase() : null;
}

/* ------------------------------------------------------------------ */
/* Room shell                                                          */
/* ------------------------------------------------------------------ */

function startRoom(code: string, greet: GreetFn): void {
  inRoom = true;
  conn = new RoomConnection(code, greet, onMessage, onStatus);
  store.subscribe(render);
  conn.start();
  history.pushState({}, "", `/r/${code}`);
  render();
  if (renderTimer) clearInterval(renderTimer);
  renderTimer = setInterval(interpolateCountdown, 250);
}

function onMessage(msg: ServerMessage): void {
  const before = store.outcome;
  applyDelta(store, msg);
  if (msg.type === "error" && store.phase === "lobby" && msg.code === "room-not-found") {
    renderEnded("Raum nicht gefunden oder abgelaufen.");
    return;
  }
  if (store.outcome !== before) render();
}

function onStatus(status: ConnStatus): void {
  connStatus = status;
  if (status === "closed" && store.outcome === "none") {
    renderEnded("Verbindung beendet.");
    return;
  }
  render();
}

function leaveRoom(): void {
  if (conn) conn.request({ type: "leave" });
  exitToHome();
}

function exitToHome(): void {
  if (store.code) clearSession(store.code);
  if (conn) {
    conn.stop();
    conn = null;
  }
  inRoom = false;
  store.reset();
  history.pushState({}, "", "/");
  home();
}

function teardown(): void {
  if (renderTimer) {
    clearInterval(renderTimer);
    renderTimer = null;
  }
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

function render(): void {
  if (!inRoom) return;
  if (store.outcome === "kicked")
    return renderEnded(`Du wurdest aus dem Raum ${escapeHtml(store.code)} entfernt.`);
  if (store.outcome === "room-ended") return renderEnded(`Raum ${escapeHtml(store.code)} wurde beendet.`);
  switch (store.phase) {
    case "lobby":
      if (store.code) renderLobby();
      return;
    case "playing":
      renderGame();
      return;
    case "intermission":
      renderIntermission();
      return;
    default:
      return;
  }
}

function interpolateCountdown(): void {
  if (store.phase !== "playing" && store.phase !== "intermission") return;
  const el = document.getElementById("countdown");
  if (el) el.textContent = fmt(remainingOf(store));
}

function renderLobby(): void {
  document.title = `WortMeister — Raum ${store.code}`;
  app.innerHTML = `
    <div class="sheet">
      <h1>Raum ${escapeHtml(store.code)}</h1>
      <p>Lade Freunde über den Deep-Link ein:<br /><code>${escapeHtml(location.origin)}<wbr />/r/${escapeHtml(store.code)}</code></p>
      ${statusHtml()}
      <section class="panel">
        <h2>Spieler</h2>
        <ul id="players">${playersHtml()}</ul>
        <p class="dim">${store.players.filter((p) => p.connected).length} verbunden von max. 8</p>
        ${
          store.isHost
            ? `<button id="start-btn">Runde starten</button><span id="start-hint" class="dim"></span>`
            : `<p class="dim">Warte auf den Gastgeber …</p>`
        }
      </section>
      <button id="leave-btn">Zurück zur Startseite</button>
    </div>`;
  const start = document.getElementById("start-btn");
  if (start) {
    start.onclick = () => {
      conn!.request({ type: "start-round" });
    };
  }
  document.getElementById("leave-btn")!.onclick = leaveRoom;
  if (store.lastError) {
    const hint = document.getElementById("start-hint");
    if (hint) hint.textContent = store.errorText;
  }
}

function renderGame(): void {
  document.title = `WortMeister — Runde ${store.roundNumber}`;
  const board = store.round?.board ?? [];
  const spectating = store.self.role === "spectator";
  app.innerHTML = `
    <div class="sheet">
      <h1>Runde ${store.roundNumber} <span id="countdown">${fmt(remainingOf(store))}</span></h1>
      ${statusHtml()}
      ${store.lastError ? `<p id="error">${escapeHtml(store.errorText)}</p>` : ""}
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
               <p class="dim">Gefunden: ${[...store.roundWords].map(escapeHtml).join(" · ") || "—"}</p>`
        }
      </section>
      <section class="panel">
        <h2>Punkte</h2>
        <ul id="players">${playersHtml()}</ul>
      </section>
      <button id="leave-btn">Raum verlassen</button>
    </div>`;
  const form = document.getElementById("word-form");
  if (form) {
    const inputEl = document.getElementById("word-input") as HTMLInputElement;
    inputEl.focus();
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const word = inputEl.value.trim();
      if (!word) return;
      conn!.request({ type: "submit-word", word });
      inputEl.value = "";
    };
  }
  document.getElementById("leave-btn")!.onclick = leaveRoom;
}

function renderIntermission(): void {
  document.title = "WortMeister — Zwischenspiel";
  app.innerHTML = `
    <div class="sheet">
      <h1>Zwischenspiel <span id="countdown">${fmt(remainingOf(store))}</span></h1>
      ${statusHtml()}
      <section class="panel">
        <h2>Runde ${store.finishedRound?.roundNumber ?? store.roundNumber}</h2>
        <div class="board dim">${(store.round?.board ?? []).map((t) => `<div class="tile">${escapeHtml(t)}</div>`).join("")}</div>
        <dl id="reveal">${revealHtml()}</dl>
      </section>
      <section class="panel">
        <h2>Punkte</h2>
        <ul id="players">${playersHtml()}</ul>
      </section>
      ${
        store.isHost
          ? `<button id="skip-btn">Nächste Runde starten</button>`
          : `<p class="dim">Die nächste Runde startet gleich …</p>`
      }
      <button id="leave-btn">Raum verlassen</button>
    </div>`;
  const skip = document.getElementById("skip-btn");
  if (skip) skip.onclick = () => conn!.request({ type: "skip" });
  document.getElementById("leave-btn")!.onclick = leaveRoom;
}

function renderEnded(title: string): void {
  if (conn) {
    conn.stop();
    conn = null;
  }
  inRoom = false;
  teardown();
  document.title = "WortMeister";
  app.innerHTML = `
    <div class="sheet">
      <h1>${escapeHtml(title)}</h1>
      <button id="home-btn">Zur Startseite</button>
    </div>`;
  document.getElementById("home-btn")!.onclick = exitToHome;
}

/* ------------------------------------------------------------------ */
/* Fragments / helpers                                                 */
/* ------------------------------------------------------------------ */

function statusHtml(): string {
  if (connStatus === "open") return "";
  return `<p class="dim">${connStatus === "retrying" ? "Verbindung wird wiederhergestellt …" : "Verbinde …"}</p>`;
}

function playersHtml(): string {
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
function revealHtml(): string {
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

function setHomeError(msg: string): void {
  const box = document.getElementById("home-errors");
  if (box) box.textContent = msg;
}

function input(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el ? el.value.trim() : "";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}
