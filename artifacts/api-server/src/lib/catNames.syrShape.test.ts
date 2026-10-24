import { describe, expect, it } from "vitest";
import { isSyrShapedName } from "./catNames";

// SYC-677 D: anything a person would read as a cat's SYR number is not a name.
describe("isSyrShapedName", () => {
  it.each([
    "SYR-0042",
    "syr0042",
    "SYR 0042",
    "syr  42",
    "SYR–0042",
    "SYR−0042",
    "SYR—0042",
    "SYR - 0042",
    "  SYR-0042 ",
    "ΣΥΡ-0042",
    "συρ 42",
    "Συρ0042",
  ])("refuses %j", (name) => {
    expect(isSyrShapedName(name)).toBe(true);
  });

  it.each(["Syrah", "Syros", "SYR", "SYR-", "Mimi 42", "Agatha", "SYR-0042b", "Σύρος"])(
    "allows %j",
    (name) => {
      expect(isSyrShapedName(name)).toBe(false);
    },
  );
});
