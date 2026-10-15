import { startServer, type ServerHandle } from "../src/index.js";
import {
  PlaceholderDictionary,
  placeholderReveal,
  placeholderScore,
  placeholderBoard,
} from "../src/defaults.js";
import { PROTOCOL, type ServerConfig } from "../src/index.js";
import type { TestClient } from "./test-client.js";
import { connect } from "./test-client.js";
import type { SnapshotMsg } from "@wordament/shared";

export const FAST_CLOCK: Partial<ServerConfig> = {
  roundMs: 1600,
  intermissionMs: 900,
  tickIntervalMs: 250,
  roomEmptyGraceMs: 60_000,
  roomIdleMs: 30 * 60_000,
};

export interface Scene {
  handle: ServerHandle;
  baseCfg: ServerConfig;
  makeClient(): Promise<TestClient>;
  stop(): Promise<void>;
}

export function wordDict(): PlaceholderDictionary {
  // Board: t e s t / w o r t / z z a a / b b c c  → "test" and "wort" pathable.
  return new PlaceholderDictionary(["test", "wort", "saat"]);
}

export function fixedBoard(): string[] {
  return ["t", "e", "s", "t", "w", "o", "r", "t", "z", "z", "a", "a", "b", "b", "c", "c"];
}

/** Fixed board + empty word list, the test twin of a real generated round. */
export function fixedGenerateBoard(): { board: string[]; words: string[] } {
  return { board: fixedBoard(), words: [] };
}

export async function makeScene(overrides: Partial<ServerConfig> = {}): Promise<Scene> {
  const baseCfg: ServerConfig = {
    port: 0,
    dictionary: wordDict(),
    generateBoard: fixedGenerateBoard,
    scoreWord: placeholderScore,
    reveal: placeholderReveal,
    log: { info() {}, warn() {}, error() {} },
    ...overrides,
  };
  const handle = await startServer(baseCfg);
  return {
    handle,
    baseCfg,
    makeClient: () => connect(handle.port),
    stop: () => handle.stop(),
  };
}

/** Create a room; returns the host client + snapshot. */
export async function createRoom(scene: Scene, nickname = "Hansi", reqId = 1) {
  const host = await scene.makeClient();
  host.send({ type: "create-room", nickname, reqId });
  const snap = (await host.expect((m) => m.type === "snapshot")) as unknown as SnapshotMsg;
  return { host, snap };
}

/** Join a second player into an existing room (snapshot returned). */
export async function joinPlayer(scene: Scene, code: string, nickname: string, reqId = 2) {
  const player = await scene.makeClient();
  player.send({ type: "join", code, nickname, reqId });
  const snap = (await player.expect((m) => m.type === "snapshot")) as unknown as SnapshotMsg;
  return { player, snap };
}

export function isSnapshot(m: { type: string }): m is unknown {
  return m.type === "snapshot";
}

export const fullCfg = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  port: 0,
  dictionary: wordDict(),
  generateBoard: placeholderBoard,
  scoreWord: placeholderScore,
  reveal: placeholderReveal,
  log: { info() {}, warn() {}, error() {} },
  ...over,
});

export const DEFAULT_PROT = PROTOCOL;
