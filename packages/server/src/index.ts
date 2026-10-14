/**
 * The server package's in-process ABI: `startServer` runs the whole game in
 * the current process and returns a stoppable handle, so integration tests
 * connect real WebSocket clients with no socket mocks anywhere.
 */
import type { ServerConfig } from "./config.js";
import { WordamentServer } from "./server.js";

export interface ServerHandle {
  /** The port actually bound (pass 0 to get an ephemeral one). */
  port: number;
  /**
   * Graceful stop: stops timers, broadcasts room-ended, closes sockets with
   * code 1001 (the SIGTERM path — `main.ts` wires the signal to this).
   */
  stop(): Promise<void>;
}

export async function startServer(cfg: ServerConfig): Promise<ServerHandle> {
  const server = new WordamentServer(cfg);
  return server.start();
}

export type { ServerConfig } from "./config.js";
export { resolveConfig, type ServerConfigResolved } from "./config.js";
export { normalizeCode, normalizeWord } from "./rooms.js";
export { PROTOCOL } from "@wordament/shared";
