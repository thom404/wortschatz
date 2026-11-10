/**
 * The install state of the app (ADR-0029, #257): whether the browser offers
 * its install prompt, the one request that opens it, whether Safari's manual
 * add-to-home-screen instructions apply, and whether the player already
 * installed or dismissed the card.
 *
 * This is the only client module that touches the browser's install APIs.
 * Screens read this state and call its commands; they never listen for the
 * browser events themselves. The Home card renders only from this state.
 *
 * The update half of the same module (a subscription to a waiting worker and
 * one command to apply it) lands with its own slice.
 */

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

/** Everything the module reads, injectable for the tests. */
export interface InstallStateOptions {
  target?: InstallEventTarget | null;
  navigator?: InstallNavigator | null;
  storage?: InstallStorage | null;
  /** Whether this window is already an installed app. Defaults to the
   *  browser's standalone signals. */
  installed?: boolean;
}

function defaultTarget(): InstallEventTarget | null {
  return typeof window === "undefined" ? null : window;
}

function defaultNavigator(): InstallNavigator | null {
  return typeof navigator === "undefined" ? null : navigator;
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
  private readonly listeners = new Set<() => void>();
  private readonly target: InstallEventTarget | null;
  private readonly nav: InstallNavigator | null;
  private readonly storage: InstallStorage | null;

  constructor(options: InstallStateOptions = {}) {
    this.target = options.target === undefined ? defaultTarget() : options.target;
    this.nav = options.navigator === undefined ? defaultNavigator() : options.navigator;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.installed = options.installed ?? this.readInstalled();
    this.dismissed = this.readDismissed();
    this.target?.addEventListener("beforeinstallprompt", this.onBeforeInstallPrompt);
    this.target?.addEventListener("appinstalled", this.onAppInstalled);
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
    this.target?.removeEventListener("beforeinstallprompt", this.onBeforeInstallPrompt);
    this.target?.removeEventListener("appinstalled", this.onAppInstalled);
    this.listeners.clear();
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

  private notify(): void {
    for (const listener of this.listeners) listener();
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
