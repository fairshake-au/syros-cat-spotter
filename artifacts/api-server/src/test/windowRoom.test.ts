import { describe, expect, it } from "vitest";
import { waitForRoomInWindow } from "./windowRoom";

describe("waitForRoomInWindow", () => {
  const W = 15 * 60 * 1000;
  it("does not wait when the window has room", async () => {
    expect(await waitForRoomInWindow(W, 10_000, () => 5 * W + 60_000)).toBe(0);
  });
  it("waits out the rest of the window when a burst could straddle its turn-over", async () => {
    // 100 ms before the boundary: it waits those 100 ms plus 50 ms of margin.
    const waited = await waitForRoomInWindow(W, 10_000, () => 6 * W - 100);
    expect(waited).toBe(150);
  });
});
