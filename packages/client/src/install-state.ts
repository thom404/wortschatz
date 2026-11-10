/**
 * The install and update state of the app (ADR-0029, #257, #258): whether the
 * browser offers its install prompt, the one request that opens it, whether
 * Safari's manual add-to-home-screen instructions apply, whether the player
 * already installed or dismissed the card, and whether a new version is
 * waiting.
 *
 * This is the only client module that touches the browser's install and
 * service-worker APIs. Screens read this state and call its commands; they
 * never listen for the browser events themselves. The Home card renders only
 * from this state, and the app-owned update notice reads the update half.
 */

import { SKIP_WAITING_MESSAGE } from "./app-shell.js";

/** The one client key that keeps a dismissed install card away on later
 *  visits. It follows the guarded-storage pattern of the skin key. */
export const INSTALL_DISMISSED_KEY = "wordament:install-dismissed";

/** The browser's install prompt event, which lib.dom does not declare. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** The slice of `window` this module binds to. */
export interface InstallEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  matchMedia(query: string): MediaQueryList;
}

/** The slice of `navigator` this module reads. `standalone` is Safari's
 *  non-standard iOS flag; every other browser reports display mode instead. */
export interface InstallNavigator {
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
  readonly standalone?: boolean;
}

/** The guarded-storage slice: a denied or absent storage degrades silently. */
export interface InstallStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The slice of one service worker this module talks to: a waiting update
 *  receives the one take-over message. */
export interface UpdateWorker {
  readonly state?: ServiceWorkerState;
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

/** The slice of a service worker registration that exposes a waiting update. */
export interface UpdateRegistration {
  readonly waiting: UpdateWorker | null;
  readonly installing?: UpdateWorker | null;
  /** The worker currently controlling the app. A worker is only a *waiting*
   *  update beside one; the first install briefly passes through `installing`
   *  with no active worker and must not be announced as an update. */
  readonly active?: UpdateWorker | null;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

/** The container event that follows a take-over: the new worker now controls
 *  the page, so the one reload can happen safely. */
export interface UpdateContainer {
  readonly controller?: unknown;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

/** Everything the module reads, injectable for the tests. */
export interface InstallStateOptions {
  target?: InstallEventTarget | null;
  navigator?: InstallNavigator | null;
  storage?: InstallStorage | null;
  /** Whether this window is already an installed app. Defaults to the
   *  browser's standalone signals. */
  installed?: boolean;
  /** The registration that may have a waiting update, or the promise the
   *  production registration resolves to. */
  registration?: UpdateRegistration | Promise<UpdateRegistration | null> | null;
  /** The container whose `controllerchange` follows the take-over. */
  serviceWorker?: UpdateContainer | null;
  /** Applies the update; injectable so the tests never navigate. */
  reload?: () => void;
}

function defaultTarget(): InstallEventTarget | null {
  return typeof window === "undefined" ? null : window;
}

function defaultNavigator(): InstallNavigator | null {
  return typeof navigator === "undefined" ? null : navigator;
}

function defaultServiceWorker(): UpdateContainer | null {
  if (typeof navigator === "undefined") return null;
  return (navigator.serviceWorker as UpdateContainer | undefined) ?? null;
}

function defaultStorage(): InstallStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isIos(nav: InstallNavigator | null): boolean {
  if (!nav) return false;
  // iPadOS 13+ reports a desktop Mac user agent; its touch points are the
  // reliable signal beside the phone and iPod tokens.
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
}

export class InstallState {
  private prompt: BeforeInstallPromptEvent | null = null;
  private installed: boolean;
  private dismissed: boolean;
  private waiting: UpdateWorker | null = null;
  private applying = false;
  private reloaded = false;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly updateListeners = new Set<() => void>();
  private readonly target: InstallEventTarget | null;
  private readonly nav: InstallNavigator | null;
  private readonly storage: InstallStorage | null;
  private readonly serviceWorker: UpdateContainer | null;
  private readonly reload: () => void;
  private readonly registrations = new Set<UpdateRegistration>();
  private readonly updateWorkers = new Map<UpdateWorker, EventListener>();
  private watchedRegistration: UpdateRegistration | null = null;

  constructor(options: InstallStateOptions = {}) {
    this.target = options.target === undefined ? defaultTarget() : options.target;
    this.nav = options.navigator === undefined ? defaultNavigator() : options.navigator;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.serviceWorker = options.serviceWorker === undefined ? defaultServiceWorker() : options.serviceWorker;
    this.reload = options.reload ?? (() => location.reload());
    this.installed = options.installed ?? this.readInstalled();
    this.dismissed = this.readDismissed();
    this.target?.addEventListener("beforeinstallprompt", this.onBeforeInstallPrompt);
    this.target?.addEventListener("appinstalled", this.onAppInstalled);
    this.serviceWorker?.addEventListener("controllerchange", this.onControllerChange);
    this.watchRegistration(options.registration ?? null);
  }

  /** Whether `Installieren` can open a real browser prompt. */
  get canInstall(): boolean {
    return this.prompt !== null && !this.installed && !this.dismissed;
  }

  /** Whether Safari's manual instructions are the right affordance: an iOS
   *  window without a browser prompt, not installed and not dismissed. */
  get iosManual(): boolean {
    return isIos(this.nav) && this.prompt === null && !this.installed && !this.dismissed;
  }

  /** Whether Home should render the card at all. */
  get visible(): boolean {
    return this.canInstall || this.iosManual;
  }

  /** Whether a new version is waiting for the player's one command. */
  get updateAvailable(): boolean {
    return this.waiting !== null && !this.applying;
  }

  /** Notifies when "update available" changes. Returns its unsubscribe. */
  subscribeUpdate(listener: () => void): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  /** Applies the waiting update: the worker may take over, and the page
   *  reloads once it controls the app. The command is idempotent, so a second
   *  press cannot reload twice or raise a second prompt. */
  applyUpdate(): void {
    if (this.applying || !this.waiting) return;
    const waiting = this.waiting;
    this.applying = true;
    this.waiting = null;
    this.notifyUpdate();
    try {
      waiting.postMessage({ type: SKIP_WAITING_MESSAGE });
    } catch {
      /* A worker that vanished cannot take over; no reload is safe. */
      return;
    }
    if (!this.serviceWorker) this.reloadOnce();
  }

  /** Opens the browser's install prompt. The one prompt event can be used
   *  once, so it is consumed before the call; when it is gone, no action
   *  remains on the card. */
  async requestInstall(): Promise<void> {
    const prompt = this.prompt;
    if (!prompt) return;
    this.prompt = null;
    this.notify();
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") this.installed = true;
    } catch {
      /* The browser withdrew the prompt; the card already hides its action. */
    } finally {
      this.notify();
    }
  }

  /** Hides the card now and on later visits. */
  dismiss(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    try {
      this.storage?.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
      /* storage may be unavailable — the dismissal just won't persist */
    }
    this.notify();
  }

  /** Notifies on any visible install-state change. Returns its unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Removes the browser listeners; call once when the app unmounts. */
  dispose(): void {
    this.disposed = true;
    this.target?.removeEventListener("beforeinstallprompt", this.onBeforeInstallPrompt);
    this.target?.removeEventListener("appinstalled", this.onAppInstalled);
    this.serviceWorker?.removeEventListener("controllerchange", this.onControllerChange);
    for (const registration of this.registrations) {
      registration.removeEventListener("updatefound", this.onUpdateFound);
    }
    for (const [worker, listener] of this.updateWorkers) {
      worker.removeEventListener("statechange", listener);
    }
    this.registrations.clear();
    this.updateWorkers.clear();
    this.listeners.clear();
    this.updateListeners.clear();
  }

  private readonly onBeforeInstallPrompt = (event: Event): void => {
    event.preventDefault();
    this.prompt = event as BeforeInstallPromptEvent;
    this.notify();
  };

  private readonly onAppInstalled = (): void => {
    this.installed = true;
    this.prompt = null;
    this.notify();
  };

  private readonly onControllerChange = (): void => {
    // Only the update command reloads; a controller change from any other
    // lifecycle path must never navigate on its own.
    if (this.applying) this.reloadOnce();
  };

  private readonly onUpdateFound = (): void => {
    const registration = this.watchedRegistration;
    if (!registration) return;
    // A waiting worker may already be visible when `updatefound` arrives;
    // otherwise the installing worker crosses `installed` into waiting.
    this.adoptWaiting(registration);
    const installing = registration.installing;
    if (!installing || this.updateWorkers.has(installing)) return;
    const onStateChange: EventListener = () => {
      if (installing.state === "installed") this.adoptWaiting(registration);
    };
    this.updateWorkers.set(installing, onStateChange);
    installing.addEventListener("statechange", onStateChange);
  };

  private watchRegistration(
    registration: UpdateRegistration | Promise<UpdateRegistration | null> | null
  ): void {
    if (!registration) return;
    const attach = (resolved: UpdateRegistration | null): void => {
      if (!resolved || this.disposed) return;
      this.watchedRegistration = resolved;
      this.registrations.add(resolved);
      resolved.addEventListener("updatefound", this.onUpdateFound);
      this.adoptWaiting(resolved);
    };
    if (typeof (registration as Promise<UpdateRegistration | null>).then === "function") {
      void (registration as Promise<UpdateRegistration | null>).then(attach, () => {
        /* The registration failed; the app simply has no update to offer. */
      });
      return;
    }
    attach(registration as UpdateRegistration);
  }

  private adoptWaiting(registration: UpdateRegistration): void {
    if (this.applying || this.disposed) return;
    const waiting = registration.waiting;
    if (!waiting || waiting === this.waiting) return;
    // Only an additional worker beside an active one is a waiting update.
    // The very first install has no active worker; the browser promotes that
    // worker straight to active and no update exists to announce.
    if (!registration.active || registration.active === waiting) return;
    this.waiting = waiting;
    this.notifyUpdate();
  }

  private reloadOnce(): void {
    if (this.reloaded) return;
    this.reloaded = true;
    this.reload();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private notifyUpdate(): void {
    for (const listener of this.updateListeners) listener();
  }

  private readDismissed(): boolean {
    try {
      const stored = this.storage?.getItem(INSTALL_DISMISSED_KEY);
      return stored !== null && stored !== undefined;
    } catch {
      return false;
    }
  }

  private readInstalled(): boolean {
    if (this.nav?.standalone === true) return true;
    try {
      return this.target?.matchMedia("(display-mode: standalone)").matches ?? false;
    } catch {
      return false;
    }
  }
}
