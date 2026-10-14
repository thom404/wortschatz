import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  test("healthz works without any static dir", async () => {
    const res = await fetch(`http://localhost:${scene.handle.port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
