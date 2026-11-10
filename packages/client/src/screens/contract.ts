import type { GreetFn } from "../connection.js";
import type { InstallState } from "../install-state.js";
import type { GameDrag } from "../game-drag.js";
import type { GameStore } from "../store.js";
import type { ViewState } from "../view-state.js";

/**
 * The screen boundary (ADR-0030): a screen owns its template, ids, live
 * regions, wiring and identity, while the shell owns the mount root, the
 * connection, the timer, the route and the Menu. A screen is painted by the
 * shell into `#screen` and never sees those shell internals.
 */

/** One live, play-time-updatable region of a screen (ADR-0013). The shell
 *  walks the installed paint's declarations and skips any whose element the
 *  screen does not render. */
export interface LiveRegion {
  /** Selector of the element that anchors the region. */
  selector: string;
  /** Rewrites the region's element(s) in place from current state. */
  update(ctx: ScreenContext): void;
}

/** The narrow surface a screen may use. The connection, timer handle, store
 *  subscription, history state, Menu surface and `inRoom` are deliberately
 *  absent. */
export interface ScreenContext {
  /** The `#screen` container, never the mount root. */
  root: HTMLElement;
  store: GameStore;
  view: ViewState;
  roomCode: string;
  drag: GameDrag;
  /** The Home-only install state (ADR-0029, #257). It is app state beside the
   *  notices, not a shell internal: Home reads it and calls its commands. */
  install: InstallState;
  notices: {
    clearError(): void;
    setLocalError(message: string): void;
  };
  actions: {
    startRoom(nickname: string, greet: GreetFn): void;
    startRound(): void;
    leaveRoom(): void;
    exitToHome(): void;
    openCreate(): void;
    openJoin(): void;
    backToHome(): void;
  };
}

/** One declarative screen paint. The shell installs it; a screen never
 *  replaces the mount root and never touches the Menu. */
export interface ScreenPaint {
  title: string;
  menuKey: string;
  html: string;
  liveRegions: readonly LiveRegion[];
  wire(root: HTMLElement, ctx: ScreenContext): void;
  tick?(ctx: ScreenContext): void;
  lateLinks?(root: HTMLElement, ctx: ScreenContext): void;
  dispose?(): void;
}
