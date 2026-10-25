import { escapeHtml } from "./escape.js";
import { menuIcon } from "./icons.js";
import { loadSkin, skinSwitcherHtml, wireSkinSwitcher } from "./skins.js";
import { APP_VERSION } from "./version.js";

/**
 * The app-owned Menü (ADR-0023): one icon-only trigger and an anchored panel
 * outside every screen's markup, beside the notification layer. It carries
 * only app-global entries — the version/changelog disclosure, Spielanleitung,
 * Quellen, Problem melden and the skin switcher — and never pauses a running
 * round.
 *
 * The surface is created once per mount; screen rebuilds cannot remove it or
 * its wiring. Closing on Esc, an outside click and a screen change returns
 * focus to the trigger. While closed, only the 44 px trigger is interactive:
 * the container is transparent to pointer input and the panel is hidden.
 */
export const MENU_LABEL = "Menü";

/** One hand-written German changelog block (ADR-0007: inline copy, no
 *  markdown, no i18n, no fetch). The list is authored newest first; a version
 *  bump and its entry land in the same pull request (ADR-0023 amendment). */
export interface ChangelogEntry {
  readonly version: string;
  readonly notes: readonly string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: "0.1.0",
    notes: [
      "Das Menü: Skin wechseln und Version ansehen, auf jedem Bildschirm.",
      "Im Reveal Wörter bei Wiktionary nachschlagen.",
      "Räume erstellen und beitreten; Einladung per Link oder QR-Code.",
      "Das Spielfeld lässt sich in 90°-Schritten drehen.",
    ],
  },
];

/** The rules text (ADR-0007): hardcoded German, grounded in the glossary's
 *  board, gesture, valid-word, round and spectator facts. */
const RULES_HTML = `
  <p>So spielst du:</p>
  <ul>
    <li>Erstelle einen Raum oder tritt mit einem Raumcode bei. Über den Link oder den QR-Code landen andere direkt im Raum. Ein Raum fasst bis 8 Spieler.</li>
    <li>Auf dem 4×4-Spielfeld suchst du Wörter: Wische über Felder, die waagerecht, senkrecht oder diagonal angrenzen. Jedes Feld zählt höchstens einmal pro Wort.</li>
    <li>Ein Wort zählt ab drei Buchstaben. Ä, ö, ü und ß gelten als echte Buchstaben. Es zählt, was in der Wortliste steht.</li>
    <li>Jede Runde dauert 2 Minuten; die Zeit läuft für alle gleich. Ein Wort bringt so viele Punkte, wie die Zahlen an seinen Feldern zusammen ergeben.</li>
    <li>Nach der Runde kommt die Pause mit dem Reveal: alle Wörter, die zu finden waren, und die Punkte. Der Gastgeber startet die nächste Runde.</li>
    <li>Trittst du mitten in einer Runde bei: Du schaust zu. Ab der nächsten Runde bist du dabei.</li>
    <li>Am Ende zählt das Gesamtergebnis der Sitzung.</li>
  </ul>`;

/** The word-list source, its licence and the two reviewed policies (ADR-0001
 *  amendment, ADR-0017). The pinned commit SHA is deliberately not player
 *  copy. */
const SOURCES_HTML = `
  <ul>
    <li><strong>Wortliste</strong> Die gültigen Wörter kommen aus der freien Wortliste <a href="https://github.com/enz/german-wordlist" target="_blank" rel="noopener noreferrer">enz/german-wordlist</a> (CC0-1.0). Der Link führt zu ihrem Ursprung.</li>
    <li><strong>Ausschlussliste</strong> Eine kurze, per Hand gepflegte Ausschlussliste entfernt Formen, die kaum Deutsch sind: Eigennamen, Ortsnamen und Abkürzungen, die die Spielliste mitliefert.</li>
    <li><strong>Wiktionary</strong> Im Reveal verlinken gefundene Wörter zu ihren deutschen Einträgen bei Wiktionary.</li>
  </ul>`;

const ISSUES_URL = "https://github.com/thom404/wortschatz/issues";

/** The surface markup, included once by the mount shell. */
export function menuHtml(): string {
  return `
    <div id="menu" class="menu">
      <button id="menu-trigger" class="icon-btn menu-trigger" type="button" aria-label="${MENU_LABEL}" data-tip="${MENU_LABEL}" aria-haspopup="dialog" aria-controls="menu-panel" aria-expanded="false">${menuIcon}</button>
      <div id="menu-panel" class="menu-panel" role="dialog" aria-label="${MENU_LABEL}" tabindex="-1" hidden>
        ${disclosureHtml({
          id: "menu-changelog",
          labelHtml: `Version ${escapeHtml(APP_VERSION)}`,
          toggleClass: "menu-version",
          bodyHtml: changelogHtml(),
        })}
        ${disclosureHtml({ id: "menu-rules", label: "Spielanleitung", bodyHtml: RULES_HTML })}
        ${disclosureHtml({ id: "menu-sources", label: "Quellen", bodyHtml: SOURCES_HTML })}
        <a class="menu-link" href="${ISSUES_URL}" target="_blank" rel="noopener noreferrer">Problem melden</a>
        ${skinSwitcherHtml(loadSkin())}
      </div>
    </div>`;
}

/** One disclosure row: a native button toggling the panel beneath it in
 *  place. The version row reuses the pattern with its familiar text. */
function disclosureHtml(opts: {
  id: string;
  label?: string;
  labelHtml?: string;
  toggleClass?: string;
  bodyHtml: string;
}): string {
  const label = opts.labelHtml ?? escapeHtml(opts.label ?? "");
  const toggleClass = opts.toggleClass ? ` ${opts.toggleClass}` : "";
  return `
    <div class="menu-entry">
      <button type="button" class="menu-toggle${toggleClass}" aria-expanded="false" aria-controls="${opts.id}">${label}</button>
      <div id="${opts.id}" class="menu-disclosure" hidden>${opts.bodyHtml}</div>
    </div>`;
}

/** The changelog blocks, newest first; the running build's block carries
 *  the quiet `aktuell` tag. */
function changelogHtml(): string {
  return CHANGELOG.map((entry) => {
    const current = entry.version === APP_VERSION ? ` <span class="menu-current">aktuell</span>` : "";
    return `
      <article class="menu-changelog-entry">
        <h3>Version ${escapeHtml(entry.version)}${current}</h3>
        <ul>${entry.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
      </article>`;
  }).join("");
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
  wireDisclosures(panel);
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

/**
 * Wires every disclosure toggle: a plain in-place expand/collapse of its
 * controlled panel, announced by `aria-expanded`. The toggles are native
 * buttons, so Enter/Space operate them; disclosures are independent and the
 * panel itself owns the scrolling.
 */
function wireDisclosures(panel: HTMLElement): void {
  for (const toggle of panel.querySelectorAll<HTMLButtonElement>(".menu-toggle")) {
    const id = toggle.getAttribute("aria-controls");
    const body = id ? panel.querySelector<HTMLElement>(`#${id}`) : null;
    if (!body) continue;
    toggle.onclick = () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      body.hidden = expanded;
    };
  }
}
