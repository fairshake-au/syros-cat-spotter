import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lastSeenWords, notSeenWords } from "./lastSeen";

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

describe("notSeenWords (SYC-485): worded from the one number, so the filter and Home's hint follow it", () => {
  it("today's six weeks", () => expect(notSeenWords()).toBe("6 weeks or more"));
  it("whole weeks read as weeks", () => {
    expect(notSeenWords(7)).toBe("1 week or more");
    expect(notSeenWords(56)).toBe("8 weeks or more");
  });
  it("anything else reads as days, never a wrong number of weeks", () => {
    expect(notSeenWords(45)).toBe("45 days or more");
    expect(notSeenWords(10)).toBe("10 days or more");
  });
});

describe("no page words the 'not seen lately' number by hand (SYC-485, SYC-442)", () => {
  it.each(["homePage.ts", "catGridPage.ts"])("%s takes it from notSeenWords()", (file) => {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    expect(src).toContain("notSeenWords()");
    expect(src, "a hand-typed number of weeks goes stale when Syros Cats change it").not.toMatch(/\d+ (weeks?|days) or more/);
  });
});
