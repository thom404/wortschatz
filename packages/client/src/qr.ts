import { qrcodegen } from "./vendor/qrcodegen.js";

/**
 * The client's QR seam (#48): one module that turns a string — in byte mode,
 * as the wire would carry it — into a boolean module matrix, and into the
 * fixed-contrast SVG the lobby renders.
 *
 * The encoder itself is vendored, proven and permissively licensed (see
 * `vendor/qrcodegen.ts` and `docs/licences/nayuki-qrcodegen.md`); nothing here
 * re-implements error correction. The rendered core is deliberately outside the
 * skin token system: dark modules on a light card with the standard quiet zone,
 * so it stays scannable under every skin.
 */

/** The mandatory light border around a symbol, in modules (ISO/IEC 18004). */
export const QUIET_ZONE = 4;

/** Fixed-contrast core: literal colours, never skin tokens. */
const QR_DARK = "#000000";
const QR_LIGHT = "#ffffff";

/** A rendered QR symbol: the side length in modules (without the quiet zone)
 *  and the row-major dark/light grid (`true` is a dark module). */
export interface QrMatrix {
  readonly size: number;
  readonly modules: readonly (readonly boolean[])[];
}

/**
 * Encodes `text` in byte mode at the recommended error-correction level,
 * choosing the smallest symbol that fits, and returns its module matrix.
 * Deterministic for a given string.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = Array.from(new TextEncoder().encode(text));
  const symbol = qrcodegen.QrCode.encodeBinary(bytes, qrcodegen.QrCode.Ecc.MEDIUM);
  const modules: boolean[][] = [];
  for (let y = 0; y < symbol.size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < symbol.size; x++) row.push(symbol.getModule(x, y));
    modules.push(row);
  }
  return { size: symbol.size, modules };
}

/**
 * Renders `text` as an SVG QR card: a light `background` rect carrying the
 * quiet zone, and a single dark path of the symbol's modules. The payload is
 * also exposed on `data-payload` so the join target is inspectable (and
 * testable) without a camera. Colours are inline literals — skin tokens are
 * never referenced.
 */
export function qrSvg(text: string): string {
  const { size, modules } = encodeQr(text);
  const extent = size + QUIET_ZONE * 2;
  const segments: string[] = [];
  for (let y = 0; y < size; y++) {
    const row = modules[y]!;
    for (let x = 0; x < size; x++) {
      if (row[x]) segments.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`);
    }
  }
  return (
    `<svg id="qr" class="qr" width="200" height="200" viewBox="0 0 ${extent} ${extent}"` +
    ` role="img" aria-label="QR-Code zum Beitreten" data-payload="${escapeAttr(text)}">` +
    `<rect width="${extent}" height="${extent}" fill="${QR_LIGHT}"/>` +
    `<path d="${segments.join("")}" fill="${QR_DARK}" shape-rendering="crispEdges"/>` +
    `</svg>`
  );
}

/** Escapes the five attribute-significant characters for the `data-payload`
 *  attribute (the URL is normally plain, but the seam must not be injectable). */
function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}
