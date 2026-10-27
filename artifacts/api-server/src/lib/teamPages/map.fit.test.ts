import { describe, expect, it } from "vitest";
import { mergeSameSpot, type MapMarker } from "./map";

// SYC-602 Task 1.4 (SYC-459 items 1 and 5): the small map of a cat's sightings.

const seen = (n: number, lat = 37.4447, lng = 24.9418): MapMarker => ({
  lat,
  lng,
  n,
  look: "seen",
  label: `Sighting ${n}`,
  href: `#sg-${100 + n}`,
});

describe("one marker per spot on the small map", () => {
  it("draws one marker per spot with the range of its numbers", () => {
    const out = mergeSameSpot([seen(2), seen(3), seen(4)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("2–4");
    expect(mergeSameSpot([seen(2), seen(5), seen(7)])[0]!.text).toBe("2, 5, 7");
  });

  it("writes a mix as runs and singles: 2, 3, 4 and 7 is 2–4, 7", () => {
    expect(mergeSameSpot([seen(2), seen(3), seen(4), seen(7)])[0]!.text).toBe("2–4, 7");
  });

  it("treats positions equal to 5 decimal places as one spot, and others as different spots", () => {
    const out = mergeSameSpot([seen(1, 37.444701, 24.941801), seen(2, 37.444704, 24.941798), seen(3, 37.4448, 24.9418)]);
    expect(out.map((m) => m.text ?? m.n)).toEqual(["1–2", 3]);
  });

  it("leaves a lone marker as it was, with no text", () => {
    const out = mergeSameSpot([seen(1), seen(2, 37.45, 24.95)]);
    expect(out.map((m) => m.n)).toEqual([1, 2]);
    expect(out.every((m) => m.text === undefined)).toBe(true);
  });

  it("links a merged marker to its newest sighting and names every sighting in its label", () => {
    const m = mergeSameSpot([seen(2), seen(3), seen(4)])[0]!;
    expect(m.href).toBe("#sg-104");
    expect(m.label).toBe("Sighting 2; Sighting 3; Sighting 4");
  });
});

// SYC-459 item 5 (the small map centred on its points) was the server's
// fitView; since SYC-705 the map fits its points in the browser
// (dashboard-pin.js fitBounds: mapCore.test.ts).
