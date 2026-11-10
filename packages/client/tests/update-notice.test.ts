// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOARD,
  NO_WORDS,
  ROOM_CODE,
  click,
  driveScene,
  driveToRoundOne,
  intermissionSnapshot,
  mountHarness,
  roundEnded,
  type Mounted,
} from "./harness.js";
import { SKIP_WAITING_MESSAGE } from "../src/app-shell.js";
import type { UpdateContainer, UpdateRegistration, UpdateWorker } from "../src/install-state.js";

/**
 * The update notice (#258): a waiting service worker is announced outside the
 * screen markup, waits for a safe phase and applies through exactly one
 * reload. Assertions live on rendered DOM, boundary messages and storage —
 * never on module internals.
 */

const COPY = {
  text: "Neue Version verfügbar.",
  action: "Neu laden",
};

let app: Mounted | null = null;

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  app?.unmount();
  app = null;
  localStorage.clear();
});

interface EventListeners {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatch(type: string): void;
}

function eventListeners(): EventListeners {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set<EventListener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) listener(new Event(type));
    },
  };
}

interface FakeWorker extends UpdateWorker {
  state: ServiceWorkerState;
  readonly messages: unknown[];
  dispatch(type: string): void;
}

function fakeWorker(state: ServiceWorkerState = "installed"): FakeWorker {
  const target = eventListeners();
  const worker: FakeWorker = {
    state,
    messages: [],
    postMessage(message) {
      worker.messages.push(message);
    },
    addEventListener: target.addEventListener,
    removeEventListener: target.removeEventListener,
    dispatch: target.dispatch,
  };
  return worker;
}

interface FakeRegistration extends UpdateRegistration {
  waiting: UpdateWorker | null;
  installing: UpdateWorker | null;
  dispatch(type: string): void;
}

function fakeRegistration(waiting: UpdateWorker | null = null): FakeRegistration {
  const target = eventListeners();
  return {
    waiting,
    installing: null,
    addEventListener: target.addEventListener,
    removeEventListener: target.removeEventListener,
    dispatch: target.dispatch,
  };
}

interface FakeContainer extends UpdateContainer {
  dispatch(type: string): void;
}

function fakeContainer(): FakeContainer {
  const target = eventListeners();
  return {
    controller: {},
    addEventListener: target.addEventListener,
    removeEventListener: target.removeEventListener,
    dispatch: target.dispatch,
  };
}

function mountWithUpdate(
  options: {
    waiting?: UpdateWorker | null;
    registration?: FakeRegistration;
    container?: FakeContainer;
    reload?: () => void;
  } = {}
): {
  registration: FakeRegistration;
  container: FakeContainer;
  reload: ReturnType<typeof vi.fn>;
} {
  const registration = options.registration ?? fakeRegistration(options.waiting ?? fakeWorker());
  const container = options.container ?? fakeContainer();
  const reload = options.reload ?? vi.fn();
  app = mountHarness({ registration, serviceWorker: container, reload });
  return { registration, container, reload: reload as ReturnType<typeof vi.fn> };
}

function notice(): HTMLElement {
  return app!.root.querySelector<HTMLElement>("#update-notice")!;
}

function updateVisible(): boolean {
  return !notice().hidden;
}

function reloadButton(): HTMLButtonElement {
  return notice().querySelector<HTMLButtonElement>("#update-reload-btn")!;
}

describe("update notice (#258)", () => {
  it("announces a waiting worker on Home as one notice with one action", () => {
    mountWithUpdate();

    expect(updateVisible()).toBe(true);
    expect(notice().textContent).toContain(COPY.text);
    expect(reloadButton().textContent).toBe(COPY.action);
    expect(notice().querySelectorAll("button")).toHaveLength(1);
  });

  it("lives outside the screen markup beside the notification layer, not as a status slot", () => {
    mountWithUpdate();

    expect(app!.root.querySelector("#screen #update-notice")).toBeNull();
    expect(notice().parentElement?.id).toBe("notice-stack");
    expect(app!.root.querySelector("#notifications")?.parentElement).toBe(notice().parentElement);
    expect(notice().classList.contains("notice")).toBe(false);
    expect(notice().getAttribute("role")).toBeNull();
    expect(app!.root.querySelectorAll("#notifications .notice")).toHaveLength(2);
  });

  it("is absent while a Round is playing and appears when it ends, without reloading", () => {
    const { container, reload } = mountWithUpdate();

    driveToRoundOne(app!);
    expect(updateVisible()).toBe(false);

    app!.conn().feed(roundEnded(1, NO_WORDS));
    expect(updateVisible()).toBe(true);
    expect(reload).not.toHaveBeenCalled();

    // A controller change that was not asked for never navigates on its own.
    container.dispatch("controllerchange");
    expect(reload).not.toHaveBeenCalled();
  });

  it("suppresses an update found mid-Round until the Round ends", () => {
    const registration = fakeRegistration();
    mountWithUpdate({ registration });

    driveToRoundOne(app!);
    expect(updateVisible()).toBe(false);

    registration.waiting = fakeWorker();
    registration.dispatch("updatefound");
    expect(updateVisible()).toBe(false);

    app!.conn().feed(roundEnded(1, NO_WORDS));
    expect(updateVisible()).toBe(true);
  });

  it("shows again on Home after leaving a Room", () => {
    mountWithUpdate();
    driveToRoundOne(app!);
    expect(updateVisible()).toBe(false);

    app!.conn().feed({ type: "room-ended", reason: "host-closed" });
    click(app!.root, "#home-btn");
    expect(updateVisible()).toBe(true);
  });

  it("Neu laden applies the update once and never prompts a second time", () => {
    const waiting = fakeWorker();
    const { container, reload } = mountWithUpdate({ waiting });

    reloadButton().click();
    expect(waiting.messages).toEqual([{ type: SKIP_WAITING_MESSAGE }]);
    expect(updateVisible()).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    // The reload happens only once the waiting worker controls the app.
    container.dispatch("controllerchange");
    expect(reload).toHaveBeenCalledTimes(1);

    container.dispatch("controllerchange");
    reloadButton().click();
    expect(waiting.messages).toHaveLength(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the stored Skin and Session token through the reload", () => {
    localStorage.setItem("wordament:skin", "arcade");
    localStorage.setItem(
      "wordament:session:abc12",
      JSON.stringify({ token: "seat-token", nickname: "Lena", seatId: 1 })
    );

    const { container } = mountWithUpdate();
    expect(document.body.dataset.skin).toBe("arcade");

    reloadButton().click();
    container.dispatch("controllerchange");

    expect(localStorage.getItem("wordament:skin")).toBe("arcade");
    expect(JSON.parse(localStorage.getItem("wordament:session:abc12")!)).toEqual({
      token: "seat-token",
      nickname: "Lena",
      seatId: 1,
    });
  });

  it("shows the notice for a join that lands directly in the intermission", () => {
    mountWithUpdate();
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
    expect(updateVisible()).toBe(true);
  });
});
