/**
 * German Wiktionary lookup — the app's first outbound network dependency.
 *
 * Given exact word forms from a finished round's reveal, resolve each one to
 * its absolute `de.wiktionary.org` entry. Matching is deliberately literal:
 * the first character is uppercased, the title is sent to MediaWiki's
 * `action=query` with redirects followed, and only a real, non-disambiguation
 * page becomes a link. There is no search, lemma lookup or inflection
 * stripping — a wrong link is worse than no link.
 *
 * The HTTP request is injected so the module's own tests never touch the
 * network. Anything that goes wrong (timeout, rate limit, malformed body)
 * resolves to an empty result: no icons this round, the reveal unchanged.
 * See ADR-0017.
 */
import type { WikiLookup } from "./config.js";

const API_URL = "https://de.wiktionary.org/w/api.php";
const ARTICLE_URL = "https://de.wiktionary.org/wiki/";
const DEFAULT_USER_AGENT = "wortschatz/0.1 (+https://github.com/thom404/wortschatz)";
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_BUDGET_MS = 800;
const DEFAULT_NEGATIVE_TTL_MS = 60_000;
const DEFAULT_BATCH_DELAY_MS = 100;

/** The slice of `Response` this module reads. */
export interface WikiResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

/** The module's own HTTP seam: a fetch-shaped function. */
export type WikiRequest = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<WikiResponse>;

export interface WiktionaryLookupOptions {
  /** Defaults to the global `fetch`. */
  request?: WikiRequest;
  /** Clock seam for cache expiry and Retry-After; defaults to `Date.now`. */
  now?: () => number;
  /** Whole-lookup request budget (all batches), in ms. */
  budgetMs?: number;
  /** How long a missing/disambiguation/failed word is remembered. */
  negativeTtlMs?: number;
  /** MediaWiki's anonymous title limit for one query. */
  batchSize?: number;
  /** Politeness pause between batches, in ms. */
  batchDelayMs?: number;
  userAgent?: string;
}

interface CacheEntry {
  url: string | null;
  expiresAt: number;
}

interface ApiPage {
  title?: unknown;
  missing?: unknown;
  invalid?: unknown;
  pageprops?: { disambiguation?: unknown };
}

interface ApiBody {
  query?: {
    redirects?: { from?: unknown; to?: unknown }[];
    pages?: ApiPage[];
  };
}

/** Build the one lookup collaborator the server config receives. */
export function createWiktionaryLookup(options: WiktionaryLookupOptions = {}): WikiLookup {
  const request: WikiRequest =
    options.request ?? ((url, init) => fetch(url, { headers: init.headers, signal: init.signal }));
  const now = options.now ?? Date.now;
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const batchDelayMs = options.batchDelayMs ?? DEFAULT_BATCH_DELAY_MS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  /** Process-lifetime cache: no database exists, a cold cache costs one
   *  batch request per round. */
  const cache = new Map<string, CacheEntry>();
  /** A 429 asks us to stay away until this moment. */
  let retryAfterUntil = 0;

  const remember = (word: string, url: string | null, expiresAt: number): void => {
    cache.set(word, { url, expiresAt });
  };

  const rememberNegative = (words: readonly string[], ttl: number): void => {
    const expiresAt = now() + ttl;
    for (const word of words) remember(word, null, expiresAt);
  };

  return async (words) => {
    const unique = [...new Set(words)];
    if (unique.length === 0) return new Map<string, string>();

    const result = new Map<string, string>();
    const pending: string[] = [];
    const current = now();
    for (const word of unique) {
      const hit = cache.get(word);
      if (hit && hit.expiresAt > current) {
        if (hit.url) result.set(word, hit.url);
      } else {
        if (hit) cache.delete(word);
        pending.push(word);
      }
    }
    if (pending.length === 0) return result;
    if (now() < retryAfterUntil) return result;

    const deadline = now() + budgetMs;
    const batches = chunk(pending, batchSize);
    for (let i = 0; i < batches.length; i++) {
      if (i > 0 && batchDelayMs > 0) {
        await sleep(Math.min(batchDelayMs, Math.max(0, deadline - now())));
      }
      const remaining = deadline - now();
      if (remaining <= 0) {
        rememberNegative(pending.slice(i * batchSize), negativeTtlMs);
        break;
      }

      const batch = batches[i]!;
      const byTitle = new Map<string, string[]>();
      for (const word of batch) {
        const title = titleFor(word);
        const list = byTitle.get(title);
        if (list) list.push(word);
        else byTitle.set(title, [word]);
      }

      let response: WikiResponse;
      try {
        response = await requestWithBudget(request, apiUrl([...byTitle.keys()]), userAgent, remaining);
      } catch {
        rememberNegative(pending.slice(i * batchSize), negativeTtlMs);
        break;
      }

      if (response.status === 429) {
        const retryMs = parseRetryAfter(response.headers.get("retry-after"), now());
        retryAfterUntil = now() + retryMs;
        rememberNegative(pending.slice(i * batchSize), Math.max(negativeTtlMs, retryMs));
        break;
      }
      if (!response.ok) {
        rememberNegative(pending.slice(i * batchSize), negativeTtlMs);
        break;
      }

      let body: ApiBody;
      try {
        const parsed: unknown = await response.json();
        if (!isObject(parsed)) throw new Error("malformed");
        body = parsed as ApiBody;
      } catch {
        rememberNegative(pending.slice(i * batchSize), negativeTtlMs);
        break;
      }

      let resolved: Map<string, string>;
      try {
        resolved = resolveBatch(body, byTitle);
      } catch {
        rememberNegative(pending.slice(i * batchSize), negativeTtlMs);
        break;
      }
      for (const [title, url] of resolved) {
        for (const word of byTitle.get(title) ?? []) {
          result.set(word, url);
          remember(word, url, Number.POSITIVE_INFINITY);
        }
      }
      for (const title of byTitle.keys()) {
        if (resolved.has(title)) continue;
        for (const word of byTitle.get(title) ?? []) {
          remember(word, null, now() + negativeTtlMs);
        }
      }
    }
    return result;
  };
}

function titleFor(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function apiUrl(titles: readonly string[]): string {
  const url = new URL(API_URL);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("redirects", "1");
  url.searchParams.set("prop", "pageprops|info");
  url.searchParams.set("ppprop", "disambiguation");
  url.searchParams.set("titles", titles.join("|"));
  return url.toString();
}

/** Map requested titles to their canonical article URL, excluding missing,
 *  invalid and disambiguation pages and following redirect chains. */
function resolveBatch(body: ApiBody, byTitle: Map<string, string[]>): Map<string, string> {
  const redirects = new Map<string, string>();
  const redirectList = Array.isArray(body.query?.redirects) ? body.query.redirects : [];
  for (const r of redirectList) {
    if (isObject(r) && typeof r.from === "string" && typeof r.to === "string") {
      redirects.set(r.from, r.to);
    }
  }
  const pages = new Map<string, ApiPage>();
  const pageList = Array.isArray(body.query?.pages) ? body.query.pages : [];
  for (const page of pageList) {
    if (isObject(page) && typeof page.title === "string") pages.set(page.title, page as ApiPage);
  }

  const out = new Map<string, string>();
  for (const requested of byTitle.keys()) {
    let title = requested;
    const seen = new Set<string>();
    while (redirects.has(title) && !seen.has(title)) {
      seen.add(title);
      title = redirects.get(title)!;
    }
    const page = pages.get(title);
    if (!page || page.missing !== undefined || page.invalid !== undefined) continue;
    if (page.pageprops?.disambiguation !== undefined) continue;
    out.set(requested, ARTICLE_URL + encodeURIComponent(title).replace(/%20/g, "_"));
  }
  return out;
}

/** One request bounded by the lookup's remaining budget, aborting the real
 *  fetch on timeout. */
async function requestWithBudget(
  request: WikiRequest,
  url: string,
  userAgent: string,
  ms: number
): Promise<WikiResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("lookup timeout"));
    }, ms);
  });
  try {
    return await Promise.race([
      request(url, {
        headers: { "user-agent": userAgent, accept: "application/json" },
        signal: controller.signal,
      }),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function parseRetryAfter(header: string | null, nowMs: number): number {
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : 0;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
