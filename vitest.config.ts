import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/shared/tests/**/*.test.ts", "packages/server/tests/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    teardownTimeout: 10000,
  },
});
