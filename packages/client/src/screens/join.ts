import { escapeHtml } from "../escape.js";
import { loadSession } from "../connection.js";
import type { GreetFn } from "../connection.js";
import { readField } from "../presentation/controls.js";
import { APP_NAME } from "./home.js";
import type { ScreenContext, ScreenPaint } from "./contract.js";

/** The Join screen. A deep-linked code is pre-filled and read-only, and the
 *  remembered session nickname pre-fills the name; a code reached from Home
 *  stays editable. It sends the connection's first `join` greeting. */
export function paint(ctx: ScreenContext): ScreenPaint {
  const deep = ctx.roomCode !== "";
  const code = deep ? ctx.roomCode : "";
  const stored = deep ? loadSession(code) : null;
  return {
    title: APP_NAME,
    menuKey: "join",
    html: `
    <div class="sheet">
      <h1>Raum beitreten</h1>
      <section class="panel">
        ${deep ? `<p class="note">Du wurdest in Raum ${escapeHtml(code)} eingeladen.</p>` : ""}
        <label>Raumcode <input id="jn-code" maxlength="8" autocapitalize="characters" placeholder="ABC12" value="${escapeHtml(code)}"${deep ? " readonly" : ""} /></label>
        <label>Name <input id="jn-nick" maxlength="24" placeholder="z. B. Jörg" value="${escapeHtml(stored?.nickname ?? "")}" /></label>
        <button id="jn-btn">Beitreten</button>
      </section>
      <button id="back-btn">Zurück</button>
    </div>`,
    liveRegions: [],
    wire(root) {
      root.querySelector<HTMLButtonElement>("#jn-btn")!.onclick = () => {
        const typedCode = (readField(root, "jn-code") || code).trim().toUpperCase();
        const nickname = readField(root, "jn-nick");
        if (!typedCode) {
          ctx.notices.setLocalError("Bitte gib einen Raumcode ein.");
          return;
        }
        if (!nickname) {
          ctx.notices.setLocalError("Bitte gib einen Namen ein.");
          return;
        }
        const greet: GreetFn = () => {
          const session = loadSession(typedCode);
          return session
            ? { type: "join", code: typedCode, nickname: session.nickname, token: session.token }
            : { type: "join", code: typedCode, nickname };
        };
        ctx.actions.startRoom(typedCode, greet);
      };
      root.querySelector<HTMLButtonElement>("#back-btn")!.onclick = () => ctx.actions.backToHome();
    },
  };
}
