// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOARD,
  NO_WORDS,
  ROOM_CODE,
  click,
  driveScene,
  intermissionSnapshot,
  lobbySnapshot,
  mountHarness,
  playingSnapshot,
  roundEnded,
  type Mounted,
} from "./harness.js";
import { INSTALL_DISMISSED_KEY, type BeforeInstallPromptEvent } from "../src/install-state.js";

/**
 * The Home install card (#257): it appears only when the browser offers its
 * prompt or Safari's manual instructions apply, and only on Home. Its copy,
 * dismissal and installed-event behavior are asserted through the rendered
 * screen; the install-state module is the only code touching the browser
 * events.
 */

const COPY = {
  title: "Startbildschirm",
  browserBody: "Öffne Wortschatz ohne Browserleiste.",
  iosBody: "Tippe in Safari auf Teilen und dann auf „Zum Startbildschirm“.",
  action: "Installieren",
  dismiss: "Später",
  dismissLabel: "Hinweis ausblenden",
};

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const REAL_UA = navigator.userAgent;

let app: Mounted | null = null;

beforeEach(() => {
  localStorage.removeItem(INSTALL_DISMISSED_KEY);
  window.history.pushState({}, "", "/");
  app = mountHarness();
});

afterEach(() => {
  app?.unmount();
  app = null;
  localStorage.removeItem(INSTALL_DISMISSED_KEY);
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: REAL_UA });
  Reflect.deleteProperty(navigator, "standalone");
});

function remount(): void {
  app!.unmount();
  app = mountHarness();
}

function installCard(): HTMLElement | null {
  return app!.root.querySelector<HTMLElement>(".install-card");
}

/** A browser install-prompt event as Chromium dispatches it. */
function offerInstallPrompt(outcome: "accepted" | "dismissed" = "dismissed"): {
  event: BeforeInstallPromptEvent;
  prompt: ReturnType<typeof vi.fn>;
} {
  const prompt = vi.fn(async () => {});
  const event = new Event("beforeinstallprompt", { cancelable: true }) as BeforeInstallPromptEvent;
  Object.defineProperties(event, {
    prompt: { value: prompt },
    userChoice: { value: Promise.resolve({ outcome, platform: "web" }) },
  });
  window.dispatchEvent(event);
  return { event, prompt };
}

describe("install card on Home (#257)", () => {
  it("stays hidden until the browser offers its prompt, then shows the Chromium card", () => {
    expect(installCard()).toBeNull();

    const { event } = offerInstallPrompt();

    const card = installCard()!;
    expect(card).toBeTruthy();
    expect(card.tagName).toBe("SECTION");
    expect(card.getAttribute("aria-labelledby")).toBe("install-title");
    expect(card.querySelector("#install-title")!.textContent).toBe(COPY.title);
    expect(card.querySelector(".note")!.textContent).toBe(COPY.browserBody);

    const install = card.querySelector<HTMLButtonElement>("#install-btn")!;
    expect(install.tagName).toBe("BUTTON");
    expect(install.textContent).toBe(COPY.action);

    expect(event.defaultPrevented).toBe(true);
  });

  it("names the dismissal Hinweis ausblenden while showing Später", () => {
    offerInstallPrompt();

    const dismiss = installCard()!.querySelector<HTMLButtonElement>("#install-dismiss-btn")!;
    expect(dismiss.tagName).toBe("BUTTON");
    expect(dismiss.textContent).toBe(COPY.dismiss);
    expect(dismiss.getAttribute("aria-label")).toBe(COPY.dismissLabel);
  });

  it("opens the browser prompt from Installieren, then leaves no dead action", async () => {
    const { prompt } = offerInstallPrompt("accepted");
    app!.root.querySelector<HTMLButtonElement>("#install-btn")!.click();

    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(installCard()).toBeNull());
  });

  it("hides the card once the one browser prompt was dismissed", async () => {
    const { prompt } = offerInstallPrompt("dismissed");
    app!.root.querySelector<HTMLButtonElement>("#install-btn")!.click();

    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(installCard()).toBeNull());
  });

  it("shows Safari's own instructions on iOS instead of an Installieren action", () => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: IPHONE_UA });
    remount();

    const card = installCard()!;
    expect(card.querySelector(".note")!.textContent).toBe(COPY.iosBody);
    expect(card.querySelector("#install-btn")).toBeNull();
    expect(card.querySelector("#install-dismiss-btn")).toBeTruthy();
  });

  it("never appears in an already installed window, even if a prompt arrives", () => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    remount();

    expect(installCard()).toBeNull();
    offerInstallPrompt();
    expect(installCard()).toBeNull();
  });

  it("hides the card for good when the installed event fires", () => {
    offerInstallPrompt();
    expect(installCard()).not.toBeNull();

    window.dispatchEvent(new Event("appinstalled"));
    expect(installCard()).toBeNull();

    offerInstallPrompt();
    expect(installCard()).toBeNull();
  });

  it("stores Später under one client key and keeps the card away after a reload", () => {
    offerInstallPrompt();
    installCard()!.querySelector<HTMLButtonElement>("#install-dismiss-btn")!.click();

    expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe("1");
    expect(installCard()).toBeNull();

    // A fresh mount reads the same guarded storage: a later prompt cannot
    // bring the card back on this visit.
    remount();
    offerInstallPrompt();
    expect(installCard()).toBeNull();
  });

  it("renders on Home only, never on Create, Join, Wait room, Game, Intermission or an outcome", () => {
    offerInstallPrompt();
    expect(installCard()).not.toBeNull();

    click(app!.root, "#create-btn");
    expect(installCard()).toBeNull();
    click(app!.root, "#back-btn");
    expect(installCard()).not.toBeNull();

    click(app!.root, "#join-btn");
    expect(installCard()).toBeNull();
    click(app!.root, "#back-btn");
    expect(installCard()).not.toBeNull();

    driveScene(app!, {
      entry: { mode: "create", nickname: "Lena" },
      greeting: [lobbySnapshot({ code: ROOM_CODE, nickname: "Lena" })],
    });
    expect(installCard()).toBeNull();

    app!.conn().feed(
      playingSnapshot({
        code: ROOM_CODE,
        selfSeatId: 1,
        nickname: "Lena",
        role: "player",
        board: BOARD,
      })
    );
    expect(installCard()).toBeNull();

    app!.conn().feed(roundEnded(1, NO_WORDS));
    expect(installCard()).toBeNull();

    app!.conn().feed({ type: "room-ended", reason: "host-closed" });
    expect(installCard()).toBeNull();
  });

  it("keeps the card off a join that lands directly in the intermission", () => {
    offerInstallPrompt();
    driveScene(app!, {
      entry: { mode: "join", nickname: "Ben", code: ROOM_CODE },
      greeting: [
        intermissionSnapshot({
          code: ROOM_CODE,
          selfSeatId: 2,
          nickname: "Ben",
          board: BOARD,
          reveal: NO_WORDS,
        }),
      ],
    });
    expect(installCard()).toBeNull();
  });
});
