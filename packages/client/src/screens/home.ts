import type { InstallState } from "../install-state.js";
import type { ScreenContext, ScreenPaint } from "./contract.js";

/** The user-facing app name: the browser title and the home heading. */
export const APP_NAME = "Wortschatz";

/** The install card's German copy (ADR-0029, #257). */
const INSTALL_TITLE = "Startbildschirm";
const INSTALL_BROWSER_BODY = "Öffne Wortschatz ohne Browserleiste.";
const INSTALL_IOS_BODY = "Tippe in Safari auf Teilen und dann auf „Zum Startbildschirm“.";
const INSTALL_ACTION = "Installieren";
const INSTALL_DISMISS = "Später";
const INSTALL_DISMISS_LABEL = "Hinweis ausblenden";

/** The Home-only install card (ADR-0029, #257): a labelled section whose
 *  action is either the browser's real install prompt or Safari's manual
 *  instructions. Without either affordance it renders nothing, so it never
 *  offers a dead action. */
function installCardHtml(install: InstallState): string {
  if (!install.visible) return "";
  const body = install.canInstall ? INSTALL_BROWSER_BODY : INSTALL_IOS_BODY;
  const action = install.canInstall ? `<button id="install-btn">${INSTALL_ACTION}</button>` : "";
  return `
    <section class="panel install-card" aria-labelledby="install-title">
      <h2 id="install-title">${INSTALL_TITLE}</h2>
      <p class="note">${body}</p>
      ${action}
      <button id="install-dismiss-btn" aria-label="${INSTALL_DISMISS_LABEL}">${INSTALL_DISMISS}</button>
    </section>`;
}

/** The landing (ADR-0021): the app name, the tagline and exactly two
 *  actions. It carries no form and no skin switcher — that moved into the
 *  app-owned Menü (ADR-0023). The install card sits below the actions and
 *  appears only while the install state says it is available. */
export function paint(ctx: ScreenContext): ScreenPaint {
  return {
    title: APP_NAME,
    menuKey: "home",
    html: `
    <div class="sheet">
      <h1>${APP_NAME}</h1>
      <p class="dim">Ein Mehrspieler-Wörterspiel.</p>
      <div class="home-actions">
        <button id="create-btn">Raum erstellen</button>
        <button id="join-btn">Raum beitreten</button>
      </div>
      ${installCardHtml(ctx.install)}
    </div>`,
    liveRegions: [],
    wire(root) {
      root.querySelector<HTMLButtonElement>("#create-btn")!.onclick = () => ctx.actions.openCreate();
      root.querySelector<HTMLButtonElement>("#join-btn")!.onclick = () => ctx.actions.openJoin();
      const install = root.querySelector<HTMLButtonElement>("#install-btn");
      if (install) install.onclick = () => void ctx.install.requestInstall();
      const dismiss = root.querySelector<HTMLButtonElement>("#install-dismiss-btn");
      if (dismiss) dismiss.onclick = () => ctx.install.dismiss();
    },
  };
}
