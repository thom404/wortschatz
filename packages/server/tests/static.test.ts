import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cp, mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import {
  CONTENT_SECURITY_POLICY,
  ICON_CACHE_CONTROL,
  IMMUTABLE_CACHE_CONTROL,
  MANIFEST_CONTENT_TYPE,
  NO_CACHE_CONTROL,
  SERVICE_WORKER_KILL_SWITCH_ENV,
  SERVICE_WORKER_PATH,
} from "../src/index.js";
import { createRoom, FAST_CLOCK, makeScene, type Scene } from "./scene.js";

/** The committed public assets the Vite build copies to the origin root. */
const PUBLIC_DIR = fileURLToPath(new URL("../../client/public/", import.meta.url));

let scene: Scene;
beforeEach(async () => {
  scene = await makeScene(FAST_CLOCK);
});
afterEach(async () => {
  await scene.stop();
});

describe("static SPA serving", () => {
  test("serves index.html at /, /r/<code> deep links fall through to the SPA", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wordament-static-"));
    await writeFile(join(dir, "index.html"), "<html>wordament</html>");
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets", "app.js"), "export {}");

    const scene2 = await makeScene({ ...FAST_CLOCK, staticDir: dir });
    try {
      const base = `http://localhost:${scene2.handle.port}`;
      const root = await fetch(base);
      expect(root.status).toBe(200);
      expect(await root.text()).toContain("wordament");

      const deep = await fetch(`${base}/r/ABC12`);
      expect(deep.status).toBe(200);
      expect(await deep.text()).toContain("wordament");

      const asset = await fetch(`${base}/assets/app.js`);
      expect(asset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");

      const missing404OnlyForFiles = await fetch(`${base}/nope.txt`);
      expect(missing404OnlyForFiles.status).toBe(200); // SPA fallback for deep links
    } finally {
      await scene2.stop();
    }
    void scene;
  });

  // #24: minimal app-level CSP on every static response — self default,
  // same-origin connects, no third-party origins (spec #15 story 41).
  test("every static response carries the app-level CSP header", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wordament-static-"));
    await writeFile(join(dir, "index.html"), "<html>wordament</html>");
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets", "app.js"), "export {}");
    await writeFile(join(dir, "manifest.webmanifest"), "{}");
    await writeFile(join(dir, "sw.js"), "self.addEventListener('install', () => {});");
    await mkdir(join(dir, "icons"));
    await writeFile(join(dir, "icons", "icon-192.png"), "png");

    const scene2 = await makeScene({ ...FAST_CLOCK, staticDir: dir });
    try {
      const base = `http://localhost:${scene2.handle.port}`;

      for (const path of [
        "/",
        "/r/ABC12",
        "/assets/app.js",
        "/manifest.webmanifest",
        "/sw.js",
        "/icons/icon-192.png",
        "/nope.txt",
      ]) {
        const res = await fetch(new URL(path, base));
        expect(res.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
      }

      const missing = await fetch(`${base}/icons/missing.png`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    } finally {
      await scene2.stop();
    }
    void scene;
  });

  // #255: the installed app's identity is one manifest and four icons served
  // from the origin root, with the manifest content type.
  test("serves the manifest with its content type and leaves the root and deep links on Home", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wordament-static-"));
    await cp(PUBLIC_DIR, dir, { recursive: true });
    await writeFile(join(dir, "index.html"), "<html>home document</html>");

    const scene2 = await makeScene({ ...FAST_CLOCK, staticDir: dir });
    try {
      const base = `http://localhost:${scene2.handle.port}`;
      const manifest = await fetch(`${base}/manifest.webmanifest`);
      expect(manifest.status).toBe(200);
      expect(manifest.headers.get("content-type")).toBe(MANIFEST_CONTENT_TYPE);
      expect(await manifest.json()).toEqual({
        name: "Wortschatz",
        short_name: "Wortschatz",
        lang: "de",
        dir: "ltr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        theme_color: "#f4f7fb",
        background_color: "#f4f7fb",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          { src: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
        ],
      });

      for (const path of ["/", "/r/ABC12"]) {
        const home = await fetch(`${base}${path}`);
        expect(home.status).toBe(200);
        expect(home.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect(await home.text()).toContain("home document");
      }
    } finally {
      await scene2.stop();
    }
  });

  // #256: the worker, manifest and icons are the app's own files. A missing
  // one answers 404; the root and Deep link paths keep the Home fallback.
  test("answers 404 for a missing worker, manifest or icon and keeps the Home fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wordament-static-"));
    await writeFile(join(dir, "index.html"), "<html>home document</html>");
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets", "app.js"), "export {}");

    const scene2 = await makeScene({ ...FAST_CLOCK, staticDir: dir });
    try {
      const base = `http://localhost:${scene2.handle.port}`;
      for (const path of [
        SERVICE_WORKER_PATH,
        "/manifest.webmanifest",
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        "/icons/icon-512-maskable.png",
        "/icons/apple-touch-icon.png",
      ]) {
        const res = await fetch(`${base}${path}`);
        expect(res.status).toBe(404);
        expect(await res.text()).toBe("not found");
      }

      for (const path of ["/", "/r/ABC12"]) {
        const home = await fetch(`${base}${path}`);
        expect(home.status).toBe(200);
        expect(await home.text()).toContain("home document");
      }
    } finally {
      await scene2.stop();
    }
    void scene;
  });

  // #256: the shell entry points revalidate every time; content-hashed build
  // output is immutable for a year and icons expire after one week.
  test("sets the app shell cache policy on every static file group", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wordament-static-"));
    await cp(PUBLIC_DIR, dir, { recursive: true });
    await writeFile(join(dir, "index.html"), "<html>home document</html>");
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets", "app-abc123.js"), "export {}");
    await writeFile(join(dir, "assets", "app-def456.css"), "body {}");
    await writeFile(join(dir, "sw.js"), "self.addEventListener('install', () => {});");

    const scene2 = await makeScene({ ...FAST_CLOCK, staticDir: dir });
    try {
      const base = `http://localhost:${scene2.handle.port}`;
      const expected: [string, string][] = [
        ["/", NO_CACHE_CONTROL],
        ["/r/ABC12", NO_CACHE_CONTROL],
        ["/index.html", NO_CACHE_CONTROL],
        ["/sw.js", NO_CACHE_CONTROL],
        ["/manifest.webmanifest", NO_CACHE_CONTROL],
        ["/assets/app-abc123.js", IMMUTABLE_CACHE_CONTROL],
        ["/assets/app-def456.css", IMMUTABLE_CACHE_CONTROL],
        ["/icons/icon-192.png", ICON_CACHE_CONTROL],
        ["/icons/icon-512-maskable.png", ICON_CACHE_CONTROL],
      ];
      for (const [path, cacheControl] of expected) {
        const res = await fetch(`${base}${path}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe(cacheControl);
      }
    } finally {
      await scene2.stop();
    }
    void scene;
  });

  // #259: with the documented flag unset, the worker path is the real build
  // worker, byte for byte.
  test("serves the real build worker when the kill switch is off", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wordament-static-"));
    const realWorker = "self.addEventListener('install', () => {});";
    await writeFile(join(dir, "index.html"), "<html>home document</html>");
    await writeFile(join(dir, "sw.js"), realWorker);

    const scene2 = await makeScene({ ...FAST_CLOCK, staticDir: dir });
    try {
      const res = await fetch(`http://localhost:${scene2.handle.port}${SERVICE_WORKER_PATH}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(realWorker);
    } finally {
      await scene2.stop();
    }
    void scene;
  });

  // #259: one environment flag neutralises a bad worker without a browser
  // change. The worker path returns a worker that unregisters itself and
  // deletes all caches; every other static response stays untouched.
  test("serves a self-unregistering kill-switch worker when the flag is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wordament-static-"));
    const realWorker = "self.addEventListener('install', () => {});";
    await cp(PUBLIC_DIR, dir, { recursive: true });
    await writeFile(join(dir, "index.html"), "<html>home document</html>");
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets", "app.js"), "export {}");
    await writeFile(join(dir, "sw.js"), realWorker);

    vi.stubEnv(SERVICE_WORKER_KILL_SWITCH_ENV, "1");
    const scene2 = await makeScene({ ...FAST_CLOCK, staticDir: dir });
    try {
      const base = `http://localhost:${scene2.handle.port}`;
      const worker = await fetch(`${base}${SERVICE_WORKER_PATH}`);
      expect(worker.status).toBe(200);
      expect(worker.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(worker.headers.get("cache-control")).toBe(NO_CACHE_CONTROL);
      expect(worker.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
      const body = await worker.text();
      expect(body).not.toBe(realWorker);
      expect(body).toContain("self.skipWaiting()");
      expect(body).toContain("self.registration.unregister()");
      expect(body).toContain("caches.keys()");
      expect(body).toContain("caches.delete(");

      const unchanged = await Promise.all([
        fetch(`${base}/`),
        fetch(`${base}/r/ABC12`),
        fetch(`${base}/assets/app.js`),
        fetch(`${base}/manifest.webmanifest`),
        fetch(`${base}/icons/icon-192.png`),
      ]);
      expect(await unchanged[0]!.text()).toContain("home document");
      expect(await unchanged[1]!.text()).toContain("home document");
      expect(await unchanged[2]!.text()).toBe("export {}");
      expect(unchanged[3]!.headers.get("content-type")).toBe(MANIFEST_CONTENT_TYPE);
      expect(unchanged[4]!.headers.get("content-type")).toBe("image/png");
      for (const res of unchanged) expect(res.status).toBe(200);
    } finally {
      await scene2.stop();
      vi.unstubAllEnvs();
    }
    void scene;
  });

  // #255: four committed rasters exist at the manifest's sizes, and the
  // favicon request receives a real icon rather than the Home document.
  test("serves the four committed icons at their declared sizes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wordament-static-"));
    await cp(PUBLIC_DIR, dir, { recursive: true });
    await writeFile(join(dir, "index.html"), "<html>home document</html>");

    const scene2 = await makeScene({ ...FAST_CLOCK, staticDir: dir });
    try {
      const base = `http://localhost:${scene2.handle.port}`;
      const icons = [
        ["/icons/icon-192.png", 192],
        ["/icons/icon-512.png", 512],
        ["/icons/icon-512-maskable.png", 512],
        ["/icons/apple-touch-icon.png", 180],
      ] as const;
      for (const [path, size] of icons) {
        const res = await fetch(`${base}${path}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/png");
        const png = Buffer.from(await res.arrayBuffer());
        expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
        expect(png.readUInt32BE(16)).toBe(size);
        expect(png.readUInt32BE(20)).toBe(size);
        expect(png.includes("<html")).toBe(false);
      }
    } finally {
      await scene2.stop();
    }
  });

  // #255: the maskable glyph stays inside the standard inner safe zone, so
  // every platform mask still shows the letter mark.
  test("keeps the maskable glyph inside the inner safe zone", async () => {
    const png = await readFile(join(PUBLIC_DIR, "icons", "icon-512-maskable.png"));
    const decoded = decodeRgbaPng(png);
    const background = [0xf4, 0xf7, 0xfb];
    // The safe zone is the centred circle of diameter 80% of the icon. The
    // glyph must not reach the outer 10% band on any side.
    const inset = Math.round(decoded.size * 0.1);
    let paintedOutsideSafeZone = false;
    outer: for (let y = 0; y < decoded.size; y++) {
      for (let x = 0; x < decoded.size; x++) {
        if (x >= inset && x < decoded.size - inset && y >= inset && y < decoded.size - inset) continue;
        const offset = (y * decoded.size + x) * 4;
        if (
          decoded.pixels[offset] !== background[0] ||
          decoded.pixels[offset + 1] !== background[1] ||
          decoded.pixels[offset + 2] !== background[2]
        ) {
          paintedOutsideSafeZone = true;
          break outer;
        }
      }
    }
    expect(paintedOutsideSafeZone).toBe(false);
  });

  test("healthz works without any static dir", async () => {
    const res = await fetch(`http://localhost:${scene.handle.port}/healthz`);
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text())).toEqual({ ok: true, sha: null });
  });

  // #29: the deploy verifies the running container is the image of the exact
  // merge commit; /healthz answers with the sha baked into the image, so the
  // public URL reveals the deployed version, not just liveness.
  test("healthz reports the deployed git sha", async () => {
    vi.stubEnv("WORTSCHATZ_GIT_SHA", "c8d1a2b3e4f5");
    try {
      const res = await fetch(`http://localhost:${scene.handle.port}/healthz`);
      expect(res.status).toBe(200);
      expect(JSON.parse(await res.text())).toEqual({ ok: true, sha: "c8d1a2b3e4f5" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/** Decode the RGBA PNGs this repository's icon script emits: non-interlaced,
 *  8-bit RGBA with filter type 0 on each row. */
function decodeRgbaPng(png: Buffer): { size: number; pixels: Buffer } {
  const size = png.readUInt32BE(16);
  const idat: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rowLength = size * 4 + 1;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    expect(raw[y * rowLength]).toBe(0);
    raw.copy(pixels, y * size * 4, y * rowLength + 1, (y + 1) * rowLength);
  }
  return { size, pixels };
}
