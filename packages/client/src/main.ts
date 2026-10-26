import { RoomConnection } from "./websocket.js";
import { mount } from "./app.js";
import type { ConnFactory } from "./connection.js";

/**
 * Production boot: the page-level wiring of the mountable app (#18). The
 * app lives in app.ts; this file chooses the DOM root and the connection
 * factory — here the real WebSocket-bound `RoomConnection`, unchanged.
 */

const connect: ConnFactory = ({ greet, listener, onStatus, onClose }) =>
  new RoomConnection({ greet, listener, onStatus, onClose });

mount(document.getElementById("app")!, connect);
