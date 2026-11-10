import type { PlayerInfo } from "@wortschatz/shared";
import { escapeHtml } from "../escape.js";
import type { GameStore } from "../store.js";
import type { LiveRegion, ScreenContext } from "../screens/contract.js";

/** The scoreboard shared by Lobby, Game and Intermission: the player chips,
 *  the phase's one mode decision and the in-place standings update. */

/** The scoreboard's mode in the current phase: the ranked round scoreboard
 *  while playing, the cumulative session standings during the intermission,
 *  the join-ordered roster otherwise. This is the single place the mode is
 *  decided, so a screen's first paint and its in-place update cannot disagree. */
export function scoreboardMode(phase: GameStore["phase"]): "seats" | "ranked" | "session" {
  if (phase === "playing") return "ranked";
  if (phase === "intermission") return "session";
  return "seats";
}

/** The current scoreboard chips, in the mode its phase prescribes — read by
 *  both the screen templates and the in-place updater. */
export function scoreboardHtml(store: GameStore): string {
  return playerChipsHtml(store, scoreboardMode(store.phase));
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
export function playerChipsHtml(store: GameStore, mode: "seats" | "ranked" | "session" = "seats"): string {
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

/** Rewrites the live player chips in place — chip children change, the
 *  `#players` list element itself survives. */
export function updateScoreboard(ctx: ScreenContext): void {
  const el = ctx.root.querySelector<HTMLElement>("#players");
  if (!el) return;
  el.innerHTML = scoreboardHtml(ctx.store);
}

/** The shared scoreboard live region (ADR-0013). */
export const SCOREBOARD_REGION: LiveRegion = {
  selector: "#players",
  update: updateScoreboard,
};
