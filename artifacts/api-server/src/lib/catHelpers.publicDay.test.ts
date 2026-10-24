import { describe, expect, it } from "vitest";
import { toPublicDay } from "./catHelpers";

// SYC-624 A1: a public day is a Syros (Europe/Athens) day, not a UTC day.
describe("toPublicDay", () => {
  it("cuts the day in Athens summer time (UTC+3)", () => {
    expect(toPublicDay("2026-10-22T22:30:00.000Z")).toBe("2026-10-23");
    expect(toPublicDay("2026-10-22T20:30:00.000Z")).toBe("2026-10-22");
  });

  it("cuts the day in Athens winter time (UTC+2)", () => {
    expect(toPublicDay("2026-12-31T22:30:00.000Z")).toBe("2027-01-01");
    expect(toPublicDay("2026-12-31T21:30:00.000Z")).toBe("2026-12-31");
  });

  it("gives a Date the same answer as its ISO string", () => {
    const iso = "2026-10-22T22:30:00.000Z";
    expect(toPublicDay(new Date(iso))).toBe(toPublicDay(iso));
  });

  it("returns a bare YYYY-MM-DD unchanged", () => {
    expect(toPublicDay("2026-10-22")).toBe("2026-10-22");
  });
});
