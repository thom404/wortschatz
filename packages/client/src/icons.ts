/**
 * The hand-authored icon vocabulary for icon-only controls (ADR-0022).
 *
 * Every glyph is one inline SVG string: a 24×24 viewBox, no fill, a
 * `currentColor` stroke and `aria-hidden`, so the surrounding control owns
 * the accessible name and the icon follows the skin tokens. There is no
 * icon dependency, which keeps the production bundle and the visual seam's
 * network guard (ADR-0020 §8) untouched.
 */

const ICON_ATTRS = `class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"`;

function icon(body: string): string {
  return `<svg ${ICON_ATTRS}>${body}</svg>`;
}

/** Circular arrow: one press turns the board a quarter clockwise. */
export const rotateIcon = icon(`<path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v5h-5" />`);

/** Descending lines: sort by word length. */
export const sortLengthIcon = icon(`<path d="M4 6h16" /><path d="M4 12h11" /><path d="M4 18h6" />`);

/** Star: sort by points. */
export const sortPointsIcon = icon(
  `<path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9Z" />`
);

/** A–Z: sort alphabetically. */
export const sortAlphabetIcon = icon(
  `<path d="M3 18 7 6l4 12" /><path d="M4.4 14h5.2" /><path d="M14 6h7l-7 12h7" />`
);

/** Left arrow: leave the room. */
export const leaveIcon = icon(`<path d="M19 12H5" /><path d="m11 6-6 6 6 6" />`);

/** House: the outcome screens' one action, shown beside its visible text. */
export const homeIcon = icon(`<path d="m3 11 9-8 9 8" /><path d="M6 10v10h12V10" />`);
