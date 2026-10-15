/**
 * SYC-109: a device id is a credential, so no request-log line may carry one.
 * Logs one request to every route with a device id in its path, through the
 * real app, and checks the id never reaches the output, while each request is
 * still logged (redact, never drop).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const spies = vi.hoisted(() => ({ logLines: [] as string[] }));

vi.mock("./lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/logger")>();
  const { default: pino } = await import("pino");
  const logger = pino(
    { level: "trace", redact: actual.REDACT_PATHS, serializers: actual.LOG_SERIALIZERS },
    { write: (line: string) => void spies.logLines.push(line) },
  );
  return { ...actual, logger };
});

import { addPerson, db, mapTileCacheTable, pool } from "@workspace/db";
import sharp from "sharp";
import { sessionCookieFor } from "./lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "./test/removeTestPerson";
import app from "./app";
import { redactRequestUrl, safeError } from "./lib/logger";
import { mintTileToken } from "./lib/mapTiles/tileToken";
import { _resetTileBackoffForTests } from "./lib/mapTiles/tileCache";

const DEVICE = "vitest-logredact-0f3c9a7e2b";

// No device secret is sent, so every route answers 401 before touching the
// database: the request is still logged, which is all this test needs.
const ROUTES: { method: "get" | "post" | "put" | "patch" | "delete"; path: string }[] = [
  { method: "get", path: `/api/notifications/${DEVICE}` },
  { method: "post", path: `/api/notifications/${DEVICE}/read-all` },
  { method: "post", path: `/api/notifications/${DEVICE}/42/read` },
  { method: "put", path: `/api/profile/${DEVICE}/push-token` },
  { method: "get", path: `/api/profiles/${DEVICE}` },
  { method: "patch", path: `/api/profiles/${DEVICE}` },
  { method: "get", path: `/api/profiles/${DEVICE}/username` },
  { method: "post", path: `/api/profiles/${DEVICE}/username` },
  { method: "get", path: `/api/profiles/${DEVICE}/cats/1/open-sightings` },
  // SYC-3: keep my spots safe.
  { method: "get", path: `/api/keep-safe/${DEVICE}` },
  { method: "post", path: `/api/keep-safe/${DEVICE}` },
  { method: "delete", path: `/api/keep-safe/${DEVICE}` },
  // SYC-36: the match-wait resident signals.
  { method: "get", path: `/api/app-settings/${DEVICE}/signals` },
  // Express matches routes case-insensitively, so the redaction must too.
  { method: "get", path: `/api/Notifications/${DEVICE}` },
];

beforeEach(() => {
  spies.logLines.length = 0;
});

afterAll(async () => {
  await pool.end();
});

describe("request log redaction (SYC-109)", () => {
  for (const { method, path } of ROUTES) {
    it(`${method.toUpperCase()} ${path.replace(DEVICE, ":deviceId")} logs the request without the device id`, async () => {
      await request(app)[method](path).query({ deviceId: DEVICE });
      const completed = spies.logLines.filter((l) => l.includes('"request completed"'));
      expect(completed).toHaveLength(1);
      expect(completed[0]).toContain(":deviceId");
      for (const line of spies.logLines) expect(line).not.toContain(DEVICE);
    });
  }

  it("keeps the static username routes' real paths", () => {
    expect(redactRequestUrl("/api/profiles/username-availability?name=Mia")).toBe(
      "/api/profiles/username-availability",
    );
    expect(redactRequestUrl("/api/profiles/username-suggestions")).toBe(
      "/api/profiles/username-suggestions",
    );
  });

  it("leaves routes without a device id alone", () => {
    expect(redactRequestUrl("/api/cats/12/updates")).toBe("/api/cats/12/updates");
    expect(redactRequestUrl("/api/healthz")).toBe("/api/healthz");
  });

  it("logs a map tile request through the real app without its position (SYC-255)", async () => {
    await request(app).get("/api/team/map-tiles/17/74000/50000.png").query({ z: "17" });
    const completed = spies.logLines.filter((l) => l.includes('"request completed"'));
    expect(completed).toHaveLength(1);
    expect(completed[0]).toContain("/api/team/map-tiles/:tile");
    for (const line of spies.logLines) {
      expect(line).not.toContain("74000");
      expect(line).not.toContain("50000");
    }
  });

  it("a real map picture request logs as /api/team/map-tiles/:tile, with nothing of its token (SYC-209 PR 3.1)", async () => {
    process.env["TEAM_SESSION_KEYS"] = "vitest-logredact-key-0123456789abcdef-0123456789";
    try {
      const token = mintTileToken({ z: 17, x: 74230, y: 50478, size: 179 });
      // No session: refused by the real route, and still logged.
      const res = await request(app).get(`/api/team/map-tiles/${token}`);
      expect(res.status).toBe(401);
      const completed = spies.logLines.filter((l) => l.includes('"request completed"'));
      expect(completed).toHaveLength(1);
      expect(completed[0]).toContain('"/api/team/map-tiles/:tile"');
      for (const line of spies.logLines) {
        expect(line).not.toContain(token);
        expect(line).not.toContain(token.slice(0, 12));
        expect(line).not.toMatch(/74230|50478/);
      }
    } finally {
      delete process.env["TEAM_SESSION_KEYS"];
    }
  });

  it("a signed-in map picture request logs no z/x/y, served or failing (SYC-209 PR 3.1)", async () => {
    process.env["TEAM_SESSION_KEYS"] = "vitest-logredact-key-0123456789abcdef-0123456789";
    const email = `vitest-logredact-tiles-${Date.now()}@example.com`;
    const person = await addPerson({ email, name: "Tilly", addedBy: "cli:vitest" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const cookie = sessionCookieFor(person.id);
      // Ermoupoli at zoom 19: numbers long enough to spot anywhere in a line.
      const tile = { z: 19, x: 298467, y: 203255, size: 179 as const };
      for (const failing of [true, false]) {
        spies.logLines.length = 0;
        _resetTileBackoffForTests(); // the failing round backs off; the next must fetch
        fetchSpy.mockImplementation(async () =>
          failing
            ? new Response("no", { status: 500 })
            : new Response(await sharp({ create: { width: 256, height: 256, channels: 3, background: "#ccc" } }).png().toBuffer(), { status: 200 }),
        );
        const res = await request(app).get(`/api/team/map-tiles/${mintTileToken(tile)}`).set("Cookie", cookie);
        expect(res.status).toBe(failing ? 503 : 200);
        expect(spies.logLines.length).toBeGreaterThan(0);
        for (const line of spies.logLines) expect(line).not.toMatch(/298467|203255/);
      }
    } finally {
      fetchSpy.mockRestore();
      await db.delete(mapTileCacheTable);
      await removeTestPerson(email);
      delete process.env["TEAM_SESSION_KEYS"];
    }
  });

  it("a malformed map picture request through the real route logs neither its path nor its error message (SYC-209 PR 3.1)", async () => {
    await request(app).get("/api/team/map-tiles/17%zz");
    expect(spies.logLines.length).toBeGreaterThan(0);
    const completed = spies.logLines.filter((l) => l.includes('"request completed"') || l.includes('"request errored"'));
    expect(completed.length).toBeGreaterThan(0);
    expect(completed.every((l) => l.includes('"/api/team/map-tiles/:tile"'))).toBe(true);
    // The decode error reached the error handler, and was logged by type only.
    expect(spies.logLines.some((l) => l.includes("URIError"))).toBe(true);
    for (const line of spies.logLines) {
      expect(line).not.toContain("17%zz");
      expect(line).not.toContain("%zz");
      expect(line).not.toMatch(/failed to decode/i);
    }
  });

  it("redacts hand-made spellings of a map tile address (SYC-255)", () => {
    for (const odd of [
      "/API/Team/MAP-TILES/17/74000/50000.png",
      "//api/team/map-tiles/17/74000/50000.png",
      "/api/team//map-tiles/17/74000/50000.png",
      "/api/team/./map-tiles/17/74000/50000.png",
      "/api/team/map%2Dtiles/17/74000/50000.png",
      "/api/team/map-tiles%2F17%2F74000%2F50000.png",
      "/api/team/map-tiles/17/74000/50000.png/extra",
    ]) {
      const logged = redactRequestUrl(odd) ?? "";
      expect(logged, odd).toContain(":tile");
      expect(logged, odd).not.toMatch(/74000|50000/);
    }
    expect(redactRequestUrl("/api/team/map-tiles")).toBe("/api/team/map-tiles");
  });

  it("an error that quotes a request address is logged without its message (SYC-255)", () => {
    const err = new URIError("Failed to decode param '17%zz'");
    const logged = JSON.stringify(safeError(err));
    expect(logged).not.toContain("17%zz");
    expect(logged).toContain("URIError");
  });

  it("redacts map tile addresses from the request path (SYC-255)", () => {
    expect(redactRequestUrl("/api/team/map-tiles/17/74000/50000.png")).toBe(
      "/api/team/map-tiles/:tile",
    );
    expect(redactRequestUrl("/api/team/map-tiles/AbC123xyz")).toBe("/api/team/map-tiles/:tile");
    expect(redactRequestUrl("/api/team/map-tiles/17/74000/50000.png?foo=bar&baz=qux")).toBe(
      "/api/team/map-tiles/:tile",
    );
  });
});
