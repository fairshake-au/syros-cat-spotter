import { describe, expect, it, vi } from "vitest";

// Every call gets the same "random" letters, so only the counter can keep tags apart.
vi.mock("node:crypto", () => ({ randomBytes: () => Buffer.alloc(6) }));

import { nameTag } from "./nameTag";

describe("nameTag", () => {
  it("gives different tags to calls in the same millisecond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T10:00:00Z"));
    const tags = Array.from({ length: 300 }, () => nameTag());
    vi.useRealTimers();
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("is lower-case letters only", () => {
    expect(nameTag()).toMatch(/^[a-z]+$/);
  });
});
