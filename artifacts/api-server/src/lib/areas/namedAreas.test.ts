import { describe, expect, it } from "vitest";
import { haversineKm } from "../catHelpers";
import { areaFor, areaByKey, SEED_AREAS, OFF_SYROS } from "./namedAreas";

describe("named areas (spec §3.3)", () => {
  it("puts a point in the area whose centre is nearest", () => {
    expect(areaFor(37.4447, 24.9417).key).toBe("ermoupoli");
    expect(areaFor(37.4436, 24.8889).key).toBe("kini"); // a seed centre
  });
  it("is Off Syros more than 2 km from every centre", () => {
    expect(areaFor(37.28745, -109.54176)).toBe(OFF_SYROS); // the Arizona test report
    expect(areaFor(37.6, 24.94)).toBe(OFF_SYROS);
  });
  it("has unique keys made only of a-z and hyphens (they go in web addresses)", () => {
    const keys = SEED_AREAS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z-]+$/);
  });
  it("finds an area by key and refuses anything else", () => {
    expect(areaByKey("kini")?.name).toBe("Kini");
    expect(areaByKey("37.4,24.9")).toBeUndefined();
    expect(areaByKey(undefined)).toBeUndefined();
  });
  it("keeps its first 7 centres where the old team map had them, so named places don't move", () => {
    const first7: [string, number, number][] = [
      ["ermoupoli", 37.4447, 24.9417],
      ["vaporia", 37.4447, 24.9475],
      ["kini", 37.4436, 24.8889],
      ["galissas", 37.4226, 24.8825],
      ["finikas", 37.3976, 24.8783],
      ["posidonia", 37.3889, 24.8874],
      ["azolimnos", 37.4105, 24.9594],
    ];
    for (const [key, lat, lng] of first7) {
      const n = areaByKey(key);
      expect(n, key).toBeDefined();
      expect([n!.lat, n!.lng]).toEqual([lat, lng]);
    }
  });
  it("treats NaN and Infinity as Off Syros", () => {
    expect(areaFor(NaN, 24.9)).toBe(OFF_SYROS);
    expect(areaFor(37.4, NaN)).toBe(OFF_SYROS);
    expect(areaFor(Infinity, 24.9)).toBe(OFF_SYROS);
    expect(areaFor(37.4, -Infinity)).toBe(OFF_SYROS);
  });
  describe("the 2 km rule", () => {
    // Grammata is the northernmost centre; due north of it is open sea, so
    // no other centre is anywhere near.
    const grammata = areaByKey("grammata")!;
    const north = (km: number) => ({
      lat: grammata.lat + ((km / 6371) * 180) / Math.PI,
      lng: grammata.lng,
    });
    it("1.99 km due north is still Grammata", () => {
      const p = north(1.99);
      expect(haversineKm(p.lat, p.lng, grammata.lat, grammata.lng)).toBeCloseTo(1.99, 6);
      expect(areaFor(p.lat, p.lng)).toBe(grammata);
    });
    it("2.01 km due north is Off Syros", () => {
      const p = north(2.01);
      expect(haversineKm(p.lat, p.lng, grammata.lat, grammata.lng)).toBeCloseTo(2.01, 6);
      expect(areaFor(p.lat, p.lng)).toBe(OFF_SYROS);
    });
  });
  it("maps every area's own centre to itself", () => {
    for (const a of SEED_AREAS) expect(areaFor(a.lat, a.lng).key).toBe(a.key);
  });
  it.each(["ano-syros", "vari", "fabrika", "manna", "mega-gialos", "chroussa"])(
    "has %s, and its own centre maps to it",
    (key) => {
      const a = areaByKey(key);
      expect(a).toBeDefined();
      expect(areaFor(a!.lat, a!.lng).key).toBe(key);
    },
  );
});
