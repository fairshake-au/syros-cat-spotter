import { describe, expect, it } from "vitest";
import { meaningOf } from "./guardianChanges";

// SYC-398 A1: a coat's meaning is read through the one translation, so old
// and new shapes compare, and a difference in the pattern alone counts when
// deciding whether a cat guardian contradicts the team.
describe("meaningOf: coat (SYC-398)", () => {
  it("old and new shapes that say the same thing mean the same", () => {
    expect(meaningOf("coat", { colours: ["ginger", "tabby"] })).toBe(
      meaningOf("coat", { colours: ["ginger"], pattern: "stripes", reason: "x" }),
    );
    expect(meaningOf("coat", { colours: ["white", "black"] })).toBe(meaningOf("coat", { colours: ["black_and_white"] }));
  });

  it("a difference in the pattern alone is a difference", () => {
    expect(meaningOf("coat", { colours: ["grey"], pattern: "plain" })).not.toBe(
      meaningOf("coat", { colours: ["grey"], pattern: "stripes" }),
    );
  });

  it("a retraction or a malformed value means nothing", () => {
    expect(meaningOf("coat", { retracted: true })).toBeNull();
    expect(meaningOf("coat", { colours: ["purple"] })).toBeNull();
  });
});
