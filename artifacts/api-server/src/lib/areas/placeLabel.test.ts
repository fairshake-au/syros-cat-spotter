import { describe, expect, it } from "vitest";
import { placeLabel, publicLabelOf } from "./placeLabel";

const KINI = { lat: 37.4436, lng: 24.8889 };
const site = (o: Partial<{ isPublic: boolean; publicLabel: string | null; retiredAt: Date | null }> = {}) => ({
  isPublic: true,
  publicLabel: "harbour steps",
  retiredAt: null,
  ...o,
});

describe("placeLabel (spec §3.2)", () => {
  it("is the area name alone", () => expect(placeLabel(KINI)).toBe("Kini"));
  it("adds a public label", () =>
    expect(placeLabel(KINI, publicLabelOf(site()))).toBe("Kini, harbour steps"));
  it("is Off Syros off the island", () =>
    expect(placeLabel({ lat: 37.28745, lng: -109.54176 })).toBe("Off Syros"));
  it("ignores a blank public label", () =>
    expect(placeLabel(KINI, publicLabelOf(site({ publicLabel: "  " })))).toBe("Kini"));
});

describe("publicLabelOf", () => {
  it("trims a public site's label", () =>
    expect(publicLabelOf(site({ publicLabel: "  harbour steps " }))).toBe("harbour steps"));
  it("is null for a site that is not public", () =>
    expect(publicLabelOf(site({ isPublic: false }))).toBeNull());
  it("is null for a retired site", () =>
    expect(publicLabelOf(site({ retiredAt: new Date() }))).toBeNull());
  it("is null for a missing or blank label", () => {
    expect(publicLabelOf(site({ publicLabel: null }))).toBeNull();
    expect(publicLabelOf(site({ publicLabel: "" }))).toBeNull();
  });
});

describe("placeLabel's second argument is a branded PublicLabel", () => {
  it("does not compile with a plain string (checked by `tsc`, not by vitest)", () => {
    // @ts-expect-error a plain string, such as a site's internal name, is not a PublicLabel
    const label = placeLabel(KINI, "Eleni's");
    expect(typeof label).toBe("string");
  });
});
