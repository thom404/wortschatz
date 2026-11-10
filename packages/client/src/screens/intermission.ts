import type { RevealPayload, RevealWord } from "@wortschatz/shared";
import { displayWord } from "../display.js";
import { escapeHtml } from "../escape.js";
import { sortAlphabetIcon, sortLengthIcon, sortPointsIcon } from "../icons.js";
import { boardHtml, boardRotationHtml, measureBoardGap, wireBoardRotation } from "../presentation/board.js";
import { iconButtonHtml, leaveButtonHtml } from "../presentation/controls.js";
import { SCOREBOARD_REGION, scoreboardHtml } from "../presentation/scoreboard.js";
import type { GameStore } from "../store.js";
import type { RevealOrder } from "../view-state.js";
import { APP_NAME } from "./home.js";
import type { LiveRegion, ScreenContext, ScreenPaint } from "./contract.js";

/** The host-paced pause (ADR-0016): the finished board, the reveal with its
 *  sort controls and the session standings. It has no clock and no drag. */

/** The German accessible name and tooltip of a reveal's outbound link. */
const WIKTIONARY_LABEL = "Bei Wiktionary nachschlagen";

const GERMAN_COLLATOR = new Intl.Collator("de");

function germanCompare(a: RevealWord, b: RevealWord): number {
  return GERMAN_COLLATOR.compare(a.word, b.word);
}

function revealWordCount(reveal: RevealPayload): number {
  return reveal.groups.reduce((count, group) => count + group.words.length, 0);
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
function wireRevealOrder(root: HTMLElement, ctx: ScreenContext): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>("#reveal-sort button")) {
    button.onclick = () => {
      const mode = button.dataset.sort as RevealOrder | undefined;
      if (!mode || mode === ctx.view.revealOrder) return;
      ctx.view.revealOrder = mode;
      const reveal = root.querySelector<HTMLElement>("#reveal");
      if (reveal) reveal.innerHTML = revealHtml(ctx.store, ctx.view.revealOrder);
      for (const other of root.querySelectorAll<HTMLButtonElement>("#reveal-sort button")) {
        const pressed = other.dataset.sort === ctx.view.revealOrder;
        other.setAttribute("aria-pressed", String(pressed));
        other.classList.toggle("active", pressed);
      }
    };
  }
}

/** The intermission's live region: the session standings. The pause has no
 *  countdown and no private found-word chips. */
const INTERMISSION_LIVE_REGIONS: readonly LiveRegion[] = [SCOREBOARD_REGION];

export function paint(ctx: ScreenContext): ScreenPaint {
  const finishedRoundNumber = ctx.store.finishedRound?.roundNumber ?? ctx.store.roundNumber;
  const reveal = ctx.store.finishedRound?.reveal;
  const hasRevealWords = reveal ? revealWordCount(reveal) > 0 : false;
  // The finished board stays on screen: for live players it survives from
  // the round, and the intermission snapshot re-anchors it for joiners.
  const board = ctx.store.round?.board ?? [];
  return {
    title: `${APP_NAME} — Pause`,
    menuKey: `intermission:${finishedRoundNumber}`,
    html: `
    <div class="sheet">
      <div id="dashboard" class="dashboard intermission">
        <h1 class="area-title">Pause</h1>
        <section class="panel area-board">
          <h2>Runde ${finishedRoundNumber}</h2>
          ${boardHtml(board, ctx.view.boardRotation)}
          ${boardRotationHtml()}
        </section>
        <section class="panel area-reveal">
          <h2>Gefundene Wörter</h2>
          ${hasRevealWords ? revealSortHtml(ctx.view.revealOrder) : ""}
          <dl id="reveal">${revealHtml(ctx.store, ctx.view.revealOrder)}</dl>
        </section>
        <section class="panel area-score">
          <h2>Punkte</h2>
          <ul id="players" class="chips">${scoreboardHtml(ctx.store)}</ul>
          <p class="dim">Es zählt das Gesamtergebnis der Sitzung.</p>
        </section>
      </div>
      ${
        ctx.store.isHost
          ? `<button id="start-btn">Nächste Runde starten</button>`
          : `<p class="dim next-round-hint">Der Gastgeber startet die nächste Runde.</p>`
      }
      ${leaveButtonHtml()}
    </div>`,
    liveRegions: INTERMISSION_LIVE_REGIONS,
    wire(root) {
      // Post-render order: measure the gap, wire the reveal sort, wire
      // rotation, then the start/leave controls.
      ctx.drag.setHitMargin(measureBoardGap(root));
      wireRevealOrder(root, ctx);
      wireBoardRotation(root, board, ctx.view, () => {});
      const start = root.querySelector<HTMLButtonElement>("#start-btn");
      if (start) start.onclick = () => ctx.actions.startRound();
      root.querySelector<HTMLButtonElement>("#leave-btn")!.onclick = () => ctx.actions.leaveRoom();
    },
    lateLinks(root) {
      const el = root.querySelector<HTMLElement>("#reveal");
      if (el) el.innerHTML = revealHtml(ctx.store, ctx.view.revealOrder);
    },
  };
}
