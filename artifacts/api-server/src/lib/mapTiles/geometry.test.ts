import { describe, expect, it } from "vitest";
import {
  BANDS,
  clampView,
  GRID,
  inIsland,
  isTileAllowed,
  islandTileRange,
  ISLAND_BOX,
  latToTileY,
  lngToTileX,
  MAX_ZOOM,
  MIN_ZOOM,
  pan,
  pointOnView,
  tapToPosition,
  viewAround,
  viewCentre,
  viewTiles,
  zoomIn,
  zoomOut,
} from "./geometry";
import { AREAS } from "./areas";

// SYC-209 PR 3.1, spec test 17 (the maths half): a tap converts to the right
// position at zooms 13, 16 and 19, on every picture size, including taps on
// a picture's edges; the island box and zoom range hold.

/**
 * An independent reference for "where is this pixel": the same Web Mercator
 * written another way (Gudermannian form, absolute world pixels), so a slip
 * in geometry.ts's own formula can't cancel itself out here.
 */
function reference(z: number, size: number, worldPx: number, worldPy: number) {
  const world = size * 2 ** z;
  const lng = (worldPx / world) * 360 - 180;
  const n = Math.PI * (1 - (2 * worldPy) / world);
  const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(n)) - Math.PI / 2);
  return { lat, lng };
}

/** Metres between two nearby positions. */
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180 * Math.cos((a.lat * Math.PI) / 180);
  return R * Math.hypot(dLat, dLng);
}

/** Ground width of one displayed pixel at this zoom and size, in metres. */
const pixelMetres = (z: number, size: number, lat: number) =>
  (40_075_016 * Math.cos((lat * Math.PI) / 180)) / (size * 2 ** z);

const ERMOUPOLI = { lat: 37.4447, lng: 24.9417 };

describe("tap to position (test 17)", () => {
  for (const z of [13, 16, 19]) {
    for (const { size } of BANDS) {
      it(`zoom ${z}, a ${size} px picture: every tested point lands on its own pixel`, () => {
        // The tile Ermoupoli is in, and points across it: the corners, the
        // edges, the middle and a few in between.
        const tile = {
          z,
          x: Math.floor(lngToTileX(ERMOUPOLI.lng, z)),
          y: Math.floor(latToTileY(ERMOUPOLI.lat, z)),
        };
        const last = size - 1;
        const points: [number, number][] = [
          [0, 0], [last, 0], [0, last], [last, last],
          [0, Math.floor(size / 2)], [last, Math.floor(size / 2)],
          [Math.floor(size / 2), 0], [Math.floor(size / 2), last],
          [Math.floor(size / 2), Math.floor(size / 2)],
          [17, 101 % size], [size - 23, 7],
        ];
        for (const [px, py] of points) {
          const got = tapToPosition(tile, size, px, py)!;
          const want = reference(z, size, tile.x * size + px + 0.5, tile.y * size + py + 0.5);
          // Within a hundredth of a displayed pixel of that pixel's centre.
          expect(metres(got, want), `${px},${py}`).toBeLessThan(
            pixelMetres(z, size, ERMOUPOLI.lat) / 100,
          );
        }
      });
    }
  }

  it("a known spot: tapping the pixel Ermoupoli's square is drawn on gives back that square, to a pixel", () => {
    for (const z of [13, 16, 19]) {
      for (const { size } of BANDS) {
        const X = lngToTileX(ERMOUPOLI.lng, z);
        const Y = latToTileY(ERMOUPOLI.lat, z);
        const tile = { z, x: Math.floor(X), y: Math.floor(Y) };
        const px = Math.floor((X - tile.x) * size);
        const py = Math.floor((Y - tile.y) * size);
        const got = tapToPosition(tile, size, px, py)!;
        // Within one displayed pixel (its diagonal) of the real spot.
        expect(metres(got, ERMOUPOLI)).toBeLessThanOrEqual(
          pixelMetres(z, size, ERMOUPOLI.lat) * Math.SQRT2,
        );
      }
    }
  });

  it("the scale matters: converting a 171 px tap at 179 px puts the spot in the wrong place", () => {
    const z = 16;
    const tile = {
      z,
      x: Math.floor(lngToTileX(ERMOUPOLI.lng, z)),
      y: Math.floor(latToTileY(ERMOUPOLI.lat, z)),
    };
    const right = tapToPosition(tile, 171, 160, 160)!;
    const wrong = tapToPosition(tile, 179, 160, 160)!;
    expect(metres(right, wrong)).toBeGreaterThan(10 * pixelMetres(z, 171, ERMOUPOLI.lat));
  });

  it("across the seam between the picture's tiles, neighbouring pixels are one pixel apart", () => {
    const z = 19;
    const size = 179;
    const view = { z, x: Math.floor(lngToTileX(ERMOUPOLI.lng, z)), y: Math.floor(latToTileY(ERMOUPOLI.lat, z)) };
    const lastOfLeft = tapToPosition(view, size, size - 1, 50)!;
    const firstOfRight = tapToPosition(view, size, size, 50)!;
    expect(metres(lastOfLeft, firstOfRight)).toBeCloseTo(pixelMetres(z, size, ERMOUPOLI.lat), 1);
    // And it's the same place a picture starting one tile further east gives.
    const same = tapToPosition({ ...view, x: view.x + 1 }, size, 0, 50)!;
    expect(metres(firstOfRight, same)).toBeLessThan(0.001);
  });

  it("a point on the far edge itself is the last pixel; points outside the picture are refused", () => {
    const view = { z: 16, x: 37115, y: 25200 };
    const span = 2 * 179;
    const edge = tapToPosition(view, 179, span, span)!;
    const last = tapToPosition(view, 179, span - 1, span - 1)!;
    expect(metres(edge, last)).toBeLessThan(pixelMetres(16, 179, edge.lat));
    expect(tapToPosition(view, 179, span + 1, 0)).toBeNull();
    expect(tapToPosition(view, 179, -1, 0)).toBeNull();
    expect(tapToPosition(view, 179, 1.5, 0)).toBeNull();
    expect(tapToPosition(view, 200, 10, 10)).toBeNull(); // not a size the map draws
  });
});

describe("the island box and the zoom range", () => {
  it("allows only tiles touching Syros, at zooms 12 to 19", () => {
    for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
      const r = islandTileRange(z);
      expect(isTileAllowed({ z, x: r.minX, y: r.minY })).toBe(true);
      expect(isTileAllowed({ z, x: r.maxX, y: r.maxY })).toBe(true);
      expect(isTileAllowed({ z, x: r.minX - 1, y: r.minY })).toBe(false);
      expect(isTileAllowed({ z, x: r.maxX + 1, y: r.minY })).toBe(false);
      expect(isTileAllowed({ z, x: r.minX, y: r.minY - 1 })).toBe(false);
      expect(isTileAllowed({ z, x: r.minX, y: r.maxY + 1 })).toBe(false);
    }
    const r12 = islandTileRange(12);
    expect(isTileAllowed({ z: 11, x: r12.minX >> 1, y: r12.minY >> 1 })).toBe(false);
    expect(isTileAllowed({ z: 20, x: r12.minX << 8, y: r12.minY << 8 })).toBe(false);
    expect(isTileAllowed({ z: 12, x: 2330.5, y: 1587 })).toBe(false);
  });

  it("knows where the island is", () => {
    expect(inIsland(ERMOUPOLI)).toBe(true);
    expect(inIsland({ lat: ISLAND_BOX.maxLat + 0.001, lng: 24.94 })).toBe(false);
    expect(inIsland({ lat: 37.44, lng: ISLAND_BOX.minLng - 0.001 })).toBe(false);
    expect(inIsland({ lat: 37.9, lng: 23.7 })).toBe(false); // Athens
    expect(inIsland({ lat: Number.NaN, lng: 24.94 })).toBe(false);
  });

  it("every quick area is on Syros, at a zoom the map shows", () => {
    for (const a of AREAS) {
      expect(inIsland(a), a.key).toBe(true);
      expect(a.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(a.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });
});

describe("views", () => {
  it("keeps every view's four tiles on the island's tiles, at every zoom, whatever is asked", () => {
    for (let z = MIN_ZOOM - 2; z <= MAX_ZOOM + 2; z++) {
      for (const [x, y] of [[0, 0], [1e9, 1e9], [-5, 3]]) {
        const v = clampView({ z, x: x!, y: y! });
        for (const t of viewTiles(v)) expect(isTileAllowed(t), JSON.stringify(t)).toBe(true);
      }
    }
  });

  it("zooming in and out keeps the middle of the map where it was, to within a tile", () => {
    const v = viewAround(ERMOUPOLI, 15);
    const inner = zoomIn(v);
    expect(inner.z).toBe(16);
    const c1 = viewCentre(v);
    const c2 = viewCentre(inner);
    expect(metres(c1, c2)).toBeLessThan(pixelMetres(16, 256, c1.lat) * 256);
    expect(zoomOut(inner).z).toBe(15);
    expect(zoomIn(viewAround(ERMOUPOLI, MAX_ZOOM)).z).toBe(MAX_ZOOM);
    expect(zoomOut(viewAround(ERMOUPOLI, MIN_ZOOM)).z).toBe(MIN_ZOOM);
  });

  it("a view around a spot shows it, and markers sit on the spot's pixel", () => {
    for (const z of [13, 16, 19]) {
      const v = viewAround(ERMOUPOLI, z);
      for (const { size } of BANDS) {
        const at = pointOnView(v, size, ERMOUPOLI)!;
        expect(at).not.toBeNull();
        // Tap that pixel on the map picture: back to the spot, to a pixel.
        const got = tapToPosition(v, size, at.left, at.top)!;
        expect(metres(got, ERMOUPOLI)).toBeLessThanOrEqual(pixelMetres(z, size, ERMOUPOLI.lat) * Math.SQRT2);
      }
    }
  });

  it("panning moves one picture and stops at the island's edge", () => {
    const v = viewAround(ERMOUPOLI, 16);
    expect(pan(v, 1, 0)).toEqual({ ...v, x: v.x + 1 });
    let far = v;
    for (let i = 0; i < 500; i++) far = pan(far, 1, 0);
    expect(far.x + GRID - 1).toBe(islandTileRange(16).maxX);
  });
});

describe("the width bands (plan K4)", () => {
  it("each band's map fits its narrowest screen with the page's 12 px margins", () => {
    for (const [i, b] of BANDS.entries()) {
      const narrowest = i === 0 ? 320 : b.minWidth;
      expect(GRID * b.size + 24, `${b.size} px at ${narrowest} px`).toBeLessThanOrEqual(narrowest);
      // The next band up would not fit this band's narrowest screen (so the
      // biggest that fits is used), except the desktop band.
      const next = BANDS[i + 1];
      if (next && next.minWidth < 600) expect(GRID * next.size + 24).toBeGreaterThan(narrowest);
    }
    expect(BANDS.map((b) => b.size)).toEqual([144, 164, 171, 179, 256]);
    expect(BANDS.map((b) => b.minWidth)).toEqual([0, 360, 375, 390, 600]);
  });
});
