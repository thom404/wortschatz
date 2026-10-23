import { defineConfig } from "vitest/config";
import { readAppVersion } from "./packages/client/app-version.js";

export default defineConfig({
  // The behavior-test counterpart of the client build's injection (#181):
  // both fill __APP_VERSION__ from the same reader.
  define: { __APP_VERSION__: JSON.stringify(readAppVersion()) },
  test: {
    include: [
      "packages/shared/tests/**/*.test.ts",
      "packages/server/tests/**/*.test.ts",
      "packages/client/tests/**/*.test.ts",
    ],
    testTimeout: 15000,
    hookTimeout: 15000,
    teardownTimeout: 10000,
  },
});
