import { describe, expect, it } from "vitest";
import { athensMidnight, isShort, monthsIn, parseRange, rangeQuery, weeksIn } from "./range";

// SYC-396 PR 3.3a, Task 3.3a.1: a report's time range, on the Syros calendar.

const now = new Date("2026-10-18T13:40:00Z"); // 16:40 on Syros

describe("parseRange", () => {
  it("gives the last 3 months for junk", () => {
    for (const q of [undefined, null, {}, { range: "decade" }, { range: ["month"] }, "range=month"]) {
      const r = parseRange(q, now);
      expect(r.key).toBe("3months");
      expect(r.label).toBe("Last 3 months");
      expect(r.from!.toISOString()).toBe("2026-07-17T21:00:00.000Z"); // midnight 18 Jul on Syros
      expect(r.to).toBe(now);
    }
  });

  it("this month, this year and all time start on Syros midnights and end now", () => {
    expect(parseRange({ range: "month" }, now).from!.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(parseRange({ range: "year" }, now).from!.toISOString()).toBe("2025-12-31T22:00:00.000Z");
    const all = parseRange({ range: "all" }, now);
    expect(all.from).toBeNull();
    expect(all.to).toBe(now);
    expect(all.label).toBe("All time");
  });

  it("a custom range covers both whole days, and its end is capped at now", () => {
    const r = parseRange({ range: "custom", from: "2026-08-01", to: "2026-09-30" }, now);
    expect(r.key).toBe("custom");
    expect(r.from!.toISOString()).toBe("2026-07-31T21:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-30T20:59:59.999Z");
    expect(r.label).toBe("1 Aug 2026 – 30 Sep 2026");
    const capped = parseRange({ range: "custom", from: "2026-10-01", to: "2027-01-01" }, now);
    expect(capped.to).toBe(now);
  });

  it("a custom range that is backwards, in the future or not a date is the last 3 months", () => {
    for (const q of [
      { range: "custom", from: "2026-09-30", to: "2026-08-01" },
      { range: "custom", from: "2027-01-01", to: "2027-02-01" },
      { range: "custom", from: "2026-02-30", to: "2026-03-01" },
      { range: "custom", from: "1 Aug", to: "2026-09-01" },
    ]) {
      expect(parseRange(q, now).key).toBe("3months");
    }
  });

  it("puts only dates in an address", () => {
    expect(rangeQuery(parseRange({ range: "custom", from: "2026-08-01", to: "2026-09-30" }, now))).toBe(
      "range=custom&from=2026-08-01&to=2026-09-30",
    );
    expect(rangeQuery(parseRange({ range: "year" }, now))).toBe("range=year");
  });
});

describe("weeks and months", () => {
  it("weeks start on Monday, Syros midnight, across the October clock change", () => {
    const r = parseRange({ range: "custom", from: "2026-10-21", to: "2026-11-03" }, new Date("2026-12-01T00:00:00Z"));
    const weeks = weeksIn(r, new Date("2020-01-01"));
    expect(weeks.map((w) => w.toISOString())).toEqual([
      "2026-10-18T21:00:00.000Z", // Mon 19 Oct, summer time
      "2026-10-25T22:00:00.000Z", // Mon 26 Oct, winter time
      "2026-11-01T22:00:00.000Z", // Mon 2 Nov
    ]);
  });

  it("all time starts at the first event", () => {
    const r = parseRange({ range: "all" }, now);
    const months = monthsIn(r, new Date("2026-08-15T10:00:00Z"));
    expect(months.map((m) => m.toISOString())).toEqual([
      "2026-07-31T21:00:00.000Z",
      "2026-08-31T21:00:00.000Z",
      "2026-09-30T21:00:00.000Z",
    ]);
    expect(isShort(r, new Date("2026-08-15T10:00:00Z"))).toBe(true);
    expect(isShort(r, new Date("2025-01-01T00:00:00Z"))).toBe(false);
  });

  it("athensMidnight runs over months and years", () => {
    expect(athensMidnight(2026, 13, 1).toISOString()).toBe("2026-12-31T22:00:00.000Z");
    expect(athensMidnight(2026, 3, 0).toISOString()).toBe("2026-02-27T22:00:00.000Z");
  });
});
