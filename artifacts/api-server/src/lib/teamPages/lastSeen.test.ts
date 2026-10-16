import { describe, expect, it } from "vitest";
import { lastSeenWords } from "./lastSeen";

// SYC-396 PR 1.3 review fix: one wording rule for "last seen", in Athens time.

const NOW = new Date("2026-10-15T12:00:00Z");

describe("lastSeenWords", () => {
  it("says how long ago, under 30 days", () => {
    expect(lastSeenWords(new Date("2026-10-12T12:00:00Z"), NOW)).toBe("Last seen 3 days ago");
    expect(lastSeenWords(new Date("2026-10-15T09:00:00Z"), NOW)).toBe("Last seen 3 hours ago");
  });

  it("gives the date from 30 days on", () => {
    expect(lastSeenWords(new Date("2026-09-12T10:00:00Z"), NOW)).toBe("Last seen on 12 Sept 2026");
  });

  it("uses Athens time: just after midnight there is still the day before in UTC", () => {
    // 00:30 on 1 Sept in Athens (UTC+3) is 21:30 on 31 Aug in UTC.
    expect(lastSeenWords(new Date("2026-08-31T21:30:00Z"), NOW)).toBe("Last seen on 1 Sept 2026");
  });

  it("with no date, says it was never seen since first recorded", () => {
    expect(lastSeenWords(null, NOW)).toBe("Never seen since first recorded");
  });
});
