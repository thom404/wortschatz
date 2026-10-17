/**
 * Production entrypoint: PORT (default 3000), SIGTERM/SIGINT → clean
 * room-ended close with code 1001, exit. Structured JSON logs go to stdout.
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./index.js";
import { loadDictionary } from "./dictionary/loader.js";
import { generateBoard } from "./boardgen/index.js";
import { germanScore } from "./scoring/index.js";
import { revealAll } from "./reveal.js";
import type { Logger } from "./config.js";

const logger: Logger = {
  info: (o) => console.log(JSON.stringify({ level: "info", ts: Date.now(), ...o })),
  warn: (o) => console.warn(JSON.stringify({ level: "warn", ts: Date.now(), ...o })),
  error: (o) => console.error(JSON.stringify({ level: "error", ts: Date.now(), ...o })),
};

const here = resolve(join(fileURLToPath(import.meta.url), "..", "..", ".."));
// Static SPA lives in the client build; overridable for container layouts.
const staticDir = process.env.WORTSCHATZ_STATIC_DIR ?? resolve(join(here, "client", "dist"));

// Artifact-first load; outside Docker this falls back to building the DAWG
// from the committed raw list (structured warning from the loader).
const { dictionary, fellBack } = await loadDictionary({ log: logger });
if (!fellBack) logger.info({ event: "dawg-loaded" });

const server = await startServer({
  port: Number(process.env.PORT ?? 3000),
  dictionary,
  generateBoard: (seed) => generateBoard(seed, dictionary),
  scoreWord: germanScore,
  reveal: revealAll,
  staticDir,
});

logger.info({ event: "server-start", port: server.port });

const shutdown = (signal: string) => {
  logger.info({ event: "shutdown", signal });
  void server
    .stop()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
