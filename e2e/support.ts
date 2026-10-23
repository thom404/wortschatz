import { test as base, expect, type Page, type WebSocketRoute } from "@playwright/test";
import type { ClientMessage, GreetingMsg, ServerMessage } from "@wortschatz/shared";

/** The two skins in the registry (ADR-0002); kept local to the test tooling. */
export type SkinId = "standard" | "arcade";

/** The production client build is served here by `vite preview` (#156). */
export const BASE_URL = "http://127.0.0.1:4173";

/** Every screenshot runs on this frozen wall clock, so countdown digits and
 *  fixture deadlines cannot move between runs. Noon in Berlin. */
export const FIXED_NOW = Date.parse("2025-03-01T11:00:00.000Z");

export interface Viewport {
  width: number;
  height: number;
}

export const PHONE_SMALL: Viewport = { width: 360, height: 640 };
export const PHONE_LARGE: Viewport = { width: 390, height: 844 };
export const TABLET: Viewport = { width: 768, height: 1024 };
export const DESKTOP: Viewport = { width: 1280, height: 800 };

/** The curated matrix's four viewports (mobile stack, tablet and desktop
 *  two-column). The tablet row covers the 600–1024 px band the 860 px
 *  arrangement was previously invisible in (ADR-0020 amendment #175). */
export const VIEWPORTS: readonly Viewport[] = [PHONE_SMALL, PHONE_LARGE, TABLET, DESKTOP];

export const SKINS: readonly SkinId[] = ["standard", "arcade"];

export interface WireOptions {
  /** Messages replayed on the connection's first frame (create-room / join). */
  messages?: ServerMessage[] | ((greeting: GreetingMsg) => ServerMessage[]);
  /** Custom client→server handling for flow tests; supersedes `messages`. */
  onMessage?: (msg: ClientMessage, ws: WebSocketRoute) => void;
  /** Close the transport after the greeting has been answered. */
  closeAfterGreeting?: { code?: number; reason?: string; delayMs?: number };
}

export interface WireHarness {
  /** Everything the browser sent, in order. */
  received: ClientMessage[];
  /** Send one frame to the app after setup (e.g. a flow response). */
  send(msg: ServerMessage): void;
}

export function isGreeting(msg: ClientMessage): msg is GreetingMsg {
  return msg.type === "create-room" || msg.type === "join";
}

/** Drives the real WebSocket boundary: the client greets, the fixture answers,
 *  and every frame the client sends is captured for assertions. */
export async function routeWire(page: Page, opts: WireOptions = {}): Promise<WireHarness> {
  const received: ClientMessage[] = [];
  let socket: WebSocketRoute | null = null;

  await page.routeWebSocket("**/ws", (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw)) as ClientMessage;
      received.push(msg);
      if (opts.onMessage) {
        opts.onMessage(msg, ws);
        return;
      }
      if (!isGreeting(msg)) return;
      const messages = typeof opts.messages === "function" ? opts.messages(msg) : (opts.messages ?? []);
      for (const message of messages) ws.send(JSON.stringify(message));
      if (opts.closeAfterGreeting) {
        const { code = 1000, reason = "fixture-close", delayMs = 50 } = opts.closeAfterGreeting;
        setTimeout(() => ws.close({ code, reason }), delayMs);
      }
    });
  });

  return {
    received,
    send(msg) {
      if (!socket) throw new Error("no WebSocket route is open");
      socket.send(JSON.stringify(msg));
    },
  };
}

/** Opens the room through the split entry screens (ADR-0021), the app's
 *  normal connection trigger. Entering from Home clicks through the landing;
 *  a deep link already shows Join with its code pre-filled and read-only. */
export async function enterRoom(
  page: Page,
  opts: { mode?: "create" | "join"; code?: string; nickname?: string } = {}
): Promise<void> {
  const nickname = opts.nickname ?? (opts.mode === "join" ? "Jana" : "Lena");
  if (opts.mode === "join") {
    if ((await page.locator("#jn-code").count()) === 0) {
      await page.locator("#join-btn").click();
    }
    const code = page.locator("#jn-code");
    if (opts.code && (await code.isEditable())) await code.fill(opts.code);
    await page.locator("#jn-nick").fill(nickname);
    await page.locator("#jn-btn").click();
    return;
  }
  if ((await page.locator("#mk-nick").count()) === 0) {
    await page.locator("#create-btn").click();
  }
  await page.locator("#mk-nick").fill(nickname);
  await page.locator("#mk-btn").click();
}

/** Opens the app-owned Menü (ADR-0023): one trigger and an anchored panel
 *  outside every screen's markup. */
export async function openMenu(page: Page): Promise<void> {
  await page.locator("#menu-trigger").click();
  await expect(page.locator("#menu-panel")).toBeVisible();
}

export interface OpenOptions {
  viewport: Viewport;
  skin?: SkinId;
  /** Defaults to `/`; pass `/r/<code>` for a deep link. */
  path?: string;
  wire?: WireOptions;
}

/** Installs the fixed clock and optional skin before navigation, starts the
 *  wire fixture, then loads the production build. */
export async function openPage(page: Page, opts: OpenOptions): Promise<WireHarness> {
  await page.setViewportSize(opts.viewport);
  if (opts.skin) {
    const skin = opts.skin;
    await page.addInitScript((value) => {
      try {
        localStorage.setItem("wordament:skin", value);
      } catch {
        /* storage may be unavailable */
      }
    }, skin);
  }
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  const wire = await routeWire(page, opts.wire);
  await page.goto(opts.path ?? "/");
  return wire;
}

/**
 * Fails the test if the production bundle requests anything outside the
 * preview origin — an unexpected external dependency would make screenshots
 * internet-dependent (a stated determinism requirement of #156).
 */
export const test = base.extend<{ networkGuard: void }>({
  networkGuard: [
    async ({ page }, use) => {
      const unexpected: string[] = [];
      page.on("request", (request) => {
        const url = request.url();
        if (!isPreviewUrl(url)) unexpected.push(`${request.method()} ${url}`);
      });
      await use();
      expect(unexpected, "unexpected network requests").toEqual([]);
    },
    { auto: true },
  ],
});

function isPreviewUrl(url: string): boolean {
  return (
    /^https?:\/\/127\.0\.0\.1:4173(\/|$)/.test(url) ||
    /^wss?:\/\/127\.0\.0\.1:4173(\/|$)/.test(url) ||
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("about:")
  );
}

export { expect };
