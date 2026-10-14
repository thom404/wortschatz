import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { resolveConfig, type ServerConfig } from "./config.js";
import { Rooms } from "./rooms.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

/**
 * One Node process serves the static SPA and `GET /ws` on the same port.
 * Room codes travel inside the first WebSocket message, never the URL path;
 * `/r/<code>` deep links fall through to the SPA.
 */
export class WordamentServer {
  readonly config;
  private httpServer: Server;
  private wss: WebSocketServer;
  private rooms: Rooms;
  private shuttingDown = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private stopRef: (() => Promise<void>) | null = null;

  constructor(cfg: ServerConfig) {
    this.config = resolveConfig(cfg);
    this.rooms = new Rooms(this.config);

    this.httpServer = createServer((req, res) => {
      void this.handleHttp(req, res);
    });

    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    this.httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket as never, head, (ws) => {
        this.rooms.attach(ws);
      });
    });
  }

  async start(): Promise<{ port: number; stop(): Promise<void> }> {
    await new Promise<void>((resolveOnce, reject) => {
      this.httpServer.once("error", reject);
      const { host, port } = this.config;
      if (host !== undefined) {
        this.httpServer.listen(port, host, resolveOnce);
      } else {
        this.httpServer.listen(port, resolveOnce);
      }
    });
    const addr = this.httpServer.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : this.config.port;
    this.pingInterval = setInterval(() => this.rooms.pingAll(), this.config.pingIntervalMs);
    this.pingInterval.unref?.();
    this.stopRef = () => this.shutdown(1001, "server-shutdown");
    return { port, stop: () => this.stopRef?.() ?? Promise.resolve() };
  }

  /** SIGTERM path in production: stop timers, room-ended, close 1001, exit. */
  async shutdown(closeCode: number = 1001, reason: string = "server-shutdown"): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.rooms.teardownAll(reason);
    for (const ws of this.wss.clients) {
      try {
        ws.close(closeCode, reason);
      } catch {
        try {
          ws.terminate();
        } catch {
          /* gone */
        }
      }
    }
    try {
      await new Promise<void>((resolveOnce) => this.wss.close(() => resolveOnce()));
    } catch {
      /* best effort */
    }
    try {
      await new Promise<void>((resolveOnce) => this.httpServer.close(() => resolveOnce()));
    } catch {
      /* best effort */
    }
    void closeCode;
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    const dir = this.config.staticDir;
    if (!dir) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    try {
      const body = await this.serveStatic(dir, url.pathname);
      res.writeHead(200, { "content-type": MIME[extname(body.path)] ?? "application/octet-stream" });
      res.end(body.content);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  }

  private async serveStatic(dir: string, pathname: string): Promise<{ path: string; content: Buffer }> {
    const root = resolve(dir);
    let rel = pathname === "/" ? "/index.html" : pathname;
    if (rel.startsWith("/r/") || rel === "/r") rel = "/index.html";
    const candidate = normalize(join(root, rel));
    if (!candidate.startsWith(root)) throw new Error("path traversal");
    try {
      const s = await stat(candidate);
      if (s.isFile()) return { path: candidate, content: await readFile(candidate) };
      throw new Error("not a file");
    } catch {
      // SPA fallback: any unmatched path renders the app (deep links).
      const index = join(root, "index.html");
      return { path: index, content: await readFile(index) };
    }
  }
}
