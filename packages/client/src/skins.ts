import { escapeHtml } from "./escape.js";

/**
 * The skin registry (ADR-0002, #23): a skin is one CSS custom-property
 * token block in style.css plus one entry here — no component code path
 * branches on a skin. Standard (light) is the first-visitor default;
 * the choice renders as `data-skin` on the root element (`body`, the
 * token scope the design consumes from) and persists in localStorage,
 * so returning players find the app set up for them.
 */
export const SKINS = [
  {
    id: "standard",
    label: "Standard (hell)",
    /** The page background token in style.css, used as the manifest and
     *  theme-colour fallback when no stylesheet is available (tests). */
    pageBackground: "#f4f7fb",
  },
  {
    id: "arcade",
    label: "Arcade (dunkel)",
    pageBackground: "#0b0f1c",
  },
] as const;

export type SkinId = (typeof SKINS)[number]["id"];

const DEFAULT_SKIN: SkinId = "standard";
const STORAGE_KEY = "wordament:skin";

function isSkin(id: string | null | undefined): id is SkinId {
  return SKINS.some((s) => s.id === id);
}

/** The skin of this visit: the stored choice when it names a real skin
 *  (a misplaced value degrades to the default), Standard otherwise. */
export function loadSkin(): SkinId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isSkin(raw) ? raw : DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

/** The page background of a Skin (ADR-0002): read from its CSS token when a
 *  stylesheet is present, otherwise from the registry entry (the DOM test
 *  environment loads no stylesheet). */
export function pageBackground(id: SkinId): string {
  try {
    const token = getComputedStyle(document.body).getPropertyValue("--surface").trim();
    if (token) return token;
  } catch {
    /* no layout engine — fall through to the registry value */
  }
  return SKINS.find((s) => s.id === id)?.pageBackground ?? SKINS[0]!.pageBackground;
}

/** Mirrors the active Skin's page background into the document's theme
 *  colour, so an installed window's status bar agrees with the page on boot
 *  and after every Skin change (the manifest carries the Standard value). */
function applyThemeColor(id: SkinId): void {
  let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.append(meta);
  }
  meta.setAttribute("content", pageBackground(id));
}

/** Applies the choice to the whole app: the root attribute carries it
 *  into every screen's tokens; storage persists it across visits. */
export function applySkin(id: SkinId): void {
  document.body.dataset.skin = id;
  applyThemeColor(id);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage may be unavailable — the choice just won't persist */
  }
}

/** The home-screen switcher: one control over the registry, rendered
 *  with the live choice selected. */
export function skinSwitcherHtml(current: SkinId): string {
  return `
    <section class="panel">
      <h2>Skin</h2>
      <select id="skin-select">${SKINS.map(
        (s) =>
          `<option value="${escapeHtml(s.id)}"${s.id === current ? " selected" : ""}>${escapeHtml(s.label)}</option>`
      ).join("")}</select>
    </section>`;
}

/** Wires the rendered switcher: a selection applies app-wide at once. */
export function wireSkinSwitcher(root: HTMLElement): void {
  const select = root.querySelector<HTMLSelectElement>("#skin-select");
  if (!select) return;
  select.onchange = () => {
    if (isSkin(select.value)) applySkin(select.value);
  };
}
