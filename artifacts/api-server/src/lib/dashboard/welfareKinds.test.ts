import { describe, expect, it } from "vitest";
import { WELFARE_COLOUR, WELFARE_ORDER, WELFARE_PATTERN, WELFARE_WORD, kindOf } from "./welfareKinds";

// SYC-396 PR 3.3b (plan Decision 11): every report is in exactly one kind.

describe("kindOf", () => {
  it("puts an urgent litter in litter, and only there", () => {
    expect(kindOf({ severity: "urgent", isLitter: true })).toBe("litter");
    expect(kindOf({ severity: "attention", isLitter: true })).toBe("litter");
  });

  it("splits the rest by urgency", () => {
    expect(kindOf({ severity: "urgent", isLitter: false })).toBe("urgent");
    expect(kindOf({ severity: "attention", isLitter: false })).toBe("attention");
  });
});

describe("the fixed kinds", () => {
  it("are in the fixed order, each with its own colour, word and pattern", () => {
    expect(WELFARE_ORDER).toEqual(["urgent", "attention", "litter"]);
    expect(WELFARE_COLOUR).toEqual({ urgent: "#b42318", attention: "#a08000", litter: "#5b4b8a" });
    expect(WELFARE_WORD).toEqual({ urgent: "Urgent", attention: "Needs attention", litter: "Litter" });
    // Never colour alone: three different patterns, so a black-and-white print reads.
    expect(new Set(Object.values(WELFARE_PATTERN)).size).toBe(3);
  });
});
