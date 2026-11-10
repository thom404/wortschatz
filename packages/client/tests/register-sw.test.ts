import { describe, expect, it, vi } from "vitest";
import { SERVICE_WORKER_URL, registerServiceWorker } from "../src/register-sw.js";

describe("service worker registration", () => {
  it("registers the one worker in a production build", async () => {
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn(async () => registration);

    const result = registerServiceWorker({ production: true, serviceWorker: { register } });

    await expect(result).resolves.toBe(registration);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL);
  });

  it("registers nothing in development", () => {
    const register = vi.fn(async () => ({}) as ServiceWorkerRegistration);

    expect(registerServiceWorker({ production: false, serviceWorker: { register } })).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("registers nothing when the browser has no service-worker container", () => {
    expect(registerServiceWorker({ production: true, serviceWorker: null })).toBeNull();
  });
});
