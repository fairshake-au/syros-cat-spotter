import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import {
  DEVICE_MATCH_LIMIT,
  DEVICE_MATCH_WINDOW_MS,
  checkDeviceMatchLimit,
  deviceMatchResetAt,
  _resetDeviceMatchLimitForTests,
} from "./rateLimit";

afterAll(async () => {
  await pool.end();
});

// Data spine PR 5 (DECISIONS.md Part 2h): the pure window logic behind the
// per-device candidate-matching limit. The integration test in
// routes/sightings.matchHardening.test.ts proves it's wired up correctly on
// POST /sightings; this covers the counting itself in isolation, including
// the window boundary that would be slow to exercise over HTTP.
describe("checkDeviceMatchLimit", () => {
  it("allows exactly 20 requests from one device and refuses the 21st", async () => {
    await _resetDeviceMatchLimitForTests();
    const device = "device-a";
    for (let i = 0; i < DEVICE_MATCH_LIMIT; i++) {
      expect(await checkDeviceMatchLimit(device)).toBe(true);
    }
    expect(await checkDeviceMatchLimit(device)).toBe(false);
  });

  it("keeps a separate budget per device", async () => {
    await _resetDeviceMatchLimitForTests();
    const a = "device-b";
    const b = "device-c";
    for (let i = 0; i < DEVICE_MATCH_LIMIT; i++) {
      expect(await checkDeviceMatchLimit(a)).toBe(true);
    }
    expect(await checkDeviceMatchLimit(a)).toBe(false);
    // b has never been seen, so it has its own fresh budget.
    expect(await checkDeviceMatchLimit(b)).toBe(true);
  });

  it("resets a device's budget once its window has elapsed", async () => {
    await _resetDeviceMatchLimitForTests();
    const device = "device-d";
    // Windows are aligned to the clock, so start exactly on one.
    const t0 = 4 * DEVICE_MATCH_WINDOW_MS;
    for (let i = 0; i < DEVICE_MATCH_LIMIT; i++) {
      expect(await checkDeviceMatchLimit(device, t0)).toBe(true);
    }
    expect(await checkDeviceMatchLimit(device, t0)).toBe(false);
    // One millisecond before the window ends: still refused.
    expect(await checkDeviceMatchLimit(device, t0 + DEVICE_MATCH_WINDOW_MS - 1)).toBe(false);
    // The window has elapsed: a fresh budget starts.
    expect(await checkDeviceMatchLimit(device, t0 + DEVICE_MATCH_WINDOW_MS)).toBe(true);
  });

  // Review of PR #64 (S3) wanted old windows dropped so nothing grows without
  // bound. The counts now live in Postgres and the mail drain sweeps them
  // (lib/limits.test.ts, T2-4).

  it("deviceMatchResetAt reports a device's current window end, for Retry-After", async () => {
    await _resetDeviceMatchLimitForTests();
    const device = "device-e";
    const t0 = 6 * DEVICE_MATCH_WINDOW_MS + 12_345;
    expect(await deviceMatchResetAt(device, t0)).toBeUndefined();
    await checkDeviceMatchLimit(device, t0);
    expect(await deviceMatchResetAt(device, t0)).toBe(7 * DEVICE_MATCH_WINDOW_MS);
  });
});
