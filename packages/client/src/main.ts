import { RoomConnection } from "./websocket.js";
import { mount, type SoloFactory } from "./app.js";
import { registerServiceWorker } from "./register-sw.js";
import type { ConnFactory } from "./connection.js";
import { loadSoloDictionary } from "./dictionary.js";
import { SoloConnection } from "./solo.js";

/**
 * Production boot: the page-level wiring of the mountable app (#18). The
 * app lives in app.ts; this file chooses the DOM root, the real WebSocket
 * connection factory, the local solo factory and registers the offline App
 * shell once (ADR-0029, ADR-0031).
 */

const connect: ConnFactory = ({ greet, listener, onStatus, onClose }) =>
  new RoomConnection({ greet, listener, onStatus, onClose });

/** Lazily fetch and deserialize the one dictionary artifact, then hand the
 *  shell the local authority's connection factory (ADR-0031). */
const solo: SoloFactory = async () => {
  const dictionary = await loadSoloDictionary();
  return (opts) => new SoloConnection({ ...opts, dictionary });
};

const registration = registerServiceWorker();
mount(document.getElementById("app")!, connect, { registration }, solo);
