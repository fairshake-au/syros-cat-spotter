import { defineConfig } from "vitest/config";

// The default 5 s test / 10 s hook limits are too tight for tests that create
// and migrate throwaway databases when several suites share one machine or CI
// runner; they failed at random with "timed out" (SYC-127, SYC-321, SYC-373).
// The same numbers api-server uses.
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
