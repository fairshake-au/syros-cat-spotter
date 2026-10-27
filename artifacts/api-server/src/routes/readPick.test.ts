import { describe, expect, it } from "vitest";
import { readPick } from "./teamSites";
import { areaByKey } from "../lib/areas/namedAreas";
import { t } from "../lib/teamPages/words";

// SYC-705 Task 2b.7: what a place page's form turns into. The map's pin and
// typed numbers send lat/lng; the no-map path can send an area's key. A
// non-empty lat or lng wins over an area (ruling, 26 Oct 2026). Taps are gone.

describe("readPick", () => {
  it("an area's key gives its centre, marked approximate", () => {
    const kini = areaByKey("kini")!;
    expect(readPick({ area: "kini" })).toEqual({ ok: true, spot: { lat: kini.lat, lng: kini.lng }, approximate: true });
  });

  it("an unknown area key is refused, in the viewer's language", () => {
    for (const area of ["atlantis", "", "KINI", "<b>"]) {
      const out = readPick({ area });
      expect(out, area).toEqual({ ok: false, status: 400, note: t("sproblem.area"), fields: ["area"] });
    }
    expect(readPick({ area: "atlantis" }, "el")).toMatchObject({ ok: false, note: t("sproblem.area", "el") });
  });

  it("typed or pin numbers are exact, never approximate", () => {
    expect(readPick({ lat: "37.4447", lng: "24.9417" })).toEqual({ ok: true, spot: { lat: 37.4447, lng: 24.9417 }, approximate: false });
  });

  it("a non-empty lat or lng wins over an area; empty ones leave the area", () => {
    expect(readPick({ lat: "37.4501", lng: "24.9501", area: "kini" })).toMatchObject({ ok: true, approximate: false, spot: { lat: 37.4501 } });
    // Only one number: the typed branch still wins, and is refused.
    expect(readPick({ lat: "37.4501", lng: "", area: "kini" })).toMatchObject({ ok: false, fields: expect.arrayContaining(["lng"]) });
    expect(readPick({ lat: "", lng: "", area: "kini" })).toMatchObject({ ok: true, approximate: true });
  });

  it("a pin outside Syros is refused", () => {
    expect(readPick({ lat: "37.30", lng: "24.70" })).toEqual({
      ok: false,
      status: 400,
      note: t("sproblem.outside"),
      fields: ["lat", "lng"],
    });
  });

  it("the area list can be turned off (an area's own centre): then an area alone is no position", () => {
    expect(readPick({ area: "kini" }, undefined, { allowArea: false })).toMatchObject({ ok: false, status: 400, fields: expect.arrayContaining(["lat"]) });
    expect(readPick({ lat: "37.4447", lng: "24.9417", area: "kini" }, undefined, { allowArea: false })).toMatchObject({ ok: true, approximate: false });
  });

  it("an old tap (view, x, y) is no longer read", () => {
    expect(readPick({ view: "abc", size: "179", x: "190", y: "190" })).toMatchObject({ ok: false, status: 400 });
    expect(readPick({})).toMatchObject({ ok: false, status: 400, note: t("sproblem.position") });
  });
});
