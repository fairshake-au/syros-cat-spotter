import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import { addPerson, db, mapTileCacheTable, pool } from "@workspace/db";
import app from "../app";
import { sessionCookieFor, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";
import {
  BANDS,
  inIsland,
  islandTileRange,
  latToTileY,
  lngToTileX,
  type Position,
} from "../lib/mapTiles/geometry";
import { mintTileToken, readTileToken } from "../lib/mapTiles/tileToken";
import {
  FETCH_TIMEOUT_MS,
  REFRESH_AFTER_MS,
  trimTileCache,
  USER_AGENT,
} from "../lib/mapTiles/tileCache";
import { AREAS } from "../lib/mapTiles/areas";

// SYC-209 PR 3.1: the team's map. Spec test 17 (the server half; the
// layout half runs in a browser, docs/screenshots/syc-209-pr-3-1/), plan K4
// and K13:
// - pictures need a session and `view_exact_location`;
// - the security header is the dashboard's, byte for byte (no script-src);
// - a picture is `private, max-age=86400`, never `public`; a refusal or an
//   error is `no-store`;
// - nothing outside Syros or zooms 12–19 is fetched;
// - a tap converts at the size of the picture tapped, on every size;
// - no href, action or src on a map page holds a coordinate or a z/x/y.

// A staff member who lacks exactly one capability (the colonies tests' way).
const denied = vi.hoisted(() => ({ cap: null as string | null }));
vi.mock("../lib/capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/capabilities")>();
  return {
    ...real,
    can: (...args: Parameters<typeof real.can>) =>
      args[1] === denied.cap ? false : real.can(...args),
  };
});

const RUN = randomBytes(3).toString("hex");
const SUSAN = `vitest-map-susan-${RUN}@example.com`;
const VERA = `vitest-map-vera-${RUN}@example.com`;
const KEY = "vitest-map-key-0123456789abcdef-0123456789abcdef";
const EXPECTED_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const ERMOUPOLI: Position = { lat: 37.4447, lng: 24.9417 };

let cookie: string;
let volunteerCookie: string;
let png: Buffer;
let fetchSpy: ReturnType<typeof vi.spyOn>;

/** A real 256 px PNG, as the provider would send. */
const makePng = (r: number) =>
  sharp({ create: { width: 256, height: 256, channels: 3, background: { r, g: 120, b: 90 } } })
    .png()
    .toBuffer();

function okFetch(body: Buffer = png) {
  return fetchSpy.mockImplementation(async () =>
    new Response(body, { status: 200, headers: { "Content-Type": "image/png" } }),
  );
}

const tileOf = (p: Position, z: number) => ({
  z,
  x: Math.floor(lngToTileX(p.lng, z)),
  y: Math.floor(latToTileY(p.lat, z)),
});

const picture = (token: string, c = cookie) =>
  request(app).get(`/api/team/map-tiles/${token}`).set("Cookie", c);

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await removeTestPerson(SUSAN);
  await removeTestPerson(VERA);
  const susan = await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest" });
  const vera = await addPerson({ email: VERA, name: "Vera", addedBy: "cli:vitest", roles: ["volunteer"] });
  cookie = sessionCookieFor(susan.id);
  volunteerCookie = sessionCookieFor(vera.id);
  png = await makePng(200);
});

beforeEach(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
  await db.delete(mapTileCacheTable);
  fetchSpy = vi.spyOn(globalThis, "fetch");
  okFetch();
});

afterEach(() => {
  fetchSpy.mockRestore();
});

afterAll(async () => {
  await db.delete(mapTileCacheTable);
  await removeTestPerson(SUSAN);
  await removeTestPerson(VERA);
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

describe("map pictures: who may have one", () => {
  it("needs a session: the same 401 as every dashboard route, with nothing fetched", async () => {
    const token = mintTileToken({ ...tileOf(ERMOUPOLI, 16), size: 179 });
    const res = await request(app).get(`/api/team/map-tiles/${token}`);
    expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("needs the team role: a volunteer gets the same 401", async () => {
    const token = mintTileToken({ ...tileOf(ERMOUPOLI, 16), size: 179 });
    const res = await picture(token, volunteerCookie);
    expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("needs view_exact_location: a team member without it gets the same 401", async () => {
    denied.cap = "view_exact_location";
    const token = mintTileToken({ ...tileOf(ERMOUPOLI, 16), size: 179 });
    const res = await picture(token);
    expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a picture already cached is still refused without a session (the cache sits behind the check)", async () => {
    const token = mintTileToken({ ...tileOf(ERMOUPOLI, 16), size: 179 });
    expect((await picture(token)).status).toBe(200);
    const res = await request(app).get(`/api/team/map-tiles/${token}`);
    expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    expect(res.headers["content-type"]).not.toMatch(/image/);
  });
});

describe("map pictures: what is sent", () => {
  it.each(BANDS.map((b) => b.size))(
    "a %i px picture is exactly that size, private to the browser, under the dashboard's own security header",
    async (size) => {
      const token = mintTileToken({ ...tileOf(ERMOUPOLI, 16), size: size as never });
      const res = await picture(token).buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(res.headers["cache-control"]).toBe("private, max-age=86400");
      expect(res.headers["cache-control"]).not.toMatch(/public/);
      expect(res.headers["content-security-policy"]).toBe(EXPECTED_CSP);
      expect(res.headers["content-security-policy"]).not.toMatch(/script-src/);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      const meta = await sharp(res.body as Buffer).metadata();
      expect([meta.width, meta.height, meta.format]).toEqual([size, size, "png"]);
    },
  );

  it("asks OpenStreetMap once, saying who we are, with a 10-second limit; then serves from the cache", async () => {
    const t = tileOf(ERMOUPOLI, 17);
    for (const size of [179, 256, 144]) {
      expect((await picture(mintTileToken({ ...t, size: size as never }))).status).toBe(200);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`);
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/catspotters\.com/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(FETCH_TIMEOUT_MS).toBe(10_000);
    const [row] = await db.select().from(mapTileCacheTable).where(eq(mapTileCacheTable.x, t.x));
    expect(row).toMatchObject({ z: t.z, x: t.x, y: t.y, size: png.length });
  });

  it("refuses a picture outside the island box or outside zooms 12 to 19, without fetching anything", async () => {
    const r16 = islandTileRange(16);
    const r12 = islandTileRange(12);
    const outside = [
      { z: 16, x: r16.minX - 1, y: r16.minY }, // west of Syros
      { z: 16, x: r16.maxX + 1, y: r16.minY }, // east
      { z: 16, x: r16.minX, y: r16.minY - 1 }, // north
      { z: 16, x: r16.minX, y: r16.maxY + 1 }, // south
      { z: 11, x: r12.minX >> 1, y: r12.minY >> 1 }, // too far out
      { z: 20, x: r12.minX << 8, y: r12.minY << 8 }, // too close
      { z: 16, x: 37000, y: 25000 }, // somewhere else entirely
    ];
    for (const t of outside) {
      const res = await picture(mintTileToken({ ...t, size: 179 }));
      expect([res.status, res.text], JSON.stringify(t)).toEqual([404, '{"error":"Not found"}']);
      expect(res.headers["cache-control"]).toBe("no-store");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.select().from(mapTileCacheTable)).toHaveLength(0);
  });

  it("refuses an address that isn't a valid token, the same way, without fetching anything", async () => {
    const good = mintTileToken({ ...tileOf(ERMOUPOLI, 16), size: 179 });
    const t = tileOf(ERMOUPOLI, 16);
    for (const bad of [
      `${t.z}/${t.x}/${t.y}.png`, // the old z/x/y shape is not a route at all
      `${t.z}-${t.x}-${t.y}`,
      good.slice(0, -1) + (good.endsWith("A") ? "B" : "A"),
      "x".repeat(59),
    ]) {
      const res = await request(app)
        .get(`/api/team/map-tiles/${bad}`)
        .set("Cookie", cookie);
      expect(res.status, bad).toBe(404);
      expect(res.headers["content-type"]).not.toMatch(/image/);
      // One path segment reaches the picture route, which refuses it no-store;
      // more than one is no route at all (the API's ordinary 404).
      if (!bad.includes("/")) expect(res.headers["cache-control"]).toBe("no-store");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an expired token is refused", async () => {
    const t = { ...tileOf(ERMOUPOLI, 16), size: 179 as const };
    const old = mintTileToken(t, Math.floor(Date.now() / 1000) - 26 * 3600);
    const res = await picture(old);
    expect([res.status, res.headers["cache-control"]]).toEqual([404, "no-store"]);
    expect(readTileToken(old)).toBeNull();
  });

  it("when the provider fails and nothing is cached: 503, no-store, nothing stored", async () => {
    const t = tileOf(ERMOUPOLI, 18);
    for (const failure of [
      async () => new Response("nope", { status: 500 }),
      async () => new Response("<html>not a picture</html>", { status: 200 }),
      async () => {
        throw new TypeError("fetch failed");
      },
    ]) {
      fetchSpy.mockImplementation(failure);
      const res = await picture(mintTileToken({ ...t, size: 256 }));
      expect([res.status, res.headers["cache-control"]]).toEqual([503, "no-store"]);
      expect(res.text).toBe('{"error":"Map picture unavailable"}');
    }
    expect(await db.select().from(mapTileCacheTable)).toHaveLength(0);
  });

  it("fetches a picture again after 30 days, and keeps the old one if that fails", async () => {
    const t = tileOf(ERMOUPOLI, 19);
    const token = mintTileToken({ ...t, size: 256 });
    expect((await picture(token)).status).toBe(200);
    const old = new Date(Date.now() - REFRESH_AFTER_MS - 60_000);
    await db.update(mapTileCacheTable).set({ fetchedAt: old });

    fetchSpy.mockImplementation(async () => new Response("x", { status: 503 }));
    const stale = await picture(token).buffer(true);
    expect(stale.status).toBe(200);
    expect(Buffer.compare(stale.body as Buffer, png)).toBe(0);

    const newer = await makePng(10);
    okFetch(newer);
    const fresh = await picture(token).buffer(true);
    expect(Buffer.compare(fresh.body as Buffer, newer)).toBe(0);
    const [row] = await db.select().from(mapTileCacheTable);
    expect(row!.fetchedAt.getTime()).toBeGreaterThan(old.getTime());
    // The first fetch, the failed refetch, the good one.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("keeps the cache under its cap, dropping the oldest pictures first", async () => {
    const r = islandTileRange(19);
    const rows = [0, 1, 2, 3].map((i) => ({
      z: 19,
      x: r.minX + i,
      y: r.minY,
      bytes: Buffer.alloc(1000, i),
      size: 1000,
      fetchedAt: new Date(Date.now() - (4 - i) * 60_000), // i = 0 is the oldest
    }));
    await db.insert(mapTileCacheTable).values(rows);
    await trimTileCache(2500);
    const left = await db
      .select({ x: mapTileCacheTable.x })
      .from(mapTileCacheTable)
      .orderBy(mapTileCacheTable.x);
    expect(left.map((l) => l.x)).toEqual([r.minX + 2, r.minX + 3]);
  });

  it("the database itself refuses a zoom outside 12 to 19", async () => {
    await expect(
      db.execute(
        sql`insert into map_tile_cache (z, x, y, bytes, size) values (20, 1, 1, '\\x00', 1)`,
      ),
    ).rejects.toThrow();
  });
});

// ── The Map page ───────────────────────────────────────────────────────────

const ATTR = /\s(href|action|src)="([^"]*)"/g;

/**
 * K13: no href, action or src holds a coordinate or a z/x/y. A coordinate is
 * any decimal number; a z/x/y is any run of digit groups separated by / or -
 * (17/74230/50478, 17-74230-50478); and none of the view's own tile numbers
 * appear in any form.
 */
function expectNoPositionInAddresses(html: string, tileNumbers: number[]) {
  const values = [...html.matchAll(ATTR)].map((m) => m[2]!);
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) {
    expect(v, v).not.toMatch(/\d+\.\d+/);
    expect(v, v).not.toMatch(/\d+[/-]\d+[/-]\d+/);
    expect(v, v).not.toMatch(/[?&](lat|lng|lon|z|x|y)=/i);
    for (const n of tileNumbers) expect(v, `${v} holds ${n}`).not.toContain(String(n));
  }
}

/** The view a page draws, read back from its hidden fields. */
function viewOf(html: string) {
  const field = (name: string) => Number(new RegExp(`name="${name}" value="(-?\\d+)"`).exec(html)![1]);
  return { z: field("vz"), x: field("vx"), y: field("vy") };
}

/** Every tap form on a page: its token, size field, picture width and height and band. */
function tapForms(html: string) {
  const bands = [...html.matchAll(/<div class="mapband b(\d+)"[^>]*>(.*?)<\/div><\/div>/g)];
  return bands.flatMap(([, band, inner]) =>
    [...inner!.matchAll(/<form method="post" action="([^"]+)">(.*?)<\/form>/g)].map(([, action, f]) => ({
      band: Number(band),
      action: action!,
      tile: /name="tile" value="([^"]+)"/.exec(f!)![1]!,
      size: Number(/name="size" value="(\d+)"/.exec(f!)![1]),
      src: /<input type="image" src="([^"]+)"/.exec(f!)![1]!,
      width: Number(/ width="(\d+)"/.exec(f!)![1]),
      height: Number(/ height="(\d+)"/.exec(f!)![1]),
    })),
  );
}

const post = (path: string, body: Record<string, string>, c = cookie) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", c).type("form").send(body);

describe("the Map page", () => {
  it("draws the island under the dashboard's header, with no scripts and nothing cached", async () => {
    const res = await request(app).get("/api/team/map").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(EXPECTED_CSP);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text).not.toMatch(/<script/i);
    expect(res.text).toContain('aria-current="page">Map</a>');
    expect(res.text).toContain("© <a href=\"https://www.openstreetmap.org/copyright\"");
    expect(res.text).toContain("OpenStreetMap contributors");
    expect(res.text).toContain('<main class="mappage">');
    expect(viewOf(res.text).z).toBe(12);
  });

  it("draws one set of four pictures per width band; each form carries the size its picture is drawn at", async () => {
    const res = await request(app).get("/api/team/map").set("Cookie", cookie);
    const forms = tapForms(res.text);
    expect(forms).toHaveLength(BANDS.length * 4);
    for (const f of forms) {
      expect(f.size).toBe(f.band);
      expect([f.width, f.height]).toEqual([f.size, f.size]);
      expect(f.action).toBe("/api/team/map/tap");
      expect(f.src).toBe(`/api/team/map-tiles/${f.tile}`);
      expect(readTileToken(f.tile)?.size).toBe(f.size);
    }
    for (const b of BANDS) {
      expect(res.text).toContain(`grid-template-columns:${b.size}px ${b.size}px`);
      expect(res.text).toContain(`<div class="mapband b${b.size}" style="width:${2 * b.size}px;height:${2 * b.size}px">`);
    }
  });

  it("the CSS shows exactly one band at every width, switching where the bands say", async () => {
    const res = await request(app).get("/api/team/map").set("Cookie", cookie);
    expect(res.text).toContain(".mapband{display:none;");
    expect(res.text).toContain(`.mapband.b${BANDS[0].size}{display:block}`);
    for (let i = 1; i < BANDS.length; i++) {
      expect(res.text).toContain(
        `@media (min-width:${BANDS[i]!.minWidth}px){.mapband.b${BANDS[i - 1]!.size}{display:none}.mapband.b${BANDS[i]!.size}{display:block}}`,
      );
    }
  });

  it("has no position in any href, action or src (K13): the island, after a move, an area, a tap and a refusal", async () => {
    const pages: string[] = [];
    pages.push((await request(app).get("/api/team/map").set("Cookie", cookie)).text);
    const v = viewOf(pages[0]!);
    pages.push((await post("/api/team/map", { vz: String(v.z), vx: String(v.x), vy: String(v.y), go: "in" })).text);
    pages.push((await post("/api/team/map", { vz: "12", vx: "0", vy: "0", area: "vaporia" })).text);
    const f = tapForms(pages[2]!).find((x) => x.size === 179)!;
    pages.push((await post("/api/team/map/tap", { tile: f.tile, size: "179", x: "90", y: "90" })).text);
    const r12 = islandTileRange(12);
    const edge = tapForms(
      (await post("/api/team/map", { vz: "12", vx: String(r12.minX), vy: String(r12.minY) })).text,
    ).find((x) => x.size === 256)!;
    pages.push((await post("/api/team/map/tap", { tile: edge.tile, size: "256", x: "1", y: "1" })).text);
    expect(pages[3]).toContain('class="tapped"');
    expect(pages[4]).toContain("outside Syros");
    for (const html of pages) {
      const view = viewOf(html);
      expectNoPositionInAddresses(html, [view.x, view.x + 1, view.y, view.y + 1]);
    }
  });

  it("zooms, pans and jumps to an area by POST, keeping the view over Syros", async () => {
    const start = viewOf((await request(app).get("/api/team/map").set("Cookie", cookie)).text);
    const zoomed = viewOf(
      (await post("/api/team/map", { vz: String(start.z), vx: String(start.x), vy: String(start.y), go: "in" })).text,
    );
    expect(zoomed.z).toBe(start.z + 1);
    const east = viewOf(
      (await post("/api/team/map", { vz: String(zoomed.z), vx: String(zoomed.x), vy: String(zoomed.y), go: "east" })).text,
    );
    expect(east).toEqual({ ...zoomed, x: zoomed.x + 1 });
    for (const a of AREAS) {
      const v = viewOf((await post("/api/team/map", { vz: "12", vx: "0", vy: "0", area: a.key })).text);
      expect(v.z, a.key).toBe(a.zoom);
      // The area is on the map, near the middle.
      const X = lngToTileX(a.lng, v.z) - v.x;
      const Y = latToTileY(a.lat, v.z) - v.y;
      expect(X, a.key).toBeGreaterThan(0.4);
      expect(X, a.key).toBeLessThan(1.6);
      expect(Y, a.key).toBeGreaterThan(0.4);
      expect(Y, a.key).toBeLessThan(1.6);
    }
    // A view nowhere near Syros is pulled back over it.
    const far = viewOf((await post("/api/team/map", { vz: "40", vx: "-9", vy: "99999999" })).text);
    expect(far.z).toBe(19);
    const r = islandTileRange(19);
    expect(far.x).toBeGreaterThanOrEqual(r.minX);
    expect(far.y).toBeLessThanOrEqual(r.maxY);
  });

  it("a bad move form gets the island back with a note, not an error", async () => {
    const res = await post("/api/team/map", { vz: "1e3", vx: "x", vy: "" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("back at the whole island");
    expect(res.headers["content-security-policy"]).toBe(EXPECTED_CSP);
  });

  it("refuses a move or a tap from another site, or without a session", async () => {
    const bad = await request(app)
      .post("/api/team/map")
      .set("Origin", "https://evil.example")
      .set("Cookie", cookie)
      .type("form")
      .send({ vz: "12", vx: "0", vy: "0" });
    expect([bad.status, bad.text]).toEqual([401, '{"error":"not_signed_in"}']);
    const none = await request(app)
      .post("/api/team/map/tap")
      .set("Origin", TEAM_ORIGIN)
      .type("form")
      .send({ tile: "x", size: "179", x: "1", y: "1" });
    expect([none.status, none.text]).toEqual([401, '{"error":"not_signed_in"}']);
  });
});

describe("a tap on the map (test 17)", () => {
  /** The page's own tap form for the picture holding `p`, at this size. */
  async function formFor(p: Position, z: number, size: number) {
    const area = { vz: String(z), vx: "0", vy: "0" };
    // Build the view the server would draw around p, then read its forms.
    const html = (
      await post("/api/team/map", {
        ...area,
        vx: String(Math.round(lngToTileX(p.lng, z)) - 1),
        vy: String(Math.round(latToTileY(p.lat, z)) - 1),
      })
    ).text;
    const t = tileOf(p, z);
    return tapForms(html).find((f) => {
      const ref = readTileToken(f.tile)!;
      return f.size === size && ref.x === t.x && ref.y === t.y && ref.z === z;
    })!;
  }

  for (const z of [13, 16, 19]) {
    it.each(BANDS.map((b) => b.size))(`zoom ${z}: a tap on a %i px picture lands where it should`, async (size) => {
      const f = await formFor(ERMOUPOLI, z, size);
      expect(f).toBeDefined();
      const t = tileOf(ERMOUPOLI, z);
      const px = Math.floor((lngToTileX(ERMOUPOLI.lng, z) - t.x) * size);
      const py = Math.floor((latToTileY(ERMOUPOLI.lat, z) - t.y) * size);
      const res = await request(app)
        .post("/api/team/map/tap")
        .set("Origin", TEAM_ORIGIN)
        .set("Cookie", cookie)
        .send({ tile: f.tile, size: String(f.size), x: String(px), y: String(py) });
      expect(res.status).toBe(200);
      const got = res.body as Position;
      // Within one displayed pixel of the real spot, in tile units.
      const pixel = 1 / size;
      expect(Math.abs(lngToTileX(got.lng, z) - lngToTileX(ERMOUPOLI.lng, z))).toBeLessThanOrEqual(pixel);
      expect(Math.abs(latToTileY(got.lat, z) - latToTileY(ERMOUPOLI.lat, z))).toBeLessThanOrEqual(pixel);
    });
  }

  it("a tap on a picture's far corner and on its first pixel both land inside that picture", async () => {
    const z = 16;
    const f = await formFor(ERMOUPOLI, z, 171);
    const ref = readTileToken(f.tile)!;
    for (const [x, y] of [[0, 1], [1, 0], [170, 170], [171, 0]]) {
      const res = await request(app)
        .post("/api/team/map/tap")
        .set("Origin", TEAM_ORIGIN)
        .set("Cookie", cookie)
        .send({ tile: f.tile, size: "171", x: String(x), y: String(y) });
      const got = res.body as Position;
      const X = lngToTileX(got.lng, z);
      const Y = latToTileY(got.lat, z);
      expect(X).toBeGreaterThanOrEqual(ref.x);
      expect(X).toBeLessThanOrEqual(ref.x + 1);
      expect(Y).toBeGreaterThanOrEqual(ref.y);
      expect(Y).toBeLessThanOrEqual(ref.y + 1);
    }
  });

  it("from the page: shows the spot as text and a marker, zoomed in around it", async () => {
    const f = await formFor(ERMOUPOLI, 15, 179);
    const res = await post("/api/team/map/tap", { tile: f.tile, size: "179", x: "100", y: "60" });
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/You tapped <strong>37\.\d{5}, 24\.\d{5}<\/strong>/);
    expect(res.text).toContain('<span class="pin" style="left:');
    expect(viewOf(res.text).z).toBe(17);
  });

  it("(0, 0) is refused: it's what a browser sends for a picture that never loaded, or a keyboard press", async () => {
    const f = await formFor(ERMOUPOLI, 16, 179);
    const res = await post("/api/team/map/tap", { tile: f.tile, size: "179", x: "0", y: "0" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("say where on the map it was");
    expect(res.text).not.toContain('class="tapped"');
  });

  it("the size posted must be the size the picture was drawn at", async () => {
    const f = await formFor(ERMOUPOLI, 16, 171);
    const res = await post("/api/team/map/tap", { tile: f.tile, size: "179", x: "10", y: "10" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("Nothing was picked");
    expect(res.text).not.toContain('class="tapped"');
  });

  it("a spot outside Syros is refused", async () => {
    // At zoom 12 the island's west-most tile starts west of the island box.
    const r = islandTileRange(12);
    const token = mintTileToken({ z: 12, x: r.minX, y: r.minY, size: 256 });
    const res = await post("/api/team/map/tap", { tile: token, size: "256", x: "1", y: "1" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("outside Syros");
    expect(res.text).not.toContain('class="tapped"');
    const json = await request(app)
      .post("/api/team/map/tap")
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ tile: token, size: "256", x: "1", y: "1" });
    expect(json.status).toBe(400);
    expect(inIsland({ lat: 37.53, lng: 24.78 })).toBe(false);
  });

  it("a tap with an altered, expired or missing token, or a point off the picture, is refused", async () => {
    const f = await formFor(ERMOUPOLI, 16, 164);
    const old = mintTileToken(readTileToken(f.tile)!, Math.floor(Date.now() / 1000) - 26 * 3600);
    for (const body of [
      { tile: f.tile.slice(0, -1) + (f.tile.endsWith("A") ? "B" : "A"), size: "164", x: "5", y: "5" },
      { tile: old, size: "164", x: "5", y: "5" },
      { size: "164", x: "5", y: "5" },
      { tile: f.tile, size: "164", x: "165", y: "5" },
      { tile: f.tile, size: "164", x: "-1", y: "5" },
      { tile: f.tile, size: "164", x: "5.5", y: "5" },
    ]) {
      const res = await post("/api/team/map/tap", body as Record<string, string>);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.text).not.toContain('class="tapped"');
    }
  });
});
