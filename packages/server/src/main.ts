/**
 * Production entrypoint: PORT (default 3000), SIGTERM/SIGINT → clean
 * room-ended close with code 1001, exit. Structured JSON logs go to stdout.
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./index.js";
import { PlaceholderDictionary, placeholderBoard, placeholderReveal, placeholderScore } from "./defaults.js";
import type { Logger } from "./config.js";

const logger: Logger = {
  info: (o) => console.log(JSON.stringify({ level: "info", ts: Date.now(), ...o })),
  warn: (o) => console.warn(JSON.stringify({ level: "warn", ts: Date.now(), ...o })),
  error: (o) => console.error(JSON.stringify({ level: "error", ts: Date.now(), ...o })),
};

const here = resolve(join(fileURLToPath(import.meta.url), "..", "..", ".."));
// Static SPA lives in the client build; overridable for container layouts.
const staticDir = process.env.WORDAMENT_STATIC_DIR ?? resolve(join(here, "client", "dist"));

const server = await startServer({
  port: Number(process.env.PORT ?? 3000),
  dictionary: new PlaceholderDictionary([]),
  generateBoard: placeholderBoard,
  scoreWord: placeholderScore,
  reveal: placeholderReveal,
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
