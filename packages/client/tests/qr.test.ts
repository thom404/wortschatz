import { describe, expect, it } from "vitest";
import { encodeQr, qrSvg, QUIET_ZONE } from "../src/qr.js";

/**
 * QR encoder golden/vector test (#48). The encoder is vendored (Nayuki,
 * MIT); this pins its output for a fixed URL with no DOM dependency, so a
 * regression in the vendoring or the wrapper is caught, not silently shipped.
 *
 * The stored matrix was produced by the vendored encoder and independently
 * verified by decoding the drawn symbol (`#` dark, `.` light).
 */

const URL = "https://wortschatz.example/r/LAG4T";

const GOLDEN = [
  "#######..##.####.####.#######",
  "#.....#..###.####...#.#.....#",
  "#.###.#.#.####.#......#.###.#",
  "#.###.#.#..##.##.#....#.###.#",
  "#.###.#.##.#...##..##.#.###.#",
  "#.....#.#..##.....#...#.....#",
  "#######.#.#.#.#.#.#.#.#######",
  "........#.#.#.#.#.#..........",
  "#.#####....##....#.##.#####..",
  ".##....##.#.####.####.###...#",
  ".#..#.##.##.####....##..#....",
  "##.#........##.##.#.#.####.#.",
  "####..##.#....####.....#.##..",
  "####.#.....#...##.#######...#",
  "...##.#.##.....#.....#...##..",
  ".#.###.####...###..##.#.#..#.",
  ".#.##.#.###.#..#####...#.##..",
  "#.##....#.#..##..###.####.#.#",
  "#.#.#.#.##.#######...###..#..",
  "#..#.#...##..#..#..#.#.#...#.",
  "#..#.###.###..##.#.######.###",
  "........##.#...##..##...#####",
  "#######...###..######.#.###..",
  "#.....#.#...#.##..###...#..##",
  "#.###.#.#......#.##.#####.##.",
  "#.###.#.#..#.######......####",
  "#.###.#.##...#.#.#.#.#######.",
  "#.....#...#..#.##..###.#.#.#.",
  "#######.#...##.....#...####..",
];

function rows(matrix: readonly (readonly boolean[])[]): string[] {
  return matrix.map((row) => row.map((dark) => (dark ? "#" : ".")).join(""));
}

describe("QR encoder (#48)", () => {
  it("produces a known-good module matrix for a fixed URL", () => {
    const { size, modules } = encodeQr(URL);
    expect(size).toBe(29);
    expect(modules).toHaveLength(29);
    expect(modules.every((row) => row.length === 29)).toBe(true);
    expect(rows(modules)).toEqual(GOLDEN);
  });

  it("is deterministic, and a different deep link yields a different symbol", () => {
    expect(encodeQr(URL)).toEqual(encodeQr(URL));
    expect(encodeQr(URL)).not.toEqual(encodeQr("https://wortschatz.example/r/LAG4U"));
  });

  it("escapes an injection-shaped payload in the data-payload attribute", () => {
    const payload = 'https://wortschatz.example/r/X"<&Y';
    const svg = qrSvg(payload);
    expect(svg).toContain('data-payload="https://wortschatz.example/r/X&quot;&lt;&amp;Y"');
    expect(svg).not.toContain(`data-payload="${payload}"`);
  });

  it("renders a fixed dark-on-light SVG with the standard quiet zone and no skin tokens", () => {
    const svg = qrSvg(URL);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
    expect(svg).not.toContain("var(");
    expect(svg).toContain(`data-payload="${URL}"`);
    // The light background spans the symbol plus the quiet zone on all sides.
    const extent = 29 + QUIET_ZONE * 2;
    expect(svg).toContain(`viewBox="0 0 ${extent} ${extent}"`);
    expect(svg).toContain(`<rect width="${extent}" height="${extent}"`);
  });
});
