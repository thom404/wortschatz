// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { click, mountHarness, typeInto, type Mounted } from "./harness.js";

const OFFLINE = "Du bist offline.";

let app: Mounted | null = null;

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
}

function statusText(): string {
  return app!.root.querySelector<HTMLElement>("#notice-status")?.textContent ?? "";
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
  setOnline(true);
  app = mountHarness();
});

afterEach(() => {
  app?.unmount();
  app = null;
  setOnline(true);
});

describe("offline line in the notification layer", () => {
  it("shows Du bist offline. on Home and refreshes on the network events", () => {
    setOnline(false);
    app!.unmount();
    app = mountHarness();

    expect(statusText()).toBe(OFFLINE);
    const surfaces = [...app!.root.querySelectorAll("*")].filter(
      (el) => el.textContent === OFFLINE && el.children.length === 0
    );
    expect(surfaces).toHaveLength(1);

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    expect(statusText()).toBe("");
  });

  it("puts the offline line ahead of connecting and retrying, then restores the connection status", () => {
    setOnline(false);
    window.dispatchEvent(new Event("offline"));
    typeInto(app!.root, "#mk-nick", "Lena");
    click(app!.root, "#mk-btn");

    expect(statusText()).toBe(OFFLINE);

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    expect(statusText()).toBe("Verbinde …");

    app!.conn().retry();
    expect(statusText()).toBe("Verbindung wird wiederhergestellt …");

    setOnline(false);
    window.dispatchEvent(new Event("offline"));
    expect(statusText()).toBe(OFFLINE);

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    expect(statusText()).toBe("Verbindung wird wiederhergestellt …");
  });
});
