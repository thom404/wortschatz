import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTENT_SECURITY_POLICY } from "../src/index.js";
import { createRoom, FAST_CLOCK, makeScene, type Scene } from "./scene.js";

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

    const scene2 = await makeScene({ ...FAST_CLOCK, staticDir: dir });
    try {
      const base = `http://localhost:${scene2.handle.port}`;

      for (const path of ["/", "/r/ABC12", "/assets/app.js", "/nope.txt"]) {
        const res = await fetch(new URL(path, base));
        expect(res.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
      }
    } finally {
      await scene2.stop();
    }
    void scene;
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
