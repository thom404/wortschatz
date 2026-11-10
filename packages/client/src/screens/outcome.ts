import type { RoomEndReason } from "@wortschatz/shared";
import { escapeHtml } from "../escape.js";
import { homeIcon } from "../icons.js";
import { APP_NAME } from "./home.js";
import type { ScreenContext, ScreenPaint } from "./contract.js";

/**
 * The out-of-room outcome screens (#21): kicked, room ended (host closed or
 * expired), room not found and an unexpected connection close — one settled
 * screen each, a real action (back to home), built from the same component
 * vocabulary and tokens as the in-room screens (ADR-0002). All texts are
 * hardcoded German. The Menu key is a stable kind, never the title markup.
 */
export type Outcome =
  | { kind: "kicked" }
  | { kind: "room-ended"; reason: RoomEndReason }
  | { kind: "room-not-found" }
  | { kind: "connection-lost" };

const OUTCOME_NOTE = "Du kannst einen neuen Raum erstellen oder einem anderen beitreten.";

function roomCodeHtml(code: string): string {
  return `<code>${escapeHtml(code)}</code>`;
}

interface OutcomeScreen {
  titleHtml: string;
  noteHtml: string;
}

function outcomeScreen(ctx: ScreenContext, outcome: Outcome): OutcomeScreen {
  if (outcome.kind === "kicked") {
    return {
      titleHtml: `Du wurdest aus dem Raum ${roomCodeHtml(ctx.store.code)} entfernt.`,
      noteHtml: `Der Gastgeber hat dich aus dem Raum entfernt. ${OUTCOME_NOTE}`,
    };
  }
  if (outcome.kind === "room-ended") {
    const code = roomCodeHtml(ctx.store.code);
    if (outcome.reason === "expired")
      return {
        titleHtml: `Raum ${code} ist abgelaufen.`,
        noteHtml: OUTCOME_NOTE,
      };
    return {
      titleHtml: `Raum ${code} wurde beendet.`,
      noteHtml: OUTCOME_NOTE,
    };
  }
  if (outcome.kind === "room-not-found") {
    // No snapshot ever named the store; the join code the user typed is
    // still the routing room code.
    return {
      titleHtml: `Raum ${roomCodeHtml(ctx.roomCode)} nicht gefunden oder abgelaufen.`,
      noteHtml: `Prüfe den Raumcode, oder erstelle einen neuen Raum.`,
    };
  }
  return {
    titleHtml: "Verbindung beendet.",
    noteHtml: OUTCOME_NOTE,
  };
}

export function paint(ctx: ScreenContext, outcome: Outcome): ScreenPaint {
  const screen = outcomeScreen(ctx, outcome);
  return {
    title: APP_NAME,
    menuKey: outcome.kind,
    html: `
    <div class="sheet">
      <h1>${screen.titleHtml}</h1>
      <section class="panel">
        <p class="note">${screen.noteHtml}</p>
        <button id="home-btn" class="icon-text-btn">${homeIcon}<span>Zur Startseite</span></button>
      </section>
    </div>`,
    liveRegions: [],
    wire(root) {
      root.querySelector<HTMLButtonElement>("#home-btn")!.onclick = () => ctx.actions.exitToHome();
    },
  };
}
