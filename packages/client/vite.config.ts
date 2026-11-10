import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { readAppVersion } from "./app-version.js";

/**
 * The precache set is exactly the production shell: the Home document, the
 * build's hashed script and style assets, the manifest and the four icons.
 * The vector source and the worker itself are deliberately absent.
 */
const PRECACHE_PATTERNS = [
  "index.html",
  "assets/*.js",
  "assets/*.css",
  "data/dawg.bin",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon.png",
];

export default defineConfig({
  plugins: [
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: false,
      manifest: false,
      devOptions: { enabled: false },
      injectManifest: {
        injectionPoint: "__WORT_SCHATZ_PRECACHE__",
        globPatterns: PRECACHE_PATTERNS,
        // The dictionary artifact is ~2.6 MB; the default 2 MiB cap would
        // silently drop it from the precache set (ADR-0031).
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        rollupFormat: "iife",
        minify: false,
      },
    }),
  ],
  server: {
    // Dev: Vite fronts the SPA and proxies the game server on :3000.
    proxy: {
      "/ws": { target: "ws://localhost:3000", ws: true },
      "/healthz": { target: "http://localhost:3000" },
    },
    port: 5173,
  },
  build: { outDir: "dist" },
  define: {
    global: "globalThis",
    __APP_VERSION__: JSON.stringify(readAppVersion()),
  },
});
