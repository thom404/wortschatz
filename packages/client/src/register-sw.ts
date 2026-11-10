/**
 * Registers the one production service worker (ADR-0029). The dev server
 * registers none: `import.meta.env.PROD` is replaced by Vite, so this function
 * is a no-op outside a production build.
 *
 * The environment is injectable so the behavior tests can drive both branches
 * without a real browser service-worker container.
 */
export const SERVICE_WORKER_URL = "/sw.js";

export interface RegisterServiceWorkerEnvironment {
  production?: boolean;
  serviceWorker?: Pick<ServiceWorkerContainer, "register"> | null;
}

/** Registers `sw.js` once in production; returns `null` when it must not. */
export function registerServiceWorker(
  env: RegisterServiceWorkerEnvironment = {}
): Promise<ServiceWorkerRegistration> | null {
  const production = env.production ?? import.meta.env.PROD;
  if (!production) return null;
  const container =
    env.serviceWorker !== undefined
      ? env.serviceWorker
      : typeof navigator === "undefined"
        ? null
        : navigator.serviceWorker;
  if (!container) return null;
  return container.register(SERVICE_WORKER_URL);
}
