import { describe, expect, it } from "vitest";
import { areaFor, areaByKey, NAMED_AREAS, OFF_SYROS } from "./namedAreas";

describe("named areas (spec §3.3)", () => {
  it("puts a point in the area whose centre is nearest", () => {
    expect(areaFor(37.4447, 24.9417).key).toBe("ermoupoli");
    expect(areaFor(37.4436, 24.8889).key).toBe("kini"); // centres from lib/mapTiles/areas.ts
  });
  it("is Off Syros more than 2 km from every centre", () => {
    expect(areaFor(37.28745, -109.54176)).toBe(OFF_SYROS); // the Arizona test report
    expect(areaFor(37.6, 24.94)).toBe(OFF_SYROS);
  });
  it("has unique keys made only of a-z and hyphens (they go in web addresses)", () => {
    const keys = NAMED_AREAS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z-]+$/);
  });
  it("finds an area by key and refuses anything else", () => {
    expect(areaByKey("kini")?.name).toBe("Kini");
    expect(areaByKey("37.4,24.9")).toBeUndefined();
    expect(areaByKey(undefined)).toBeUndefined();
  });
  it("keeps Ermoupoli and Vaporia (about 500 m apart) as separate areas", () => {
    expect(areaFor(37.4447, 24.9417).key).toBe("ermoupoli");
    expect(areaFor(37.4447, 24.9475).key).toBe("vaporia");
  });
  it("maps every area's own centre to itself", () => {
    for (const a of NAMED_AREAS) expect(areaFor(a.lat, a.lng).key).toBe(a.key);
  });
  it.each(["ano-syros", "vari", "fabrika", "manna"])(
    "has %s, and its own centre maps to it",
    (key) => {
      const a = areaByKey(key);
      expect(a).toBeDefined();
      expect(areaFor(a!.lat, a!.lng).key).toBe(key);
    },
  );
});
