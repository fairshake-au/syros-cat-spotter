/**
 * SYC-166 slice 3 (spec test 14, Decision D1): the owner's live push for a
 * sighting of a cat they own. A photo logged long after it was taken would
 * otherwise read "spotted again!" as if the cat were seen just now.
 *
 * Every day here is an Athens day (the streak's zone, `streak.ts`), so the
 * near-midnight and DST-night cases are where a UTC weekday would go wrong.
 */
import { describe, expect, it } from "vitest";
import { spottedAgainMessage } from "./sightingMessage";

const HOUR = 3_600_000;
const MIN = 60_000;

// Wednesday 14 October 2026, 15:00 in Athens (EEST, UTC+3).
const NOW = new Date("2026-10-14T12:00:00Z");

describe("spottedAgainMessage", () => {
  it("says spotted again for a sighting up to 24 hours old", () => {
    expect(spottedAgainMessage("Agatha", new Date(NOW.getTime() - 1 * HOUR), NOW)).toBe(
      "Agatha was spotted again!",
    );
    expect(
      spottedAgainMessage("Agatha", new Date(NOW.getTime() - 23 * HOUR - 59 * MIN), NOW),
    ).toBe("Agatha was spotted again!");
    expect(spottedAgainMessage("Agatha", new Date(NOW.getTime() - 24 * HOUR), NOW)).toBe(
      "Agatha was spotted again!",
    );
  });

  it("names the weekday once the sighting is more than 24 hours old", () => {
    // 24 h 01 min before Wednesday 15:00 is Tuesday 14:59.
    expect(
      spottedAgainMessage("Agatha", new Date(NOW.getTime() - 24 * HOUR - 1 * MIN), NOW),
    ).toBe("Agatha was seen on Tuesday");
  });

  it("says spotted again for a time slightly in the future (a fast phone clock)", () => {
    expect(spottedAgainMessage("Agatha", new Date(NOW.getTime() + 5 * MIN), NOW)).toBe(
      "Agatha was spotted again!",
    );
  });

  it("takes the weekday from Athens, not UTC, just after midnight", () => {
    // 00:30 Saturday 10 Oct in Athens is 21:30 Friday 9 Oct in UTC.
    expect(spottedAgainMessage("Agatha", new Date("2026-10-09T21:30:00Z"), NOW)).toBe(
      "Agatha was seen on Saturday",
    );
    // 23:30 Monday 12 Oct in Athens is 20:30 UTC, the same day either way.
    expect(spottedAgainMessage("Agatha", new Date("2026-10-12T20:30:00Z"), NOW)).toBe(
      "Agatha was seen on Monday",
    );
  });

  it("uses the weekday for up to 6 Athens days back, then the date", () => {
    // Thursday 8 Oct, 23:00 Athens: 6 days back, still the weekday.
    expect(spottedAgainMessage("Agatha", new Date("2026-10-08T20:00:00Z"), NOW)).toBe(
      "Agatha was seen on Thursday",
    );
    // Wednesday 7 Oct, 23:00 Athens: 7 days back. "Wednesday" would read as
    // today, so the date.
    expect(spottedAgainMessage("Agatha", new Date("2026-10-07T20:00:00Z"), NOW)).toBe(
      "Agatha was seen on 7 October",
    );
    // 00:30 Thursday 8 Oct in Athens is 21:30 Wednesday 7 Oct in UTC: six
    // Athens days back, so the weekday, and it is Thursday.
    expect(spottedAgainMessage("Agatha", new Date("2026-10-07T21:30:00Z"), NOW)).toBe(
      "Agatha was seen on Thursday",
    );
  });

  it("takes the date from Athens, not UTC", () => {
    // 01:30 Saturday 3 Oct in Athens is 22:30 Friday 2 Oct in UTC.
    expect(spottedAgainMessage("Agatha", new Date("2026-10-02T22:30:00Z"), NOW)).toBe(
      "Agatha was seen on 3 October",
    );
    // Three weeks back, across a month boundary.
    expect(spottedAgainMessage("Agatha", new Date("2026-09-23T09:00:00Z"), NOW)).toBe(
      "Agatha was seen on 23 September",
    );
  });

  describe("the night the clocks go back (Sunday 25 October 2026, 04:00 EEST -> 03:00 EET)", () => {
    // Tuesday 27 Oct, 10:00 Athens (EET, UTC+2).
    const AFTER = new Date("2026-10-27T08:00:00Z");

    it("an hour before the change is still Sunday", () => {
      // 00:30 Sunday 25 Oct EEST = 21:30 Saturday 24 Oct UTC.
      expect(spottedAgainMessage("Agatha", new Date("2026-10-24T21:30:00Z"), AFTER)).toBe(
        "Agatha was seen on Sunday",
      );
    });

    it("the repeated hour is Sunday both times", () => {
      // 03:30 EEST (00:30 UTC) and 03:30 EET (01:30 UTC) are both Sunday.
      expect(spottedAgainMessage("Agatha", new Date("2026-10-25T00:30:00Z"), AFTER)).toBe(
        "Agatha was seen on Sunday",
      );
      expect(spottedAgainMessage("Agatha", new Date("2026-10-25T01:30:00Z"), AFTER)).toBe(
        "Agatha was seen on Sunday",
      );
    });

    it("just after midnight on the Monday, in winter time, is Monday", () => {
      // 00:30 Monday 26 Oct EET = 22:30 Sunday 25 Oct UTC.
      expect(spottedAgainMessage("Agatha", new Date("2026-10-25T22:30:00Z"), AFTER)).toBe(
        "Agatha was seen on Monday",
      );
    });

    it("counts Athens days, not 24-hour blocks", () => {
      // Now: 00:30 Sunday 1 Nov EET. Monday 26 Oct 00:30 EET is 6 Athens
      // days back. Sunday 25 Oct 23:30 EET is only 145 hours back, but 7
      // Athens days: "Sunday" would read as today, so the date.
      const SUNDAY = new Date("2026-10-31T22:30:00Z");
      expect(spottedAgainMessage("Agatha", new Date("2026-10-25T22:30:00Z"), SUNDAY)).toBe(
        "Agatha was seen on Monday",
      );
      expect(spottedAgainMessage("Agatha", new Date("2026-10-25T21:30:00Z"), SUNDAY)).toBe(
        "Agatha was seen on 25 October",
      );
    });
  });
});
