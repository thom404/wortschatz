import { readField } from "../presentation/controls.js";
import { APP_NAME } from "./home.js";
import type { ScreenContext, ScreenPaint } from "./contract.js";

/** The Create screen: one `Name` field and one create button. It sends the
 *  connection's first `create-room` greeting and owns its form validation. */
export function paint(ctx: ScreenContext): ScreenPaint {
  return {
    title: APP_NAME,
    menuKey: "create",
    html: `
    <div class="sheet">
      <h1>Raum erstellen</h1>
      <section class="panel">
        <label>Name <input id="mk-nick" maxlength="24" placeholder="z. B. Anja" /></label>
        <button id="mk-btn">Raum erstellen</button>
      </section>
      <button id="back-btn">Zurück</button>
    </div>`,
    liveRegions: [],
    wire(root) {
      root.querySelector<HTMLButtonElement>("#mk-btn")!.onclick = () => {
        const nickname = readField(root, "mk-nick");
        if (!nickname) {
          ctx.notices.setLocalError("Bitte gib einen Namen ein.");
          return;
        }
        ctx.actions.startRoom(nickname, () => ({ type: "create-room", nickname }));
      };
      root.querySelector<HTMLButtonElement>("#back-btn")!.onclick = () => ctx.actions.backToHome();
    },
  };
}
