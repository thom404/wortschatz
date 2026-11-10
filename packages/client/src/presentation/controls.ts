import { escapeHtml } from "../escape.js";
import { leaveIcon } from "../icons.js";

/** The shared control vocabulary: the icon-only button (ADR-0022), the
 *  in-room leave control and the field reader the two entry forms share. */

/** The one German string of the leave control, used for both its accessible
 *  name and its tooltip, so the two can never drift (ADR-0022). */
const LEAVE_LABEL = "Raum verlassen";

/** One icon-only control: the glyph is hidden from assistive technology,
 *  the `aria-label` carries the name, and `data-tip` is the same string for
 *  the CSS-only tooltip. There is deliberately no `aria-describedby`. */
export function iconButtonHtml(opts: {
  id?: string;
  className: string;
  icon: string;
  label: string;
  data?: string;
  pressed?: boolean;
}): string {
  const id = opts.id ? ` id="${opts.id}"` : "";
  const data = opts.data ? ` ${opts.data}` : "";
  const pressed = opts.pressed === undefined ? "" : ` aria-pressed="${opts.pressed}"`;
  return `<button type="button"${id} class="${opts.className}" aria-label="${escapeHtml(opts.label)}" data-tip="${escapeHtml(opts.label)}"${data}${pressed}>${opts.icon}</button>`;
}

export function leaveButtonHtml(): string {
  return iconButtonHtml({
    id: "leave-btn",
    className: "icon-btn leave-btn",
    icon: leaveIcon,
    label: LEAVE_LABEL,
  });
}

/** Reads one trimmed form field from the screen's current DOM. Create and
 *  Join share it so both forms read their values the same way. */
export function readField(root: HTMLElement, id: string): string {
  const el = root.querySelector<HTMLInputElement>(`#${id}`);
  return el ? el.value.trim() : "";
}
