import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// SYC-705 Phase 2, Task 2b.3: the dashboard's own copy of the map files. The
// browser asks only us, and always for a WHOLE file (never a byte range,
// which would show which part of the map is on screen). The real map host is
// never reached: every test hands the routes a stub fetch.

const spies = vi.hoisted(() => ({ logLines: [] as string[] }));

vi.mock("../lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/logger")>();
  const { default: pino } = await import("pino");
  const logger = pino(
    { level: "trace", redact: actual.REDACT_PATHS, serializers: actual.LOG_SERIALIZERS },
    { write: (line: string) => void spies.logLines.push(line) },
  );
  return { ...actual, logger };
});

import { db, mapDataFilesTable, pool } from "@workspace/db";
import app from "../app";
import { consume, _resetBucketForTests } from "../lib/limits";
import { _resetMapDataForTests } from "../lib/mapData/store";
import { MAP_DATA_BUCKET, MAP_DATA_LIMIT, MAP_DATA_WINDOW_MS } from "../middlewares/rateLimit";
import { removeTestPerson } from "../test/removeTestPerson";
import { STRICT_CSP } from "../test/wideCsp";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";
import { setMapSourceForTests } from "./teamMapData";

const KEY = "vitest-mapdata-key-0123456789abcdef-0123456789";
const CURRENT = 3;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const TILES = Buffer.alloc(5000, 7);
const FONT = Buffer.from("font-bytes");
const SPRITE_JSON = Buffer.from('{"a":1}');
const SPRITE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const FILES: Record<string, Buffer> = {
  "syros.pmtiles": TILES,
  "fonts-app/Noto Sans Regular/0-255.pbf": FONT,
  "sprites/light.json": SPRITE_JSON,
  "sprites/light.png": SPRITE_PNG,
};

let hostCalls: string[] = [];
let filesDown = false;
function stubFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    hostCalls.push(url);
    const u = new URL(url);
    if (u.pathname === "/current.json") return Response.json({ version: CURRENT });
    if (filesDown) throw new Error("offline");
    const m = u.pathname.match(/^\/v(\d+)\/(.+)$/);
    if (!m) return new Response("no", { status: 404 });
    const path = decodeURIComponent(m[2]!);
    if (path === "manifest.json") {
      const out: Record<string, { bytes: number; sha256: string }> = {};
      for (const [p, b] of Object.entries(FILES)) out[p] = { bytes: b.length, sha256: sha(b) };
      return Response.json({ version: Number(m[1]), files: out });
    }
    const b = FILES[path];
    return b ? new Response(new Uint8Array(b)) : new Response("no", { status: 404 });
  }) as typeof fetch;
}

let alice: Signed;
let bob: Signed;
let guardian: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  alice = await signedPerson("mapdata-alice", ["staff"]);
  bob = await signedPerson("mapdata-bob", ["staff"]);
  guardian = await guardianOn("mapdata-guardian", [await newColony("mapdata")]);
});

beforeEach(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  spies.logLines.length = 0;
  hostCalls = [];
  filesDown = false;
  _resetMapDataForTests();
  await db.delete(mapDataFilesTable);
  setMapSourceForTests({ fetch: stubFetch() });
  await _resetBucketForTests(MAP_DATA_BUCKET);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  setMapSourceForTests(undefined);
  await _resetBucketForTests(MAP_DATA_BUCKET);
  await db.delete(mapDataFilesTable);
  for (const p of [alice, bob, guardian]) await removeTestPerson(p.email);
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const get = (path: string, who?: Signed) => {
  const t = request(app).get(`/api/team/map-data/${path}`).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });
  return who ? t.set("Cookie", who.cookie) : t;
};

const FOREVER = "private, max-age=31536000, immutable";
/** The style is built from our code, so it is not immutable: a deploy may change it under the same version. */
const HOUR = "private, max-age=3600";

describe("the current version", () => {
  it("answers { version }, no-store, under the strict security header", async () => {
    const res = await request(app).get("/api/team/map-data/current").set("Cookie", alice.cookie);
    expect([res.status, res.body]).toEqual([200, { version: CURRENT }]);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-security-policy"]).toBe(STRICT_CSP);
  });
});

describe("the map file", () => {
  it("ignores Range header, sends 200 whole file with Accept-Ranges: none", async () => {
    const res = await get(`v${CURRENT}/syros.pmtiles`, alice).set("Range", "bytes=0-99");
    expect(res.status).toBe(200);
    expect(res.headers["content-range"]).toBeUndefined();
    expect(res.headers["accept-ranges"]).toBe("none");
    expect(res.headers["content-length"]).toBe(String(TILES.length));
    expect(res.headers["content-type"]).toBe("application/vnd.pmtiles");
    expect(res.headers["cache-control"]).toBe(FOREVER);
    expect(res.headers["content-security-policy"]).toBe(STRICT_CSP);
    expect(Buffer.compare(res.body as Buffer, TILES)).toBe(0);
    // A second ask, from memory, is whole too.
    const again = await get(`v${CURRENT}/syros.pmtiles`, alice).set("Range", "bytes=10-20");
    expect([again.status, (again.body as Buffer).length]).toEqual([200, TILES.length]);
    expect(again.headers["content-range"]).toBeUndefined();
  });

  it("answers a plain request the same way", async () => {
    const res = await get(`v${CURRENT}/syros.pmtiles`, alice);
    expect([res.status, res.headers["accept-ranges"], (res.body as Buffer).length]).toEqual([200, "none", TILES.length]);
  });
});

describe("fonts and sprites", () => {
  it("serves a font range whole, as protobuf, and ignores Range", async () => {
    const res = await get(`v${CURRENT}/fonts/Noto%20Sans%20Regular/0-255.pbf`, alice).set("Range", "bytes=0-2");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/x-protobuf");
    expect(res.headers["accept-ranges"]).toBe("none");
    expect(res.headers["content-range"]).toBeUndefined();
    expect(res.headers["cache-control"]).toBe(FOREVER);
    expect(Buffer.compare(res.body as Buffer, FONT)).toBe(0);
  });

  it("serves the sprite's index as JSON and its picture as a PNG", async () => {
    const j = await get(`v${CURRENT}/sprites/light.json`, alice);
    expect([j.status, j.headers["content-type"]]).toEqual([200, "application/json"]);
    expect(j.headers["accept-ranges"]).toBe("none");
    expect(Buffer.compare(j.body as Buffer, SPRITE_JSON)).toBe(0);
    const p = await get(`v${CURRENT}/sprites/light.png`, alice).set("Range", "bytes=0-1");
    expect([p.status, p.headers["content-type"]]).toEqual([200, "image/png"]);
    expect(p.headers["content-range"]).toBeUndefined();
    expect(Buffer.compare(p.body as Buffer, SPRITE_PNG)).toBe(0);
  });

  it("unknown font range is 404 without a fetch", async () => {
    const res = await get(`v${CURRENT}/fonts/Noto%20Sans%20Regular/512-767.pbf`, alice);
    expect([res.status, res.headers["cache-control"]]).toEqual([404, "no-store"]);
    expect(JSON.parse((res.body as Buffer).toString())).toEqual({ error: "Not found" });
    for (const p of [
      `v${CURRENT}/fonts/Noto%20Sans%20Bold/0-255.pbf`,
      `v${CURRENT}/fonts/..%2Fx/0-255.pbf`,
      `v${CURRENT}/sprites/nope.json`,
      `v${CURRENT}/sprites/..%2Flight.json`,
    ]) {
      expect((await get(p, alice)).status, p).toBe(404);
    }
    expect(hostCalls).toEqual([]);
  });
});

describe("the version in the address", () => {
  it.each(["v0", "vx", "v-1", "v1.5", "v03x", "v"])("%s is a 404, no-store, with nothing fetched", async (v) => {
    const res = await get(`${v}/syros.pmtiles`, alice);
    expect([res.status, res.headers["cache-control"]]).toEqual([404, "no-store"]);
    expect(hostCalls).toEqual([]);
  });

  it("a version two behind the current one is a 404 with no host fetch", async () => {
    for (const p of [`v${CURRENT - 2}/syros.pmtiles`, `v${CURRENT - 2}/style-en.json`]) {
      hostCalls = [];
      const res = await get(p, alice);
      expect([res.status, res.headers["cache-control"]], p).toEqual([404, "no-store"]);
      expect(hostCalls.filter((u) => !u.endsWith("/current.json")), p).toEqual([]);
    }
  });

  it("a version above the current one is a 404", async () => {
    const res = await get(`v${CURRENT + 1}/syros.pmtiles`, alice);
    expect([res.status, res.headers["cache-control"]]).toEqual([404, "no-store"]);
  });

  it("a file the host will not give is a 503 with no-store, and the warning names only the version and path", async () => {
    filesDown = true;
    const res = await get(`v${CURRENT}/syros.pmtiles`, alice).set("Range", "bytes=5-9");
    expect([res.status, res.headers["cache-control"]]).toEqual([503, "no-store"]);
    expect(JSON.parse((res.body as Buffer).toString())).toEqual({ error: "Map data unavailable" });
    const warn = spies.logLines.map((l) => JSON.parse(l)).find((l) => l.msg === "map data unavailable");
    expect(warn).toMatchObject({ version: CURRENT, path: "syros.pmtiles" });
  });
});

describe("the style", () => {
  const style = async (v: number | string, lang: string, who: Signed | undefined = alice) => {
    const res = await get(`v${v}/style-${lang}.json`, who);
    return { res, json: res.status === 200 ? JSON.parse((res.body as Buffer).toString()) : null };
  };

  it("has relative glyph and sprite paths for this version and Greek labels for el", async () => {
    const en = await style(CURRENT, "en");
    expect(en.res.status).toBe(200);
    expect(en.res.headers["content-type"]).toMatch(/^application\/json/);
    expect(en.res.headers["cache-control"]).toBe(HOUR);
    expect(en.res.headers["cache-control"]).not.toMatch(/immutable/);
    expect(en.json.glyphs).toBe(`/api/team/map-data/v${CURRENT}/fonts/{fontstack}/{range}.pbf`);
    expect(en.json.sprite).toBe(`/api/team/map-data/v${CURRENT}/sprites/light`);
    expect(en.json.sources.protomaps.url).toBe(`pmtiles://syros-v${CURRENT}.pmtiles`);
    const el = await style(CURRENT, "el");
    expect(el.res.status).toBe(200);
    expect(JSON.stringify(el.json.layers)).not.toBe(JSON.stringify(en.json.layers));
    expect(JSON.stringify(el.json.layers)).toContain("name:el");
  });

  it("is built only for a lang we have and a version we would serve", async () => {
    expect((await style(CURRENT, "fr")).res.status).toBe(404);
    expect((await style(CURRENT, "EN")).res.status).toBe(404);
    expect((await style(CURRENT + 1, "en")).res.status).toBe(404);
    expect((await style(0, "en")).res.status).toBe(404);
    expect((await style("x", "en")).res.status).toBe(404);
  });
});

describe("who may have map data", () => {
  it("refuses signed-out with 401 and STRICT_CSP", async () => {
    for (const p of ["current", `v${CURRENT}/syros.pmtiles`, `v${CURRENT}/style-en.json`]) {
      const res = await get(p);
      expect([res.status, res.headers["cache-control"], res.headers["content-security-policy"]], p).toEqual([
        401,
        "no-store",
        STRICT_CSP,
      ]);
    }
    expect(hostCalls).toEqual([]);
  });

  it("a cat guardian may load map data", async () => {
    for (const p of [`v${CURRENT}/syros.pmtiles`, `v${CURRENT}/style-el.json`, `v${CURRENT}/sprites/light.json`]) {
      expect((await get(p, guardian)).status, p).toBe(200);
    }
    expect((await request(app).get("/api/team/map-data/current").set("Cookie", guardian.cookie)).status).toBe(200);
  });
});

describe("601 requests in 10 minutes", () => {
  it("the 601st request in 10 minutes is 429, no-store, per person", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    expect([MAP_DATA_LIMIT, MAP_DATA_WINDOW_MS]).toEqual([600, 600_000]);
    // 599 are counted straight into the limiter; two real requests cross the line.
    for (let i = 0; i < MAP_DATA_LIMIT - 1; i++)
      await consume(MAP_DATA_BUCKET, `person:${alice.id}`, MAP_DATA_LIMIT, MAP_DATA_WINDOW_MS);
    expect((await get(`v${CURRENT}/sprites/light.json`, alice)).status).toBe(200);
    const over = await get(`v${CURRENT}/sprites/light.json`, alice);
    expect([over.status, over.headers["cache-control"], over.headers["content-security-policy"]]).toEqual([429, "no-store", STRICT_CSP]);
    expect(JSON.parse((over.body as Buffer).toString())).toEqual({ error: "Too many map requests. Please try again in a few minutes." });
    expect((await get(`v${CURRENT}/sprites/light.json`, bob)).status).toBe(200);
  });
});

describe("the request log", () => {
  it("never logs a byte range", async () => {
    for (const p of [`v${CURRENT}/syros.pmtiles`, `v${CURRENT}/fonts/Noto%20Sans%20Regular/0-255.pbf`]) {
      spies.logLines.length = 0;
      await get(p, alice).set("Range", "bytes=1234567-1239999");
      expect(spies.logLines.length).toBeGreaterThan(0);
      for (const line of spies.logLines) {
        expect(line).not.toMatch(/bytes=/i);
        expect(line).not.toMatch(/\brange\b/i);
        expect(line).not.toMatch(/1234567|1239999/);
      }
    }
  });
});
