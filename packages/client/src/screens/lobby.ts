import { escapeHtml } from "../escape.js";
import { checkIcon, copyIcon } from "../icons.js";
import { qrSvg } from "../qr.js";
import { iconButtonHtml, leaveButtonHtml } from "../presentation/controls.js";
import { SCOREBOARD_REGION, scoreboardHtml } from "../presentation/scoreboard.js";
import { APP_NAME } from "./home.js";
import type { LiveRegion, ScreenContext, ScreenPaint } from "./contract.js";

/** The one German string of the lobby's copy control, used for both its
 *  accessible name and its tooltip, so the two can never drift (ADR-0022). */
const COPY_LINK_LABEL = "Link kopieren";
const COPIED_LINK_LABEL = "Link kopiert.";
const COPY_LINK_ERROR = "Der Link konnte nicht kopiert werden. Markiere ihn und kopiere ihn von Hand.";

/** The lobby's live region: the join-ordered seat roster. A play-time delta
 *  never reaches the lobby, but the declaration keeps its refresh path
 *  uniform with the other screens. */
const LOBBY_LIVE_REGIONS: readonly LiveRegion[] = [SCOREBOARD_REGION];

/** The Wait room: the invite card with its QR code and deep link, the seated
 *  players, and the host's `Runde starten` — or, for everyone else, the wait
 *  for the host. Its copy feedback is owned and disposed here, so a late
 *  clipboard result can never write onto the next screen. */
export function paint(ctx: ScreenContext): ScreenPaint {
  // One source of truth for the join target (#48): the QR payload, the
  // visible invite text and the clipboard write are the same absolute deep
  // link, code uppercased.
  const code = ctx.store.code.toUpperCase();
  const deepLink = `${location.origin}/r/${code}`;

  let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  /** The invite card's two-second copy confirmation. The card rebuild
   *  disposes the paint first, so a stale callback can never write into a
   *  later render. */
  function clearCopyFeedback(): void {
    if (!copyFeedbackTimer) return;
    clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = null;
  }

  /** Returns the copy control to its resting label and empties the polite
   *  announcement; only ever resolves against the current invite card. */
  function resetCopyFeedback(): void {
    copyFeedbackTimer = null;
    if (disposed) return;
    const button = ctx.root.querySelector<HTMLButtonElement>("#copy-link-btn");
    if (button) {
      button.innerHTML = copyIcon;
      button.setAttribute("aria-label", COPY_LINK_LABEL);
      button.setAttribute("data-tip", COPY_LINK_LABEL);
    }
    const status = ctx.root.querySelector<HTMLElement>("#copy-status");
    if (status) status.textContent = "";
  }

  /** The one success path: check icon, same label and tooltip, a polite
   *  hidden announcement, and a fresh 2000 ms window on every press. */
  function showCopySuccess(): void {
    if (disposed) return;
    const button = ctx.root.querySelector<HTMLButtonElement>("#copy-link-btn");
    if (!button) return;
    button.innerHTML = checkIcon;
    button.setAttribute("aria-label", COPIED_LINK_LABEL);
    button.setAttribute("data-tip", COPIED_LINK_LABEL);
    const status = ctx.root.querySelector<HTMLElement>("#copy-status");
    if (status) {
      status.textContent = "";
      status.textContent = COPIED_LINK_LABEL;
    }
    clearCopyFeedback();
    copyFeedbackTimer = setTimeout(() => resetCopyFeedback(), 2000);
  }

  /** The no-Clipboard-API fallback: select the visible link text and hand the
   *  selection to the legacy copy command. Returns whether it succeeded. */
  function copyLinkBySelection(): boolean {
    if (disposed) return false;
    const link = ctx.root.querySelector<HTMLElement>("#join-link");
    if (!link) return false;
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(link);
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }

  /** Writes the exact Deep link as text/plain. A missing, denied or rejecting
   *  Clipboard API falls back to the selected text; both failures surface in
   *  the one floating error slot, and the visible text stays selectable. The
   *  disposed check keeps an async result off a later screen. */
  async function copyInviteLink(): Promise<void> {
    const clipboard = navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      try {
        await clipboard.writeText(deepLink);
        if (disposed) return;
        showCopySuccess();
        return;
      } catch {
        // Fall through to the selection path.
        if (disposed) return;
      }
    }
    if (copyLinkBySelection()) {
      showCopySuccess();
      return;
    }
    if (!disposed) ctx.notices.setLocalError(COPY_LINK_ERROR);
  }

  return {
    title: `${APP_NAME} — Raum ${ctx.store.code}`,
    menuKey: `lobby:${ctx.store.code}`,
    html: `
    <div class="sheet">
      <h1>Raum ${escapeHtml(ctx.store.code)}</h1>
      <section class="panel invite">
        <h2>Einladen</h2>
        <p class="note">Scanne den Code mit der Kamera, um beizutreten.</p>
        ${qrSvg(deepLink)}
        <p class="invite-link"><span id="join-link">${escapeHtml(deepLink)}</span>${iconButtonHtml({
          id: "copy-link-btn",
          className: "icon-btn copy-link",
          icon: copyIcon,
          label: COPY_LINK_LABEL,
        })}</p>
        <span id="copy-status" class="visually-hidden" role="status" aria-live="polite"></span>
      </section>
      <section class="panel">
        <h2>Spieler</h2>
        <ul id="players" class="chips">${scoreboardHtml(ctx.store)}</ul>
        <p class="dim">${ctx.store.players.filter((p) => p.connected).length} von 8 verbunden</p>
        ${
          ctx.store.isHost
            ? `<button id="start-btn">Runde starten</button>`
            : `<p class="dim">Warte auf den Gastgeber …</p>`
        }
      </section>
      ${leaveButtonHtml()}
    </div>`,
    liveRegions: LOBBY_LIVE_REGIONS,
    wire(root) {
      const start = root.querySelector<HTMLButtonElement>("#start-btn");
      if (start) start.onclick = () => ctx.actions.startRound();
      root.querySelector<HTMLButtonElement>("#leave-btn")!.onclick = () => ctx.actions.leaveRoom();
      root.querySelector<HTMLButtonElement>("#copy-link-btn")!.onclick = () => {
        ctx.notices.clearError();
        void copyInviteLink();
      };
    },
    dispose() {
      disposed = true;
      clearCopyFeedback();
    },
  };
}
