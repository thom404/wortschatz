// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  intermissionSnapshot,
  lobbySnapshot,
  mountHarness,
  playingSnapshot,
  playerJoined,
  roundEnded,
  roundStarted,
  seat,
  synthesizePointerDrag,
  tick,
  tileEls,
  type Mounted,
} from "./harness.js";
import { APP_VERSION } from "../src/version.js";

/**
 * The app-owned Menü (ADR-0023): one persistent surface on every screen,
 * carrying only app-global entries. Assertions live on rendered DOM, focus
 * and the boundary messages — never on the app's internal state.
 */

const BOARD = ["H", "A", "U", "S", "T", "I", "R", "E", "B", "U", "M", "S", "K", "A", "T", "Z"];
const REVEAL = { groups: [] };

let app: Mounted | null = null;

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, "", "/");
  app = mountHarness();
});

afterEach(() => {
  app?.unmount();
  app = null;
});

function click(sel: string): void {
  app!.root.querySelector<HTMLButtonElement>(sel)!.click();
}

function trigger(): HTMLButtonElement {
  return app!.root.querySelector<HTMLButtonElement>("#menu-trigger")!;
}

function panel(): HTMLElement {
  return app!.root.querySelector<HTMLElement>("#menu-panel")!;
}

function openMenu(): void {
  trigger().focus();
  trigger().click();
}

function enterLobby(code = "LAG4T"): void {
  click("#create-btn");
  app!.root.querySelector<HTMLInputElement>("#mk-nick")!.value = "Lena";
  click("#mk-btn");
  app!.conn().feed(lobbySnapshot({ code, nickname: "Lena" }));
}

function enterGame(code = "LAG4T"): void {
  enterLobby(code);
  click("#start-btn");
  app!.conn().feed(roundStarted(BOARD));
}

function enterIntermission(code = "LAG4T"): void {
  enterGame(code);
  app!.conn().feed(roundEnded(1, REVEAL));
}

function enterOutcome(): void {
  enterLobby();
  app!.conn().feed({ type: "room-ended", reason: "host-closed" });
}

describe("Menü (ADR-0023)", () => {
  it("keeps one trigger outside the screen markup on all seven screens", () => {
    const surface = trigger();
    expect(app!.root.querySelector("#screen #menu-trigger")).toBeNull();
    expect(surface.getAttribute("aria-label")).toBe("Menü");
    expect(surface.getAttribute("data-tip")).toBe("Menü");
    expect(surface.getAttribute("aria-haspopup")).toBe("dialog");
    expect(surface.getAttribute("aria-expanded")).toBe("false");
    expect(panel().hidden).toBe(true);

    click("#create-btn");
    expect(trigger()).toBe(surface);
    expect(trigger().isConnected).toBe(true);

    click("#back-btn");
    click("#join-btn");
    expect(trigger()).toBe(surface);

    app!.unmount();
    app = mountHarness();
    enterLobby();
    expect(trigger().isConnected).toBe(true);

    click("#start-btn");
    app!.conn().feed(roundStarted(BOARD));
    expect(app!.root.querySelector("#screen h1")!.textContent).toContain("Runde 1");
    expect(trigger().isConnected).toBe(true);

    app!.conn().feed(roundEnded(1, REVEAL));
    expect(app!.root.querySelector("#screen h1")!.textContent).toBe("Pause");
    expect(trigger().isConnected).toBe(true);

    app!.conn().feed({ type: "room-ended", reason: "host-closed" });
    expect(app!.root.querySelector("#screen h1")!.textContent).toContain("wurde beendet");
    expect(trigger().isConnected).toBe(true);
  });

  it("opens by the trigger and closes by the trigger, Esc, an outside click and a screen change", () => {
    openMenu();
    expect(panel().hidden).toBe(false);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");

    // Trigger again.
    trigger().click();
    expect(panel().hidden).toBe(true);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    // Esc.
    openMenu();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel().hidden).toBe(true);

    // Outside click.
    openMenu();
    app!.root.querySelector<HTMLElement>("#screen h1")!.click();
    expect(panel().hidden).toBe(true);

    // Screen change: opening over Play and starting the intermission closes
    // it, while a rebuild of the same screen leaves it alone.
    enterGame();
    openMenu();
    app!.conn().feed(playerJoined(2, "Ben"));
    expect(panel().hidden).toBe(false);
    app!.conn().feed(roundEnded(1, REVEAL));
    expect(app!.root.querySelector("#screen h1")!.textContent).toBe("Pause");
    expect(panel().hidden).toBe(true);
  });

  it("moves focus into the panel on open and back to the trigger on close", () => {
    openMenu();
    expect(panel().hidden).toBe(false);
    expect(document.activeElement).toBe(panel());

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(trigger());

    openMenu();
    app!.root.querySelector<HTMLElement>("#screen h1")!.click();
    expect(document.activeElement).toBe(trigger());
  });

  it("renders the version constant exactly and no skin select on Home", () => {
    expect(app!.root.querySelector("#screen #skin-select")).toBeNull();
    expect(app!.root.querySelectorAll(".home-actions button")).toHaveLength(2);

    openMenu();
    expect(panel().querySelector(".menu-version")!.textContent).toBe(`Version ${APP_VERSION}`);
    expect(panel().querySelector<HTMLSelectElement>("#skin-select")!.value).toBe("standard");
    expect(panel().querySelector("h2")!.textContent).toBe("Skin");
  });

  it("applies a skin through the Menü app-wide at once and persists it across visits", () => {
    openMenu();
    const select = panel().querySelector<HTMLSelectElement>("#skin-select")!;
    select.value = "arcade";
    select.dispatchEvent(new Event("change"));

    expect(document.body.dataset.skin).toBe("arcade");
    expect(localStorage.getItem("wordament:skin")).toBe("arcade");

    // A structural rebuild while the panel is open neither removes the menu
    // nor loses the wiring.
    enterGame();
    openMenu();
    const rebuiltSelect = panel().querySelector<HTMLSelectElement>("#skin-select")!;
    rebuiltSelect.value = "standard";
    rebuiltSelect.dispatchEvent(new Event("change"));
    expect(document.body.dataset.skin).toBe("standard");

    app!.unmount();
    app = mountHarness();
    expect(document.body.dataset.skin).toBe("standard");
    openMenu();
    expect(panel().querySelector<HTMLSelectElement>("#skin-select")!.value).toBe("standard");
  });

  it("keeps the round ticking behind the open panel and leaves board gestures working after closing", () => {
    enterGame();
    const timer = app!.root.querySelector("#timer");
    openMenu();

    app!.conn().feed(tick(90_000));
    expect(app!.root.querySelector("#timer")).toBe(timer);
    expect(app!.root.querySelector("#countdown")!.textContent).toBe("1:30");
    expect(panel().hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const tiles = tileEls(app!.root);
    synthesizePointerDrag([tiles[0]!, tiles[1]!, tiles[4]!], "mouse");
    expect(app!.conn().sent().at(-1)).toEqual({ type: "submit-word", word: "HAT", reqId: 3 });
  });

  it("keeps the panel closed and out of the focus path while the surface is closed", () => {
    expect(panel().hidden).toBe(true);
    expect(panel().hasAttribute("tabindex")).toBe(true);
    expect(app!.root.querySelector("#menu-panel:not([hidden])")).toBeNull();
    expect(app!.root.querySelector("#menu")).not.toBeNull();
  });
});
