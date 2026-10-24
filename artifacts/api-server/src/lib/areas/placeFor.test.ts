import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { haversineKm } from "@workspace/geo";
import { isRemote, placeFor } from "./placeFor";
import { SEED_AREAS } from "./seedAreas";

const REMOTE = { lat: 37.47, lng: 24.99 };

describe("placeFor", () => {
  it("names the area at Ermoupoli's centre", () => {
    const e = SEED_AREAS.find((a) => a.key === "ermoupoli")!;
    expect(placeFor(e.lat, e.lng, SEED_AREAS)).toEqual({ areaKey: "ermoupoli", onIsland: true });
  });

  it("puts a point inside the box but far from every area off the area list, still on the island", () => {
    for (const a of SEED_AREAS) {
      expect(haversineKm(REMOTE, a)).toBeGreaterThan(2);
    }
    const p = placeFor(REMOTE.lat, REMOTE.lng, SEED_AREAS);
    expect(p).toEqual({ areaKey: "off", onIsland: true });
    expect(isRemote(p)).toBe(true);
  });

  it("says Athens is not on the island and not remote", () => {
    const p = placeFor(37.98, 23.73, SEED_AREAS);
    expect(p.onIsland).toBe(false);
    expect(isRemote(p)).toBe(false);
  });

  it("uses the current areas when none are given", () => {
    expect(placeFor(37.4447, 24.9417).onIsland).toBe(true);
  });
});

describe("island box pin", () => {
  it("matches the client's SYROS_RECT and SYROS_MARGIN_DEG text", () => {
    const grab = (file: string) => {
      const src = readFileSync(file, "utf8");
      const rect = src.match(/export const SYROS_RECT = \{[^}]*\};/)?.[0];
      const margin = src.match(/export const SYROS_MARGIN_DEG = [^;]*;/)?.[0];
      expect(rect).toBeTruthy();
      expect(margin).toBeTruthy();
      return { rect, margin };
    };
    const server = grab(resolve(__dirname, "placeFor.ts"));
    const client = grab(resolve(__dirname, "../../../../cat-spotter/lib/island.ts"));
    expect(server).toEqual(client);
  });
});
