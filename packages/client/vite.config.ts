import { defineConfig } from "vite";
import { readAppVersion } from "./app-version.js";

export default defineConfig({
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
