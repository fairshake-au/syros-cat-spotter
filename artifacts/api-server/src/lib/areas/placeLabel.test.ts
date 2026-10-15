import { describe, expect, it } from "vitest";
import { placeLabel } from "./placeLabel";

describe("placeLabel (spec §3.2)", () => {
  it("is the area name alone", () =>
    expect(placeLabel({ lat: 37.4436, lng: 24.8889 })).toBe("Kini"));
  it("adds a public label", () =>
    expect(placeLabel({ lat: 37.4436, lng: 24.8889 }, "harbour steps")).toBe(
      "Kini, harbour steps",
    ));
  it("is Off Syros off the island", () =>
    expect(placeLabel({ lat: 37.28745, lng: -109.54176 })).toBe("Off Syros"));
  it("ignores a blank public label", () =>
    expect(placeLabel({ lat: 37.4436, lng: 24.8889 }, "  ")).toBe("Kini"));
});
