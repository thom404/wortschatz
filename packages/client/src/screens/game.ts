import { PROTOCOL } from "@wortschatz/shared";
import { displayWord } from "../display.js";
import { escapeHtml } from "../escape.js";
import { TRACE_HINT } from "../game-drag.js";
import { boardHtml, boardRotationHtml, measureBoardGap, wireBoardRotation } from "../presentation/board.js";
import { leaveButtonHtml } from "../presentation/controls.js";
import { SCOREBOARD_REGION, scoreboardHtml } from "../presentation/scoreboard.js";
import type { GameStore } from "../store.js";
import { APP_NAME } from "./home.js";
import type { LiveRegion, ScreenContext, ScreenPaint } from "./contract.js";

/** The playing screen: the board, ring countdown, scoreboard, drag surface
 *  and private found-word chips. It owns the timer helpers and the
 *  found-word chips, while the shell keeps the 250 ms interval. */

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
function timerHtml(ctx: ScreenContext): string {
  const state = timerState(ctx.store);
  return `
    <div id="timer" class="timer area-timer${state.low ? " low" : ""}">
      <span id="countdown" class="timer-digits">${fmt(remainingOf(ctx.store))}</span>
      <span id="round-score" class="timer-score">${ctx.store.selfRoundScore} P</span>
    </div>`;
}

/** The ring timer's live state: progress fraction (0..1) across the round,
 *  and the shared low-time look toggle. Only the round has a countdown. */
function timerState(store: GameStore): { fraction: number; low: boolean } {
  const remaining = remainingOf(store);
  return {
    fraction: Math.min(1, Math.max(0, remaining / PROTOCOL.ROUND_MS)),
    low: remaining <= LOW_TIME_MS,
  };
}

/** Inline style attributes are intentionally forbidden by the app-level CSP;
 *  the timer's `--p` knob goes through CSSOM on first paint and every tick. */
function updateTimer(ctx: ScreenContext): void {
  if (ctx.store.phase !== "playing") return;
  const el = ctx.root.querySelector<HTMLElement>("#countdown");
  if (!el) return;
  const remaining = remainingOf(ctx.store);
  el.textContent = fmt(remaining);
  const timer = ctx.root.querySelector<HTMLElement>("#timer");
  if (timer) {
    const { fraction, low } = timerState(ctx.store);
    timer.style.setProperty("--p", fraction.toFixed(4));
    timer.classList.toggle("low", low);
  }
  const score = ctx.root.querySelector<HTMLElement>("#round-score");
  if (score) score.textContent = `${ctx.store.selfRoundScore} P`;
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

/** Rewrites the private found-word chips in place; absent for spectators. */
function updateFound(ctx: ScreenContext): void {
  const el = ctx.root.querySelector<HTMLElement>("#found");
  if (!el) return;
  el.innerHTML = foundHtml(ctx.store);
}

const TIMER_REGION: LiveRegion = { selector: "#timer", update: updateTimer };
const FOUND_REGION: LiveRegion = { selector: "#found", update: updateFound };

/** The game screen's live regions: the ring timer, the ranked scoreboard and
 *  the private found-word chips (absent for a spectator, and skipped then). */
const GAME_LIVE_REGIONS: readonly LiveRegion[] = [TIMER_REGION, SCOREBOARD_REGION, FOUND_REGION];

export function paint(ctx: ScreenContext): ScreenPaint {
  const board = ctx.store.round?.board ?? [];
  const spectating = ctx.store.self.role === "spectator";
  return {
    title: `${APP_NAME} — Runde ${ctx.store.roundNumber}`,
    menuKey: `game:${ctx.store.roundNumber}`,
    html: `
    <div class="sheet">
      <div id="dashboard" class="dashboard">
        <h1 class="area-title">Runde ${ctx.store.roundNumber}</h1>
        ${timerHtml(ctx)}
        <section class="panel area-board">
          <h2>Spielfeld</h2>
          ${spectating ? "" : `<div id="trace" class="trace hint">${TRACE_HINT}</div>`}
          ${boardHtml(board, ctx.view.boardRotation)}
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
                 <ul id="found" class="chips">${foundHtml(ctx.store)}</ul>
               </section>`
        }
        <section class="panel area-score">
          <h2>Punkte</h2>
          <ul id="players" class="chips">${scoreboardHtml(ctx.store)}</ul>
        </section>
      </div>
      ${leaveButtonHtml()}
    </div>`,
    liveRegions: GAME_LIVE_REGIONS,
    wire(root) {
      // Post-render order: seed the timer through CSSOM, measure the gap,
      // wire rotation and leave, then rehydrate a live drag's trace.
      updateTimer(ctx);
      ctx.drag.setHitMargin(measureBoardGap(root));
      wireBoardRotation(root, board, ctx.view, () => ctx.drag.paint());
      root.querySelector<HTMLButtonElement>("#leave-btn")!.onclick = () => ctx.actions.leaveRoom();
      // Re-render can happen mid-drag (server deltas don't pause the game);
      // rehydrate the trace paint onto the fresh DOM.
      ctx.drag.paint();
    },
    tick() {
      updateTimer(ctx);
    },
  };
}
