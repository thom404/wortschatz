import { RoomConnection } from "./api.js";
import { mount, type ConnFactory } from "./app.js";

/**
 * Production boot: the page-level wiring of the mountable app (#18). The
 * app lives in app.ts; this file chooses the DOM root and the connection
 * factory — here the real WebSocket-bound `RoomConnection`, unchanged.
 */

const connect: ConnFactory = ({ code, greet, listener, onStatus, onClose }) =>
  new RoomConnection(code, greet, listener, onStatus, onClose);

mount(document.getElementById("app")!, connect);
