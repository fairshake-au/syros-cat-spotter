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
  viewAround,
  viewTiles,
  type Position,
} from "../lib/mapTiles/geometry";
import { mintTileToken, readTileToken } from "../lib/mapTiles/tileToken";
import {
  FETCH_TIMEOUT_MS,
  REFRESH_AFTER_MS,
  tileFetchesSettled,
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

/** A token with one character changed in the middle (never only spare bits). */
const altered = (t: string) => t.slice(0, 20) + (t[20] === "A" ? "B" : "A") + t.slice(21);

const picture = (token: string, c = cookie) =>
  request(app).get(`/api/team/map-tiles/${token}`).set("Cookie", c);

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await removeTestPerson(SUSAN);
  await removeTestPerson(VERA);
  const susan = await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest" });
  const vera = await addPerson({ email: VERA, name: "Vera", addedBy: "cli:vitest", roles: ["vet"] });
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
    const token = mintTileToken({ ...viewAround(ERMOUPOLI, 16), size: 179 });
    const res = await request(app).get(`/api/team/map-tiles/${token}`);
    expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("needs the team role: a vet (no team role) gets the same 401", async () => {
    const token = mintTileToken({ ...viewAround(ERMOUPOLI, 16), size: 179 });
    const res = await picture(token, volunteerCookie);
    expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("needs view_exact_location: a team member without it gets the same 401", async () => {
    denied.cap = "view_exact_location";
    const token = mintTileToken({ ...viewAround(ERMOUPOLI, 16), size: 179 });
    const res = await picture(token);
    expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a picture already cached is still refused without a session (the cache sits behind the check)", async () => {
    const token = mintTileToken({ ...viewAround(ERMOUPOLI, 16), size: 179 });
    expect((await picture(token)).status).toBe(200);
    const res = await request(app).get(`/api/team/map-tiles/${token}`);
    expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    expect(res.headers["content-type"]).not.toMatch(/image/);
  });
});

describe("map pictures: what is sent", () => {
  it.each(BANDS.map((b) => b.size))(
    "the %i px band's picture is exactly twice that square, private to the browser, under the dashboard's own security header",
    async (size) => {
      const token = mintTileToken({ ...viewAround(ERMOUPOLI, 16), size: size as never });
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
      expect([meta.width, meta.height, meta.format]).toEqual([2 * size, 2 * size, "png"]);
    },
  );

  it("joins the view's four tiles in their places", async () => {
    // Each tile a different colour; the picture's quarters must match.
    const colours = [10, 80, 160, 240];
    const v = viewAround(ERMOUPOLI, 17);
    const tiles = viewTiles(v);
    const pngs = await Promise.all(colours.map(makePng));
    fetchSpy.mockImplementation(async (url) => {
      const i = tiles.findIndex((t) => String(url).endsWith(`/${t.z}/${t.x}/${t.y}.png`));
      return new Response(pngs[i]!, { status: 200 });
    });
    const res = await picture(mintTileToken({ ...v, size: 256 })).buffer(true);
    const { data, info } = await sharp(res.body as Buffer).raw().toBuffer({ resolveWithObject: true });
    const red = (x: number, y: number) => data[(y * info.width + x) * info.channels]!;
    expect([red(128, 128), red(384, 128), red(128, 384), red(384, 384)]).toEqual(colours);
  });

  it("asks OpenStreetMap once per tile, saying who we are, with a 10-second limit; then serves from the cache", async () => {
    const v = viewAround(ERMOUPOLI, 17);
    for (const size of [179, 256, 144]) {
      expect((await picture(mintTileToken({ ...v, size: size as never }))).status).toBe(200);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    const urls = fetchSpy.mock.calls.map((c) => String(c[0])).sort();
    expect(urls).toEqual(
      viewTiles(v).map((t) => `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`).sort(),
    );
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/catspotters\.com/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(FETCH_TIMEOUT_MS).toBe(10_000);
    const rows = await db.select().from(mapTileCacheTable);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.size).toBe(png.length);
  });

  it("five bands asking at once still fetch each tile once", async () => {
    fetchSpy.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return new Response(png, { status: 200 });
    });
    const v = viewAround(ERMOUPOLI, 18);
    const answers = await Promise.all(
      BANDS.map((b) => picture(mintTileToken({ ...v, size: b.size as never }))),
    );
    expect(answers.map((a) => a.status)).toEqual(BANDS.map(() => 200));
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("refuses a picture outside the island box or outside zooms 12 to 19, without fetching anything", async () => {
    const r16 = islandTileRange(16);
    const r12 = islandTileRange(12);
    const outside = [
      { z: 16, x: r16.minX - 1, y: r16.minY }, // its west column is off Syros
      { z: 16, x: r16.maxX, y: r16.minY }, // its east column
      { z: 16, x: r16.minX, y: r16.minY - 1 }, // its north row
      { z: 16, x: r16.minX, y: r16.maxY }, // its south row
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
    const good = mintTileToken({ ...viewAround(ERMOUPOLI, 16), size: 179 });
    const t = tileOf(ERMOUPOLI, 16);
    for (const bad of [
      `${t.z}/${t.x}/${t.y}.png`, // the z/x/y shape is not a route at all
      `${t.z}-${t.x}-${t.y}`,
      altered(good),
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
    const t = { ...viewAround(ERMOUPOLI, 16), size: 179 as const };
    const old = mintTileToken(t, Math.floor(Date.now() / 1000) - 26 * 3600);
    const res = await picture(old);
    expect([res.status, res.headers["cache-control"]]).toEqual([404, "no-store"]);
    expect(readTileToken(old)).toBeNull();
  });

  it("when the provider fails and nothing is cached: 503, no-store, nothing stored", async () => {
    const v = viewAround(ERMOUPOLI, 18);
    const valid = png;
    for (const failure of [
      async () => new Response("nope", { status: 500 }),
      async () => new Response("<html>not a picture</html>", { status: 200 }),
      // A PNG's first bytes, then rubbish: not kept for 30 days.
      async () => new Response(Buffer.concat([valid.subarray(0, 40), Buffer.alloc(200, 7)]), { status: 200 }),
      // A real PNG of the wrong size.
      async () => new Response(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).png().toBuffer(), { status: 200 }),
      async () => {
        throw new TypeError("fetch failed");
      },
    ]) {
      fetchSpy.mockImplementation(failure);
      const res = await picture(mintTileToken({ ...v, size: 256 }));
      expect([res.status, res.headers["cache-control"]]).toEqual([503, "no-store"]);
      expect(res.text).toBe('{"error":"Map picture unavailable"}');
    }
    expect(await db.select().from(mapTileCacheTable)).toHaveLength(0);
  });

  it("a tile the provider can't give is left blank; the rest of the map still shows", async () => {
    const v = viewAround(ERMOUPOLI, 18);
    const [first] = viewTiles(v);
    fetchSpy.mockImplementation(async (url) =>
      String(url).endsWith(`/${first!.z}/${first!.x}/${first!.y}.png`)
        ? new Response("no", { status: 500 })
        : new Response(png, { status: 200 }),
    );
    const res = await picture(mintTileToken({ ...v, size: 179 }));
    expect(res.status).toBe(200);
    expect(await db.select().from(mapTileCacheTable)).toHaveLength(3);
  });

  it("an error while drawing the picture is answered no-store", async () => {
    const v = viewAround(ERMOUPOLI, 19);
    // Cached rows that pass the database's checks but aren't pictures.
    await db.insert(mapTileCacheTable).values(
      viewTiles(v).map((t) => ({ ...t, bytes: Buffer.from("not a png"), size: 9 })),
    );
    const res = await picture(mintTileToken({ ...v, size: 179 }));
    expect(res.status).toBe(500);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-type"]).not.toMatch(/image/);
  });

  it("after 30 days sends the old picture at once and fetches again behind it, keeping the old one if that fails", async () => {
    const v = viewAround(ERMOUPOLI, 19);
    const token = mintTileToken({ ...v, size: 256 });
    expect((await picture(token)).status).toBe(200);
    const old = new Date(Date.now() - REFRESH_AFTER_MS - 60_000);
    await db.update(mapTileCacheTable).set({ fetchedAt: old });

    fetchSpy.mockImplementation(async () => new Response("x", { status: 503 }));
    expect((await picture(token)).status).toBe(200);
    await tileFetchesSettled();
    for (const row of await db.select().from(mapTileCacheTable)) {
      expect(row.fetchedAt.getTime()).toBe(old.getTime());
      expect(Buffer.compare(row.bytes, png)).toBe(0);
    }

    const newer = await makePng(10);
    okFetch(newer);
    expect((await picture(token)).status).toBe(200);
    await tileFetchesSettled();
    for (const row of await db.select().from(mapTileCacheTable)) {
      expect(row.fetchedAt.getTime()).toBeGreaterThan(old.getTime());
      expect(Buffer.compare(row.bytes, newer)).toBe(0);
    }
    // Four first fetches, four failed refreshes, four good ones.
    expect(fetchSpy).toHaveBeenCalledTimes(12);
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

/** Every band's tap form on a page: its token, size field, picture size and band. */
function tapForms(html: string) {
  const bands = [...html.matchAll(/<div class="mapband b(\d+)"[^>]*>(.*?)<\/div>/g)];
  return bands.map(([, band, inner]) => {
    const f = /<form method="post" action="([^"]+)">(.*?)<\/form>/.exec(inner!)!;
    return {
      band: Number(band),
      action: f[1]!,
      view: /name="view" value="([^"]+)"/.exec(f[2]!)![1]!,
      size: Number(/name="size" value="(\d+)"/.exec(f[2]!)![1]),
      src: /<input type="image" src="([^"]+)"/.exec(f[2]!)![1]!,
      width: Number(/ width="(\d+)"/.exec(f[2]!)![1]),
      height: Number(/ height="(\d+)"/.exec(f[2]!)![1]),
    };
  });
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

  it("draws one picture in one form per width band; each form carries the size its picture is drawn at", async () => {
    const res = await request(app).get("/api/team/map").set("Cookie", cookie);
    const forms = tapForms(res.text);
    expect(forms.map((f) => f.band)).toEqual(BANDS.map((b) => b.size));
    expect(res.text.match(/<input type="image"/g)).toHaveLength(BANDS.length);
    const view = viewOf(res.text);
    for (const f of forms) {
      expect(f.size).toBe(f.band);
      expect([f.width, f.height]).toEqual([2 * f.size, 2 * f.size]);
      expect(f.action).toBe("/api/team/map/tap");
      expect(f.src).toBe(`/api/team/map-tiles/${f.view}`);
      expect(readTileToken(f.view)).toEqual({ ...view, size: f.size });
      expect(res.text).toContain(`<div class="mapband b${f.size}" style="width:${2 * f.size}px;height:${2 * f.size}px">`);
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
    pages.push((await post("/api/team/map/tap", { view: f.view, size: "179", x: "190", y: "190" })).text);
    const r12 = islandTileRange(12);
    const edge = tapForms(
      (await post("/api/team/map", { vz: "12", vx: String(r12.minX), vy: String(r12.minY) })).text,
    ).find((x) => x.size === 256)!;
    pages.push((await post("/api/team/map/tap", { view: edge.view, size: "256", x: "1", y: "1" })).text);
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
      .send({ view: "x", size: "179", x: "1", y: "1" });
    expect([none.status, none.text]).toEqual([401, '{"error":"not_signed_in"}']);
  });
});

describe("a tap on the map (test 17)", () => {
  /** The page's own tap form at this size, for the view the server draws around p. */
  async function formFor(p: Position, z: number, size: number) {
    const html = (
      await post("/api/team/map", {
        vz: String(z),
        vx: String(Math.round(lngToTileX(p.lng, z)) - 1),
        vy: String(Math.round(latToTileY(p.lat, z)) - 1),
      })
    ).text;
    const f = tapForms(html).find((x) => x.size === size)!;
    return { ...f, picture: readTileToken(f.view)! };
  }

  /** Where p is drawn on that picture, in its displayed pixels. */
  const pixelOf = (p: Position, f: { picture: { z: number; x: number; y: number }; size: number }) => ({
    x: Math.floor((lngToTileX(p.lng, f.picture.z) - f.picture.x) * f.size),
    y: Math.floor((latToTileY(p.lat, f.picture.z) - f.picture.y) * f.size),
  });

  const tapJson = (body: Record<string, string>) =>
    request(app).post("/api/team/map/tap").set("Origin", TEAM_ORIGIN).set("Cookie", cookie).send(body);

  for (const z of [13, 16, 19]) {
    it.each(BANDS.map((b) => b.size))(`zoom ${z}: a tap on the %i px band's picture lands where it should`, async (size) => {
      const f = await formFor(ERMOUPOLI, z, size);
      const at = pixelOf(ERMOUPOLI, f);
      expect(at.x).toBeGreaterThan(0);
      expect(at.x).toBeLessThan(2 * size);
      const res = await tapJson({ view: f.view, size: String(size), x: String(at.x), y: String(at.y) });
      expect(res.status).toBe(200);
      const got = res.body as Position;
      // Within one displayed pixel of the real spot, in tile units.
      const pixel = 1 / size;
      expect(Math.abs(lngToTileX(got.lng, z) - lngToTileX(ERMOUPOLI.lng, z))).toBeLessThanOrEqual(pixel);
      expect(Math.abs(latToTileY(got.lat, z) - latToTileY(ERMOUPOLI.lat, z))).toBeLessThanOrEqual(pixel);
    });
  }

  it("taps at the picture's corners and across the seam between its tiles land inside the view, in order", async () => {
    const z = 16;
    const size = 171;
    const f = await formFor(ERMOUPOLI, z, size);
    const span = 2 * size;
    const xs: number[] = [];
    for (const [x, y] of [[0, 1], [1, 0], [size - 1, 50], [size, 50], [span - 1, span - 1], [span, 0]]) {
      const res = await tapJson({ view: f.view, size: String(size), x: String(x), y: String(y) });
      expect(res.status, `${x},${y}`).toBe(200);
      const got = res.body as Position;
      const X = lngToTileX(got.lng, z);
      const Y = latToTileY(got.lat, z);
      expect(X).toBeGreaterThanOrEqual(f.picture.x);
      expect(X).toBeLessThanOrEqual(f.picture.x + 2);
      expect(Y).toBeGreaterThanOrEqual(f.picture.y);
      expect(Y).toBeLessThanOrEqual(f.picture.y + 2);
      xs.push(X);
    }
    // The pixels either side of the seam are one pixel apart.
    expect(xs[3]! - xs[2]!).toBeCloseTo(1 / size, 9);
  });

  it("from the page: shows the spot as text and a marker, zoomed in around it", async () => {
    const f = await formFor(ERMOUPOLI, 15, 179);
    const at = pixelOf(ERMOUPOLI, f);
    const res = await post("/api/team/map/tap", { view: f.view, size: "179", x: String(at.x), y: String(at.y) });
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/You tapped <strong>37\.4\d{4}, 24\.94\d{3}<\/strong>/);
    expect(res.text).toContain('<span class="pin" style="left:');
    expect(res.text).toContain(`Point ${at.x}, ${at.y} on a 358 px map picture.`);
    expect(viewOf(res.text).z).toBe(17);
  });

  it("(0, 0) is refused: it's what a browser sends for a picture that never loaded, or a keyboard press", async () => {
    const f = await formFor(ERMOUPOLI, 16, 179);
    const res = await post("/api/team/map/tap", { view: f.view, size: "179", x: "0", y: "0" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("say where on the map it was");
    expect(res.text).not.toContain('class="tapped"');
  });

  it("the size posted must be the size the picture was drawn at", async () => {
    const f = await formFor(ERMOUPOLI, 16, 171);
    const res = await post("/api/team/map/tap", { view: f.view, size: "179", x: "10", y: "10" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("Nothing was picked");
    expect(res.text).not.toContain('class="tapped"');
  });

  it("a spot outside Syros is refused", async () => {
    // At zoom 12 the island's west-most tile starts west of the island box.
    const r = islandTileRange(12);
    const token = mintTileToken({ z: 12, x: r.minX, y: r.minY, size: 256 });
    const res = await post("/api/team/map/tap", { view: token, size: "256", x: "1", y: "1" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("outside Syros");
    expect(res.text).not.toContain('class="tapped"');
    const json = await tapJson({ view: token, size: "256", x: "1", y: "1" });
    expect(json.status).toBe(400);
  });

  it("a tap with an altered, expired or missing token, or a point off the picture, is refused", async () => {
    const f = await formFor(ERMOUPOLI, 16, 164);
    const old = mintTileToken(f.picture, Math.floor(Date.now() / 1000) - 26 * 3600);
    for (const body of [
      { view: altered(f.view), size: "164", x: "5", y: "5" },
      { view: old, size: "164", x: "5", y: "5" },
      { size: "164", x: "5", y: "5" },
      { view: f.view, size: "164", x: "329", y: "5" },
      { view: f.view, size: "164", x: "-1", y: "5" },
      { view: f.view, size: "164", x: "5.5", y: "5" },
    ]) {
      const res = await post("/api/team/map/tap", body as Record<string, string>);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.text).not.toContain('class="tapped"');
    }
  });
});
