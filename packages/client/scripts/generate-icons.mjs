#!/usr/bin/env node
/**
 * Generates the four committed PNG icons from the one committed vector
 * source, `public/icons/letter-mark.svg`.
 *
 * Run from the repository root:
 *
 *   npm run generate-icons
 *
 * The SVG is the source of truth for colour, glyph geometry and stroke
 * weight. This script rasterises it at the four manifest/Apple sizes, with
 * the maskable target scaled down so the glyph stays inside the standard
 * inner safe zone. It is deliberately dependency-free so the committed
 * rasters can be reproduced with any supported Node.js 22 install.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");
const sourcePath = join(publicDir, "icons", "letter-mark.svg");

const TARGETS = [
  { file: "icon-192.png", size: 192, scale: 1 },
  { file: "icon-512.png", size: 512, scale: 1 },
  { file: "icon-512-maskable.png", size: 512, scale: 0.8 },
  { file: "apple-touch-icon.png", size: 180, scale: 1 },
];

function attr(source, name) {
  const match = source.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match?.[1];
}

function parseHex(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value ?? "");
  if (!match) throw new Error(`Unsupported colour: ${value}`);
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function parsePath(d) {
  const tokens = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) throw new Error("The letter mark has no path data.");
  const points = [];
  let command = "";
  let x = 0;
  let y = 0;
  for (let i = 0; i < tokens.length;) {
    const token = tokens[i];
    if (/^[MLHVZmlhvz]$/.test(token)) {
      command = token;
      i++;
      if (/[Zz]/.test(command)) continue;
    }
    switch (command.toUpperCase()) {
      case "M":
      case "L": {
        x = Number(tokens[i++]);
        y = Number(tokens[i++]);
        points.push({ x, y });
        break;
      }
      case "H": {
        x = Number(tokens[i++]);
        points.push({ x, y });
        break;
      }
      case "V": {
        y = Number(tokens[i++]);
        points.push({ x, y });
        break;
      }
      default:
        throw new Error(`Unsupported path command: ${command}`);
    }
  }
  if (points.length < 2) throw new Error("The letter mark needs at least two points.");
  return points;
}

function distanceToSegment(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - a.x, py - a.y);
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lengthSquared));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function renderSvg(svg, size, scale) {
  const viewBox = (attr(svg, "viewBox") ?? "0 0 512 512").split(/\s+/).map(Number);
  if (viewBox.length !== 4) throw new Error("The letter mark needs a four-value viewBox.");
  const [minX, minY, boxWidth, boxHeight] = viewBox;
  const rect = svg.match(/<rect\b([^>]*)\/?>/i)?.[1] ?? "";
  const background = parseHex(attr(rect, "fill") ?? "#ffffff");
  const path = svg.match(/<path\b([^>]*)\/?>/i)?.[1] ?? "";
  const stroke = parseHex(attr(path, "stroke") ?? attr(path, "fill"));
  const strokeWidth = Number(attr(path, "stroke-width") ?? 0);
  if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) {
    throw new Error("The letter mark must be a stroked path with a positive stroke-width.");
  }
  const rawPoints = parsePath(attr(path, "d") ?? "");
  const centreX = minX + boxWidth / 2;
  const centreY = minY + boxHeight / 2;
  const points = rawPoints.map((point) => ({
    x: centreX + (point.x - centreX) * scale,
    y: centreY + (point.y - centreY) * scale,
  }));
  const halfWidth = (strokeWidth * scale) / 2;
  const samples = 4;
  const pixels = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = minX + ((px + (sx + 0.5) / samples) / size) * boxWidth;
          const y = minY + ((py + (sy + 0.5) / samples) / size) * boxHeight;
          let inside = false;
          for (let i = 1; i < points.length; i++) {
            if (distanceToSegment(x, y, points[i - 1], points[i]) <= halfWidth) {
              inside = true;
              break;
            }
          }
          if (inside) covered++;
        }
      }
      const alpha = covered / (samples * samples);
      const offset = (py * size + px) * 4;
      pixels[offset] = Math.round(background[0] + (stroke[0] - background[0]) * alpha);
      pixels[offset + 1] = Math.round(background[1] + (stroke[1] - background[1]) * alpha);
      pixels[offset + 2] = Math.round(background[2] + (stroke[2] - background[2]) * alpha);
      pixels[offset + 3] = 0xff;
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const svg = readFileSync(sourcePath, "utf8");
for (const target of TARGETS) {
  const pixels = renderSvg(svg, target.size, target.scale);
  writeFileSync(join(publicDir, "icons", target.file), encodePng(target.size, pixels));
  console.log(`icons/${target.file} (${target.size}×${target.size})`);
}
