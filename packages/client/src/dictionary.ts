/**
 * The browser's one dictionary loader (ADR-0031). The DAWG artifact is
 * generated from the pinned word list and reviewed exclusions at build time
 * and served at the stable same-origin path `/data/dawg.bin`. It is fetched
 * lazily on the first solo entry, deserialized once and kept for the app's
 * lifetime; the browser never reads the raw word list.
 */
import { Dictionary, deserializeDawg } from "@wortschatz/engine";

/** The stable public path of the generated dictionary artifact. */
export const DAWG_PATH = "/data/dawg.bin";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let cached: Dictionary | null = null;
let pending: Promise<Dictionary> | null = null;

/** Fetch and deserialize the artifact; concurrent callers share one load. */
export async function loadSoloDictionary(fetchImpl: FetchLike = fetch): Promise<Dictionary> {
  if (cached) return cached;
  if (pending) return pending;
  pending = (async () => {
    const response = await fetchImpl(DAWG_PATH, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Das Wörterbuch konnte nicht geladen werden (${response.status}).`);
    }
    const text = await response.text();
    const dictionary = new Dictionary(deserializeDawg(text));
    cached = dictionary;
    return dictionary;
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}

/** Test/boot seam: forget a previous successful load. */
export function resetSoloDictionary(): void {
  cached = null;
  pending = null;
}
