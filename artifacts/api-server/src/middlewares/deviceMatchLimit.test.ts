import { describe, expect, it } from "vitest";
import {
  DEVICE_MATCH_LIMIT,
  DEVICE_MATCH_WINDOW_MS,
  checkDeviceMatchLimit,
  _resetDeviceMatchLimitForTests,
} from "./rateLimit";

// Data spine PR 5 (DECISIONS.md Part 2h): the pure window logic behind the
// per-device candidate-matching limit. The integration test in
// routes/sightings.matchHardening.test.ts proves it's wired up correctly on
// POST /sightings; this covers the counting itself in isolation, including
// the window boundary that would be slow to exercise over HTTP.
describe("checkDeviceMatchLimit", () => {
  it("allows exactly 20 requests from one device and refuses the 21st", () => {
    _resetDeviceMatchLimitForTests();
    const device = "device-a";
    for (let i = 0; i < DEVICE_MATCH_LIMIT; i++) {
      expect(checkDeviceMatchLimit(device)).toBe(true);
    }
    expect(checkDeviceMatchLimit(device)).toBe(false);
  });

  it("keeps a separate budget per device", () => {
    _resetDeviceMatchLimitForTests();
    const a = "device-b";
    const b = "device-c";
    for (let i = 0; i < DEVICE_MATCH_LIMIT; i++) {
      expect(checkDeviceMatchLimit(a)).toBe(true);
    }
    expect(checkDeviceMatchLimit(a)).toBe(false);
    // b has never been seen, so it has its own fresh budget.
    expect(checkDeviceMatchLimit(b)).toBe(true);
  });

  it("resets a device's budget once its window has elapsed", () => {
    _resetDeviceMatchLimitForTests();
    const device = "device-d";
    const t0 = 1_000_000;
    for (let i = 0; i < DEVICE_MATCH_LIMIT; i++) {
      expect(checkDeviceMatchLimit(device, t0)).toBe(true);
    }
    expect(checkDeviceMatchLimit(device, t0)).toBe(false);
    // One millisecond before the window ends: still refused.
    expect(checkDeviceMatchLimit(device, t0 + DEVICE_MATCH_WINDOW_MS - 1)).toBe(false);
    // The window has elapsed: a fresh budget starts.
    expect(checkDeviceMatchLimit(device, t0 + DEVICE_MATCH_WINDOW_MS)).toBe(true);
  });
});
