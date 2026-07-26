import { describe, it, expect } from "vitest";
import { streakFromDays, todayInStreakTimezone } from "./streak";

describe("streakFromDays", () => {
  it("returns 0 with no spotting days", () => {
    expect(streakFromDays([], "2026-07-26")).toBe(0);
  });

  it("counts a single spot today as a 1-day streak", () => {
    expect(streakFromDays(["2026-07-26"], "2026-07-26")).toBe(1);
  });

  it("counts consecutive days ending today", () => {
    const days = ["2026-07-26", "2026-07-25", "2026-07-24", "2026-07-23"];
    expect(streakFromDays(days, "2026-07-26")).toBe(4);
  });

  // The grace-day rule: you haven't spotted yet *today*, but yesterday still counts.
  // Getting this wrong resets every user's streak each midnight.
  it("keeps the streak alive when the most recent spot was yesterday", () => {
    const days = ["2026-07-25", "2026-07-24", "2026-07-23"];
    expect(streakFromDays(days, "2026-07-26")).toBe(3);
  });

  it("breaks the streak when the most recent spot was two days ago", () => {
    const days = ["2026-07-24", "2026-07-23", "2026-07-22"];
    expect(streakFromDays(days, "2026-07-26")).toBe(0);
  });

  it("stops counting at the first gap", () => {
    // 26, 25, then a missing 24 — the 23/22 run must not be included.
    const days = ["2026-07-26", "2026-07-25", "2026-07-23", "2026-07-22"];
    expect(streakFromDays(days, "2026-07-26")).toBe(2);
  });

  it("counts across a month boundary", () => {
    const days = ["2026-08-01", "2026-07-31", "2026-07-30"];
    expect(streakFromDays(days, "2026-08-01")).toBe(3);
  });

  it("counts across a year boundary", () => {
    const days = ["2027-01-01", "2026-12-31", "2026-12-30"];
    expect(streakFromDays(days, "2027-01-01")).toBe(3);
  });

  it("counts across a leap day", () => {
    const days = ["2028-03-01", "2028-02-29", "2028-02-28"];
    expect(streakFromDays(days, "2028-03-01")).toBe(3);
  });

  // Days are bucketed in Europe/Athens, which observes DST. A naive
  // local-midnight subtraction makes the 23h/25h transition days off by one.
  it("counts across the spring DST transition (23-hour day)", () => {
    const days = ["2026-03-30", "2026-03-29", "2026-03-28"];
    expect(streakFromDays(days, "2026-03-30")).toBe(3);
  });

  it("counts across the autumn DST transition (25-hour day)", () => {
    const days = ["2026-10-26", "2026-10-25", "2026-10-24"];
    expect(streakFromDays(days, "2026-10-26")).toBe(3);
  });

  it("ignores duplicate days rather than double-counting them", () => {
    const days = ["2026-07-26", "2026-07-26", "2026-07-25"];
    expect(streakFromDays(days, "2026-07-26")).toBe(2);
  });

  it("returns 0 for days in the future", () => {
    expect(streakFromDays(["2026-07-28"], "2026-07-26")).toBe(0);
  });
});

describe("todayInStreakTimezone", () => {
  it("formats as YYYY-MM-DD", () => {
    expect(todayInStreakTimezone()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("buckets a late-evening Athens spot on the local day, not the UTC one", () => {
    // 2026-07-26T22:30Z is 2026-07-27 01:30 in Athens (UTC+3 in summer).
    const lateEvening = new Date("2026-07-26T22:30:00Z");
    expect(todayInStreakTimezone(lateEvening)).toBe("2026-07-27");
  });
});
