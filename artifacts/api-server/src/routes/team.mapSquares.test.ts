import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// SYC-396 PR 1.5 (spec §6.3; plan Task 1.5.1; Decision 7): the island map's
// squares. The page asks in a signed-in POST for the squares it can see
// (square numbers in the body only), gets a token for each square on Syros,
// and fetches each by its token alone. At most 64 squares per call, and 300
// squares per PERSON per 10 minutes. The request log never keeps a square's
// token.

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

import sharp from "sharp";
import { db, mapTileCacheTable, pool } from "@workspace/db";
import app from "../app";
import router from "./index";
import { consume, _resetBucketForTests } from "../lib/limits";
import { islandTileRange, MAX_ZOOM, MIN_ZOOM } from "../lib/mapTiles/geometry";
import { mintSquareToken, mintTileToken, TOKEN_RE } from "../lib/mapTiles/tileToken";
import { _resetTileBackoffForTests } from "../lib/mapTiles/tileCache";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import {
  MAP_SQUARE_TOKENS_BUCKET,
  MAP_SQUARE_TOKENS_LIMIT,
  MAP_SQUARES_BUCKET,
  MAP_SQUARES_LIMIT,
  MAP_SQUARES_WINDOW_MS,
} from "../middlewares/rateLimit";
import { removeTestPerson } from "../test/removeTestPerson";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";
import { MAX_SQUARES_PER_CALL } from "./teamMap";

const KEY = "vitest-mapsquares-key-0123456789abcdef-01234567";
let alice: Signed;
let bob: Signed;
let guardian: Signed;

const Z = 14;
const R = islandTileRange(Z);

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  alice = await signedPerson("mapsquares-alice", ["staff"]);
  bob = await signedPerson("mapsquares-bob", ["staff"]);
  guardian = await guardianOn("mapsquares-guardian", [await newColony("mapsquares")]);
});

beforeEach(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  spies.logLines.length = 0;
  await _resetBucketForTests(MAP_SQUARES_BUCKET);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await _resetBucketForTests(MAP_SQUARES_BUCKET);
  await db.delete(mapTileCacheTable);
  for (const p of [alice, bob, guardian]) await removeTestPerson(p.email);
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const ask = (who: Signed | undefined, body: unknown) => {
  const t = request(app).post("/api/team/map-squares").set("Origin", TEAM_ORIGIN).set("Accept", "application/json");
  return (who ? t.set("Cookie", who.cookie) : t).send(body as object);
};

const square = (who: Signed | undefined, token: string) => {
  const t = request(app).get(`/api/team/map-square/${token}`);
  return who ? t.set("Cookie", who.cookie) : t;
};

/** A real 256 px PNG, as OpenStreetMap would send. */
async function fakeOsm(): Promise<void> {
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#cde" } }).png().toBuffer();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(png, { status: 200 }));
}

describe("the token request", () => {
  it("answers a token for each square on Syros, and none for a square off it", async () => {
    // One column and one row past the island on each side.
    const res = await ask(alice, { z: Z, xMin: R.minX - 1, xMax: R.maxX + 1, yMin: R.minY - 1, yMax: R.minY + 1 });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const keys = Object.keys(res.body.tokens);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      const [z, x, y] = k.split("/").map(Number);
      expect(z).toBe(Z);
      expect(x).toBeGreaterThanOrEqual(R.minX);
      expect(x).toBeLessThanOrEqual(R.maxX);
      expect(y).toBeGreaterThanOrEqual(R.minY);
      expect(res.body.tokens[k]).toMatch(TOKEN_RE);
    }
    expect(keys).not.toContain(`${Z}/${R.minX - 1}/${R.minY}`);
    expect(keys).not.toContain(`${Z}/${R.maxX + 1}/${R.minY}`);
    expect(keys).not.toContain(`${Z}/${R.minX}/${R.minY - 1}`);
  });

  it("a range wholly off Syros gets no tokens at all", async () => {
    const res = await ask(alice, { z: Z, xMin: 0, xMax: 3, yMin: 0, yMax: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tokens: {} });
  });

  it("refuses the 65th square in one call, whole", async () => {
    expect(MAX_SQUARES_PER_CALL).toBe(64);
    const ok = await ask(alice, { z: 19, xMin: 0, xMax: 7, yMin: 0, yMax: 7 }); // 64
    expect(ok.status).toBe(200);
    const over = await ask(alice, { z: 19, xMin: 0, xMax: 12, yMin: 0, yMax: 4 }); // 65
    expect([over.status, over.body]).toEqual([400, { error: "too_many_squares" }]);
  });

  it("takes square numbers only: never a latitude or longitude, nothing fractional, nothing extra", async () => {
    const bad: unknown[] = [
      { lat: 37.44, lng: 24.94 },
      { z: Z, lat: 37.44, lng: 24.94 },
      { z: Z, xMin: R.minX, xMax: R.minX, yMin: R.minY, yMax: R.minY, lat: 37.44 },
      { z: Z, xMin: 37.44, xMax: 37.44, yMin: 24.94, yMax: 24.94 },
      { z: Z, xMin: String(R.minX), xMax: R.minX, yMin: R.minY, yMax: R.minY },
      { z: MIN_ZOOM - 1, xMin: 0, xMax: 0, yMin: 0, yMax: 0 },
      { z: MAX_ZOOM + 1, xMin: 0, xMax: 0, yMin: 0, yMax: 0 },
      { z: Z, xMin: R.minX + 1, xMax: R.minX, yMin: R.minY, yMax: R.minY },
      { z: Z, xMin: -1, xMax: 0, yMin: 0, yMax: 0 },
      [],
    ];
    for (const body of bad) {
      const res = await ask(alice, body);
      expect([res.status, JSON.stringify(body)]).toEqual([400, JSON.stringify(body)]);
      expect(res.body.tokens).toBeUndefined();
    }
  });

  it("ignores anything in the address: the range comes from the body alone", async () => {
    const res = await request(app)
      .post(`/api/team/map-squares?z=${Z}&xMin=${R.minX}&xMax=${R.minX}&yMin=${R.minY}&yMax=${R.minY}`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", alice.cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.tokens).toBeUndefined();
  });

  it("is the team's only: a cat guardian gets the 403, nobody signed in the 401, a foreign page the 401", async () => {
    const body = { z: Z, xMin: R.minX, xMax: R.minX, yMin: R.minY, yMax: R.minY };
    const g = await ask(guardian, body);
    expect([g.status, g.body]).toEqual([403, { error: "forbidden" }]);
    expect((await ask(undefined, body)).status).toBe(401);
    const foreign = await request(app)
      .post("/api/team/map-squares")
      .set("Origin", "https://evil.example")
      .set("Cookie", alice.cookie)
      .send(body);
    expect(foreign.status).toBe(401);
  });
});

describe("a square by its token", () => {
  it("serves the square, cached privately for a day; a 2x2 picture's token and junk are 404", async () => {
    await fakeOsm();
    _resetTileBackoffForTests();
    const res = await ask(alice, { z: Z, xMin: R.minX, xMax: R.minX + 1, yMin: R.minY + 1, yMax: R.minY + 1 });
    const [first] = Object.values(res.body.tokens as Record<string, string>);
    const got = await square(alice, first!);
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.headers["cache-control"]).toBe("private, max-age=86400");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");

    const picture = mintTileToken({ z: Z, x: R.minX, y: R.minY + 1, size: 256 });
    for (const t of [picture, "nope", "A".repeat(59)]) {
      const r = await square(alice, t);
      expect([r.status, r.headers["cache-control"]], t).toEqual([404, "no-store"]);
    }
  });

  it("a square off Syros is 404 even with a good token, and nothing is fetched for it", async () => {
    await fakeOsm();
    const r = await square(alice, mintSquareToken({ z: Z, x: 0, y: 0 }));
    expect(r.status).toBe(404);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("is the team's only", async () => {
    const t = mintSquareToken({ z: Z, x: R.minX, y: R.minY });
    expect((await square(guardian, t)).status).toBe(403);
    expect((await square(undefined, t)).status).toBe(401);
  });

  it("nothing positional in any address: the square route's only parameter is the token", () => {
    const paths: string[] = [];
    const walk = (stack: { route?: { path: string }; handle?: { stack?: unknown[] } }[]) => {
      for (const l of stack) {
        if (l.route) paths.push(l.route.path);
        else if (l.handle?.stack) walk(l.handle.stack as typeof stack);
      }
    };
    walk((router as unknown as { stack: Parameters<typeof walk>[0] }).stack);
    expect(paths.filter((p) => /map-square/i.test(p)).sort()).toEqual(["/team/map-square/:token", "/team/map-squares"]);
  });
});

describe("300 squares per person per 10 minutes", () => {
  // The clock is held still, so the 10-minute window can't turn over
  // mid-test. The first squares are counted straight into the limiter (no
  // requests); a few real requests then cross the line.
  const fill = async (who: Signed, n: number) => {
    for (let i = 0; i < n; i++)
      await consume(MAP_SQUARES_BUCKET, `person:${who.id}`, MAP_SQUARES_LIMIT, MAP_SQUARES_WINDOW_MS, undefined, Date.now(), {
        sliding: true,
      });
  };

  it("is a rolling window: the last window's squares still count just after the boundary", async () => {
    // Bob's 300 at the very end of one window; a second into the next, he is
    // still refused (a fixed window would hand him 300 more at once). The
    // old squares fade out over the next 10 minutes.
    const end = Math.floor(Date.now() / MAP_SQUARES_WINDOW_MS) * MAP_SQUARES_WINDOW_MS;
    vi.useFakeTimers({ toFake: ["Date"], now: end - 1000 });
    await fill(bob, MAP_SQUARES_LIMIT);
    vi.setSystemTime(end + 1000);
    const r = await square(bob, mintSquareToken({ z: Z, x: R.minX, y: R.minY + 1 }));
    expect(r.status).toBe(429);
  });

  it("asking for tokens has its own limit, per person: the 121st ask in 10 minutes gets 429", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    await _resetBucketForTests(MAP_SQUARE_TOKENS_BUCKET);
    expect(MAP_SQUARE_TOKENS_LIMIT).toBe(120);
    for (let i = 0; i < MAP_SQUARE_TOKENS_LIMIT - 1; i++)
      await consume(MAP_SQUARE_TOKENS_BUCKET, `person:${alice.id}`, MAP_SQUARE_TOKENS_LIMIT, MAP_SQUARES_WINDOW_MS);
    const body = { z: Z, xMin: R.minX, xMax: R.minX, yMin: R.minY, yMax: R.minY };
    expect((await ask(alice, body)).status).toBe(200);
    const over = await ask(alice, body);
    expect([over.status, over.headers["cache-control"]]).toEqual([429, "no-store"]);
    expect((await ask(bob, body)).status).toBe(200);
    await _resetBucketForTests(MAP_SQUARE_TOKENS_BUCKET);
  });

  it("the 301st square for one person gets 429, while a second person is unaffected", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    await fakeOsm();
    _resetTileBackoffForTests();
    expect([MAP_SQUARES_LIMIT, MAP_SQUARES_WINDOW_MS]).toEqual([300, 600_000]);
    const t = mintSquareToken({ z: Z, x: R.minX, y: R.minY + 1 });
    await fill(alice, MAP_SQUARES_LIMIT - 1);
    const at300 = await square(alice, t);
    expect(at300.status).toBe(200);
    const at301 = await square(alice, t);
    expect(at301.status).toBe(429);
    expect(at301.headers["cache-control"]).toBe("no-store");
    expect(at301.body).toEqual({ error: "Too many map pictures. Please try again in a few minutes." });
    // Bob shares Alice's address (both are 127.0.0.1 here), not her budget.
    const other = await square(bob, t);
    expect(other.status).toBe(200);
  });

  it("the count is the person's own, whatever address they ask from", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    await fill(bob, MAP_SQUARES_LIMIT);
    const t = mintSquareToken({ z: Z, x: R.minX, y: R.minY + 1 });
    const r = await square(bob, t).set("X-Forwarded-For", "203.0.113.9, 10.0.0.1, 10.0.0.2, 10.0.0.3");
    expect(r.status).toBe(429);
  });
});

describe("the request log", () => {
  it("logs a square's address as /api/team/map-square/[redacted], served or refused, with nothing of its token or square", async () => {
    await fakeOsm();
    _resetTileBackoffForTests();
    // Ermoupoli at zoom 19: numbers long enough to spot anywhere in a line.
    const token = mintSquareToken({ z: 19, x: 298467, y: 203255 });
    for (const who of [alice, guardian, undefined]) {
      spies.logLines.length = 0;
      await square(who, token);
      expect(spies.logLines.length).toBeGreaterThan(0);
      for (const line of spies.logLines) {
        expect(line).not.toContain(token);
        expect(line).not.toMatch(/298467|203255/);
      }
      expect(spies.logLines.some((l) => l.includes('"/api/team/map-square/[redacted]"'))).toBe(true);
    }
  });

  it("the token request's log line has no square numbers (they're in the body, which is never logged)", async () => {
    await ask(alice, { z: 19, xMin: 298467, xMax: 298467, yMin: 203255, yMax: 203255 });
    expect(spies.logLines.length).toBeGreaterThan(0);
    for (const line of spies.logLines) expect(line).not.toMatch(/298467|203255/);
  });
});
