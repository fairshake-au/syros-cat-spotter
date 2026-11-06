import { describe, expect, it } from "vitest";
import { serialiseCat, type CatSource, type Viewer } from "./catHelpers";
import { blurPosition } from "./blur";
import { areaFor, OFF_SYROS } from "./areas/namedAreas";

// SYC-810: the area on a cat comes only from the published cell centre.
// Never from the exact position, never from the owner's home pin (spec §3).

const OWNER_DEVICE = "device-owner-letters-only";
const PUBLIC: Viewer = { tier: "public" };
const OWNER: Viewer = { tier: "owner", deviceId: OWNER_DEVICE };

function source(over: Partial<CatSource> & { lat: number; lng: number }): CatSource {
  return {
    id: 1,
    name: "Biscuit",
    namePending: false,
    description: "",
    photoUrl: null,
    ownerDeviceId: OWNER_DEVICE,
    sightingsCount: 1,
    lastSeenAt: "2026-11-01",
    discovererDeviceId: "device-discoverer-letters-only",
    discovererNickname: null,
    discovererUsername: null,
    ownerName: null,
    homeDescription: null,
    homeLat: null,
    homeLng: null,
    derived: {
      hasHome: false,
      lifeStatus: "alive",
      notSeenSince: null,
      sterilised: { value: "unknown", confidence: "none", clippedTipSightings: 0 },
      coat: [],
      coatColours: [],
      coatPattern: null,
      markings: [],
    } as unknown as CatSource["derived"],
    ...over,
  };
}

/** An exact spot whose own area differs from its cell centre's area. Found by scanning, so it follows the seed list. */
function borderSpot(): { lat: number; lng: number } {
  const lat = 37.4447;
  for (let i = 0; i <= 2000; i++) {
    const lng = 24.935 + i * 0.00005;
    const here = areaFor(lat, lng).key;
    const cell = blurPosition(lat, lng);
    if (here !== areaFor(cell.lat, cell.lng).key) return { lat, lng };
  }
  throw new Error("no border spot found");
}

describe("serialiseCat area", () => {
  it("the public and the owner get the same area for one cat", () => {
    const cat = source({ lat: 37.4436, lng: 24.8889 });
    const pub = serialiseCat(cat, PUBLIC);
    const owner = serialiseCat(cat, OWNER);
    expect(owner.locationPrecision).toBe("exact");
    expect(pub.areaName).toBeTruthy();
    expect(owner.areaName).toBe(pub.areaName);
    expect(owner.areaKey).toBe(pub.areaKey);
  });

  it("a cat near a border gets its cell centre's area", () => {
    const spot = borderSpot();
    const cell = blurPosition(spot.lat, spot.lng);
    const expected = areaFor(cell.lat, cell.lng);
    expect(areaFor(spot.lat, spot.lng).key).not.toBe(expected.key);
    for (const viewer of [PUBLIC, OWNER]) {
      const out = serialiseCat(source(spot), viewer);
      expect(out.areaKey).toBe(expected.key);
      expect(out.areaName).toBe(expected.name);
    }
  });

  it("a homed cat gets the cell centre's area, whatever its pin says", () => {
    const kini = { lat: 37.4436, lng: 24.8889 };
    const pin = { homeLat: 37.4447, homeLng: 24.9417 }; // Ermoupoli
    const cell = blurPosition(kini.lat, kini.lng);
    const expected = areaFor(cell.lat, cell.lng);
    expect(areaFor(pin.homeLat, pin.homeLng).key).not.toBe(expected.key);
    const cat = source({
      ...kini,
      ...pin,
      derived: { ...source(kini).derived, hasHome: true },
    });
    for (const viewer of [PUBLIC, OWNER]) {
      const out = serialiseCat(cat, viewer);
      expect(out.hasHome).toBe(true);
      expect(out.areaKey).toBe(expected.key);
      expect(out.areaName).toBe(expected.name);
    }
  });

  it("a cell more than 2km from every centre has no area", () => {
    const sea = { lat: 37.3, lng: 24.9 };
    const cell = blurPosition(sea.lat, sea.lng);
    expect(areaFor(cell.lat, cell.lng)).toBe(OFF_SYROS);
    for (const viewer of [PUBLIC, OWNER]) {
      const out = serialiseCat(source(sea), viewer);
      expect(out.areaKey).toBeNull();
      expect(out.areaName).toBeNull();
    }
  });
});
