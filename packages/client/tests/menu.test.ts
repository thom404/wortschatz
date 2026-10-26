// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BOARD,
  COPY,
  NO_WORDS,
  ROOM_CODE,
  click,
  driveScene,
  driveToRoundOne,
  lobbySnapshot,
  mountHarness,
  playerJoined,
  roundEnded,
  roundStarted,
  synthesizePointerDrag,
  tick,
  tileEls,
  type Mounted,
} from "./harness.js";
import { APP_VERSION } from "../src/version.js";
import { CHANGELOG } from "../src/menu.js";

/**
 * The app-owned Menü (ADR-0023): one persistent surface on every screen,
 * carrying only app-global entries. Assertions live on rendered DOM, focus
 * and the boundary messages — never on the app's internal state.
 */

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

describe("Menü (ADR-0023)", () => {
  it("keeps one trigger outside the screen markup on all seven screens", () => {
    const surface = trigger();
    expect(app!.root.querySelector("#screen #menu-trigger")).toBeNull();
    expect(surface.getAttribute("aria-label")).toBe(COPY.menu.label);
    expect(surface.getAttribute("data-tip")).toBe(COPY.menu.label);
    expect(surface.getAttribute("aria-haspopup")).toBe("dialog");
    expect(surface.getAttribute("aria-expanded")).toBe("false");
    expect(panel().hidden).toBe(true);

    click(app!.root, "#create-btn");
    expect(trigger()).toBe(surface);
    expect(trigger().isConnected).toBe(true);

    click(app!.root, "#back-btn");
    click(app!.root, "#join-btn");
    expect(trigger()).toBe(surface);

    app!.unmount();
    app = mountHarness();
    driveScene(app!, {
      entry: { mode: "create", nickname: "Lena" },
      greeting: [lobbySnapshot({ code: ROOM_CODE, nickname: "Lena" })],
    });
    expect(trigger().isConnected).toBe(true);

    click(app!.root, "#start-btn");
    app!.conn().feed(roundStarted(BOARD));
    expect(app!.root.querySelector("#screen h1")!.textContent).toContain(COPY.game.title(1));
    expect(trigger().isConnected).toBe(true);

    app!.conn().feed(roundEnded(1, NO_WORDS));
    expect(app!.root.querySelector("#screen h1")!.textContent).toBe(COPY.intermission.title);
    expect(trigger().isConnected).toBe(true);

    app!.conn().feed({ type: "room-ended", reason: "host-closed" });
    expect(app!.root.querySelector("#screen h1")!.textContent).toContain(COPY.outcomes.ended(ROOM_CODE));
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
    driveToRoundOne(app!);
    openMenu();
    app!.conn().feed(playerJoined(2, "Ben"));
    expect(panel().hidden).toBe(false);
    app!.conn().feed(roundEnded(1, NO_WORDS));
    expect(app!.root.querySelector("#screen h1")!.textContent).toBe(COPY.intermission.title);
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
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
    expect(panel().querySelector("h2")!.textContent).toBe(COPY.menu.skin);
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
    driveToRoundOne(app!);
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
    driveToRoundOne(app!);
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

describe("Menü entries (spec #194)", () => {
  function toggleFor(id: string): HTMLButtonElement {
    return panel().querySelector<HTMLButtonElement>(`.menu-toggle[aria-controls="${id}"]`)!;
  }

  function bodyFor(id: string): HTMLElement {
    return panel().querySelector<HTMLElement>(`#${id}`)!;
  }

  function versionNumber(version: string): number {
    const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
    return major * 10_000 + minor * 100 + patch;
  }

  it("keeps the version row's text and expands the changelog in place", () => {
    openMenu();
    const toggle = toggleFor("menu-changelog");
    expect(toggle).toBe(panel().querySelector(".menu-version"));
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.textContent).toBe(COPY.menu.version(APP_VERSION));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    const body = bodyFor("menu-changelog");
    expect(body.hidden).toBe(true);

    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body.hidden).toBe(false);

    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(body.hidden).toBe(true);
    // The row keeps its familiar plain text through the whole toggle.
    expect(toggle.textContent).toBe(COPY.menu.version(APP_VERSION));
  });

  it("ships exactly the 0.1.0 changelog entry and tags the running build", () => {
    expect(CHANGELOG).toHaveLength(1);
    expect(CHANGELOG[0]!.version).toBe("0.1.0");
    const ranks = CHANGELOG.map((entry) => versionNumber(entry.version));
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));

    openMenu();
    toggleFor("menu-changelog").click();
    const blocks = bodyFor("menu-changelog").querySelectorAll(".menu-changelog-entry");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.querySelector("h3")!.textContent).toContain(COPY.menu.version("0.1.0"));
    expect(blocks[0]!.querySelector(".menu-current")!.textContent).toBe(COPY.menu.current);
    expect(blocks[0]!.textContent).toContain(COPY.menu.changelog);
    expect(blocks[0]!.textContent).toContain(COPY.menu.rotate);
  });

  it("keeps the skin switcher working while the changelog is expanded", () => {
    openMenu();
    toggleFor("menu-changelog").click();
    const select = panel().querySelector<HTMLSelectElement>("#skin-select")!;
    select.value = "arcade";
    select.dispatchEvent(new Event("change"));

    expect(document.body.dataset.skin).toBe("arcade");
    expect(bodyFor("menu-changelog").hidden).toBe(false);
  });

  it("expands the Spielanleitung with the rules text and collapses it again", () => {
    openMenu();
    const toggle = toggleFor("menu-rules");
    expect(toggle.textContent).toBe(COPY.menu.rules);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(bodyFor("menu-rules").hidden).toBe(true);

    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const rules = bodyFor("menu-rules");
    expect(rules.hidden).toBe(false);
    expect(rules.textContent).toContain(COPY.menu.rulesIntro);
    expect(rules.textContent).toContain(COPY.menu.rulesUmlauts);
    expect(rules.textContent).toContain(COPY.menu.rulesNextRound);
    expect(rules.textContent).toContain(COPY.menu.rulesSpectator);
    expect(rules.textContent).toContain(COPY.menu.rulesTotal);

    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(rules.hidden).toBe(true);
  });

  it("names the word-list source and its policy in Quellen, with one outbound anchor", () => {
    openMenu();
    const toggle = toggleFor("menu-sources");
    expect(toggle.textContent).toBe(COPY.menu.sources);
    expect(bodyFor("menu-sources").hidden).toBe(true);

    toggle.click();
    const sources = bodyFor("menu-sources");
    expect(sources.hidden).toBe(false);
    expect(sources.textContent).toContain(COPY.menu.sourcesLicense);
    expect(sources.textContent).toContain(COPY.menu.sourcesExclusions);
    expect(sources.textContent).toContain(COPY.menu.sourcesWiktionary);

    const anchors = sources.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.getAttribute("href")).toBe("https://github.com/enz/german-wordlist");
    expect(anchors[0]!.getAttribute("target")).toBe("_blank");
    expect(anchors[0]!.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("links Problem melden to the issues list without closing the panel", () => {
    openMenu();
    const link = panel().querySelector<HTMLAnchorElement>(".menu-link")!;
    expect(link.textContent).toBe(COPY.menu.report);
    expect(link.getAttribute("href")).toBe("https://github.com/thom404/wortschatz/issues");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    link.click();
    expect(panel().hidden).toBe(false);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("lets disclosures coexist and closes the whole panel on all four paths while one is open", () => {
    openMenu();
    toggleFor("menu-changelog").click();
    toggleFor("menu-rules").click();
    toggleFor("menu-sources").click();
    for (const id of ["menu-changelog", "menu-rules", "menu-sources"]) {
      expect(bodyFor(id).hidden).toBe(false);
    }

    // Collapsing one leaves the others alone.
    toggleFor("menu-rules").click();
    expect(bodyFor("menu-rules").hidden).toBe(true);
    expect(bodyFor("menu-changelog").hidden).toBe(false);
    expect(bodyFor("menu-sources").hidden).toBe(false);

    // Trigger.
    trigger().click();
    expect(panel().hidden).toBe(true);

    // Esc.
    openMenu();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel().hidden).toBe(true);

    // Outside click.
    openMenu();
    app!.root.querySelector<HTMLElement>("#screen h1")!.click();
    expect(panel().hidden).toBe(true);

    // Screen change.
    driveToRoundOne(app!);
    openMenu();
    toggleFor("menu-rules").click();
    app!.conn().feed(roundEnded(1, NO_WORDS));
    expect(app!.root.querySelector("#screen h1")!.textContent).toBe(COPY.intermission.title);
    expect(panel().hidden).toBe(true);
  });

  it("makes every entry row a native button or link", () => {
    openMenu();
    const rows = panel().querySelectorAll<HTMLElement>(".menu-toggle, .menu-link");
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(["BUTTON", "A"]).toContain(row.tagName);
  });
});
