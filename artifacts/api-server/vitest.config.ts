import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // DB-backed tests share tables; run files serially.
    fileParallelism: false,
    testTimeout: 20000,
    // SYC-111: creates/migrates/drops the throwaway database the whole run
    // uses (see globalSetup.ts). Generous — SYC-127 saw a sibling
    // throwaway-database hook flake at the default 10s on a slow CI runner.
    globalSetup: ["./src/test/globalSetup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    hookTimeout: 30000,
  },
});
