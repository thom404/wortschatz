import { menuIcon } from "./icons.js";
import { loadSkin, skinSwitcherHtml, wireSkinSwitcher } from "./skins.js";
import { APP_VERSION } from "./version.js";

/**
 * The app-owned Menü (ADR-0023): one icon-only trigger and an anchored panel
 * outside every screen's markup, beside the notification layer. It carries
 * only app-global entries — the version row and the skin switcher — and never
 * pauses a running round.
 *
 * The surface is created once per mount; screen rebuilds cannot remove it or
 * its wiring. Closing on Esc, an outside click and a screen change returns
 * focus to the trigger. While closed, only the 44 px trigger is interactive:
 * the container is transparent to pointer input and the panel is hidden.
 */
export const MENU_LABEL = "Menü";

/** The surface markup, included once by the mount shell. */
export function menuHtml(): string {
  return `
    <div id="menu" class="menu">
      <button id="menu-trigger" class="icon-btn menu-trigger" type="button" aria-label="${MENU_LABEL}" data-tip="${MENU_LABEL}" aria-haspopup="dialog" aria-controls="menu-panel" aria-expanded="false">${menuIcon}</button>
      <div id="menu-panel" class="menu-panel" role="dialog" aria-label="${MENU_LABEL}" tabindex="-1" hidden>
        <p class="menu-version">Version ${escapeHtml(APP_VERSION)}</p>
        ${skinSwitcherHtml(loadSkin())}
      </div>
    </div>`;
}

/** The mounted surface: its one open state, the close paths and the
 *  screen-transition hook. */
export interface MenuSurface {
  readonly element: HTMLElement;
  readonly trigger: HTMLButtonElement;
  readonly panel: HTMLElement;
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
  /** Closes the panel when the rendered screen identity changes; a rebuild
   *  of the same screen leaves an open panel alone. */
  screenChanged(key: string): void;
  dispose(): void;
}

export function wireMenu(root: HTMLElement): MenuSurface {
  const element = root.querySelector<HTMLElement>("#menu")!;
  const trigger = root.querySelector<HTMLButtonElement>("#menu-trigger")!;
  const panel = root.querySelector<HTMLElement>("#menu-panel")!;
  let open = false;
  let screenKey: string | null = null;

  const openMenu = () => {
    if (open) return;
    open = true;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    panel.focus();
  };

  const closeMenu = () => {
    if (!open) return;
    open = false;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus();
  };

  const toggle = () => {
    if (open) closeMenu();
    else openMenu();
  };

  const onClick = (ev: MouseEvent) => {
    if (open && !element.contains(ev.target as Node | null)) closeMenu();
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (!open || ev.key !== "Escape") return;
    ev.preventDefault();
    closeMenu();
  };

  trigger.addEventListener("click", toggle);
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeyDown);
  wireSkinSwitcher(panel);

  return {
    element,
    trigger,
    panel,
    isOpen: () => open,
    open: openMenu,
    close: closeMenu,
    toggle,
    screenChanged(key) {
      if (key === screenKey) return;
      screenKey = key;
      closeMenu();
    },
    dispose() {
      trigger.removeEventListener("click", toggle);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}
