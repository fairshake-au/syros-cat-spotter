import { describe, it, expect } from "vitest";
import {
  athensDay,
  weekStartAthens,
  weekStartInstant,
  nextWeekStartInstant,
} from "./weeks";

describe("weeks (Athens Monday-start)", () => {
  it("weekStartAthens at the boundaries and both clock changes", () => {
    expect(weekStartAthens(new Date("2026-10-25T20:59:59Z"))).toBe("2026-10-19");
    expect(weekStartAthens(new Date("2026-10-25T22:00:00Z"))).toBe("2026-10-26");
    expect(weekStartAthens(new Date("2026-03-29T20:59:59Z"))).toBe("2026-03-23");
    expect(weekStartAthens(new Date("2026-03-29T21:00:00Z"))).toBe("2026-03-30");
  });

  it("weekStartInstant round-trips", () => {
    expect(weekStartInstant("2026-10-26").toISOString()).toBe(
      "2026-10-25T22:00:00.000Z",
    );
    expect(weekStartInstant("2026-03-30").toISOString()).toBe(
      "2026-03-29T21:00:00.000Z",
    );
  });

  it("nextWeekStartInstant is the following Athens Monday", () => {
    expect(
      nextWeekStartInstant(new Date("2026-10-24T10:00:00Z")).toISOString(),
    ).toBe("2026-10-25T22:00:00.000Z");
  });

  it("athensDay uses the Athens calendar day", () => {
    expect(athensDay(new Date("2026-10-24T21:30:00Z"))).toBe("2026-10-25");
  });
});
