/**
 * SYC-113 item 2: the API's pre-launch pass, through supertest on the real app.
 * Plan: docs/superpowers/plans/syc-113-pre-launch-gates.md, "Tests" 9–17 and
 * the shared cookie vectors. Test secrets are generated here; none is real.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestHandler } from "express";

// Test 14 spies on the JSON body parser: wrap express.json so every time the
// parser middleware runs, it's counted.
const spies = vi.hoisted(() => ({ jsonParserRuns: 0, logLines: [] as string[] }));

type ExpressModule = typeof import("express");
vi.mock("express", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown> & {
    default: ExpressModule;
  };
  const real = actual.default;
  const wrapped = Object.assign(
    (...args: Parameters<ExpressModule>) => real(...args),
    real,
    {
      json: (...args: Parameters<ExpressModule["json"]>) => {
        const parser = real.json(...args);
        const counted: RequestHandler = (req, res, next) => {
          spies.jsonParserRuns += 1;
          return parser(req, res, next);
        };
        return counted as unknown as ReturnType<ExpressModule["json"]>;
      },
    },
  );
  return { ...actual, default: wrapped };
});

// Test 17 captures every log line, using the production redaction settings.
vi.mock("../lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/logger")>();
  const { default: pino } = await import("pino");
  const logger = pino(
    { level: "trace", redact: actual.REDACT_PATHS },
    { write: (line: string) => void spies.logLines.push(line) },
  );
  return { ...actual, logger };
});

import { db, pool, photosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";
import router from "../routes";
import {
  describeGate,
  sessionKeys as readSessionKeys,
  signSession,
  verifySession,
} from "../lib/prelaunch";
import { normalisePath } from "./prelaunchGate";

const here = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(
    path.join(here, "../../../cat-spotter/lib/__fixtures__/prelaunch-cookie-vectors.json"),
    "utf8",
  ),
) as {
  cookieName: string;
  sessionSeconds: number;
  vectors: { key: string; nowSeconds: number; expectedValue: string }[];
};

const COOKIE = "__Host-cs_prelaunch";
const REFUSAL = {
  error: "prelaunch_pass_required",
  message: "Cat Spotters isn't open yet.",
};

const SESSION_KEY = randomBytes(32).toString("base64url");
const TESTER_KEY = randomBytes(24).toString("base64url");
const TESTER_KEY_2 = randomBytes(24).toString("base64url");
const INTERNAL_TOKEN = randomBytes(24).toString("base64url");

const SETTINGS = [
  "NODE_ENV",
  "PRELAUNCH_GATE",
  "PRELAUNCH_SESSION_KEYS",
  "PRELAUNCH_TESTER_KEYS",
  "INTERNAL_PEOPLE_TOKEN",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of SETTINGS) saved[k] = process.env[k];
  // NODE_ENV stays "test" (vitest's): the gate is off unless turned on.
  process.env["PRELAUNCH_GATE"] = "on";
  process.env["PRELAUNCH_SESSION_KEYS"] = SESSION_KEY;
  process.env["PRELAUNCH_TESTER_KEYS"] = TESTER_KEY;
  process.env["INTERNAL_PEOPLE_TOKEN"] = INTERNAL_TOKEN;
});

afterEach(() => {
  for (const k of SETTINGS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

afterAll(async () => {
  await pool.end();
});

function validCookie(): string {
  const keys = readSessionKeys();
  return `${COOKIE}=${signSession(keys, Math.floor(Date.now() / 1000))}`;
}

type Method = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";

function send(method: Method, url: string) {
  return request(app)[method](url);
}

/** Every route registered on the /api router, read from Express's own stack. */
function registeredRoutes(): { method: Method; path: string }[] {
  const out: { method: Method; path: string }[] = [];
  type Layer = {
    route?: { path: string; methods: Record<string, boolean> };
    handle?: { stack?: Layer[] };
  };
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) {
          if (m === "_all") continue;
          out.push({ method: m as Method, path: `/api${layer.route.path}` });
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk((router as unknown as { stack: Layer[] }).stack);
  return out;
}

function concrete(routePath: string): string {
  return routePath.replace(/:[A-Za-z]+/g, "1");
}

describe("9. gate on, no pass: every route refuses", () => {
  it("walks every registered route (so a later route is covered automatically)", async () => {
    const routes = registeredRoutes();
    // Guard against a walker that silently finds nothing.
    expect(routes.length).toBeGreaterThanOrEqual(20);
    expect(routes).toContainEqual({ method: "get", path: "/api/cats" });
    expect(routes).toContainEqual({ method: "get", path: "/api/photos/:photoId" });

    for (const route of routes) {
      const url = concrete(route.path);
      const isHealth = url === "/api/healthz";
      if (!isHealth) {
        const res = await send(route.method, url);
        expect({ route: `${route.method} ${url}`, status: res.status }).toEqual({
          route: `${route.method} ${url}`,
          status: 401,
        });
        expect(res.body).toEqual(REFUSAL);
        expect(res.headers["cache-control"]).toBe("no-store");
      }
      // Upper case reaches the same route in Express, so it must be refused too.
      const upper = await send(route.method, url.toUpperCase());
      expect({ route: `${route.method} ${url.toUpperCase()}`, status: upper.status }).toEqual({
        route: `${route.method} ${url.toUpperCase()}`,
        status: 401,
      });
    }
  });

  it("refuses the named examples with the exact body", async () => {
    for (const [method, url] of [
      ["get", "/api/cats"],
      ["get", "/api/photos/1"],
      ["post", "/api/sightings"],
      ["post", "/api/notifications/abc/read-all"],
      ["get", "/api/campaign"],
      ["get", "/API/CATS"],
      ["get", "/api/cats/"],
      ["get", "/api"],
      ["get", "/"],
      ["get", "/api/does-not-exist"],
    ] as [Method, string][]) {
      const res = await send(method, url);
      expect({ url, status: res.status }).toEqual({ url, status: 401 });
      expect(res.body).toEqual(REFUSAL);
    }
  });

  it("paths that only look like /api/team are not exempt", async () => {
    for (const url of ["/api/t", "/api/te", "/api/teams", "/api/teamx", "/api/team-x/me", "/api/tea/m"]) {
      const res = await send("get", url);
      expect({ url, status: res.status }).toEqual({ url, status: 401 });
      expect(res.body).toEqual(REFUSAL);
    }
  });

  it("disguised /api/internal paths are treated as internal: a tester key doesn't open them", async () => {
    for (const url of [
      "/api/internal/people/allowed",
      "/API/Internal/people/allowed",
      "/api/%69nternal/people/allowed",
      "/api/%49NTERNAL/people/allowed",
      "/api//internal/people/allowed",
      "//api///internal/people/allowed",
      "/api/internal",
    ]) {
      const res = await request(app)
        .post(url)
        .set("X-Prelaunch-Key", TESTER_KEY)
        .set("Cookie", validCookie());
      expect({ url, status: res.status }).toEqual({ url, status: 401 });
      expect(res.body).toEqual(REFUSAL);
    }
  });

  it("malformed percent-encoding → 400", async () => {
    const res = await send("get", "/api/%E0%A4%A");
    expect(res.status).toBe(400);
  });

  it("normalisePath decodes, lower-cases and collapses slashes", () => {
    expect(normalisePath("/API//%69nternal/X")).toBe("/api/internal/x");
    expect(normalisePath("/%")).toBeNull();
  });
});

describe("10. /api/healthz is the only open path", () => {
  it("GET and HEAD /api/healthz → 200 with no pass", async () => {
    const get = await send("get", "/api/healthz");
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ status: "ok" });
    expect((await send("head", "/api/healthz")).status).toBe(200);
  });

  it("POST /api/healthz and look-alikes → 401", async () => {
    for (const [method, url] of [
      ["post", "/api/healthz"],
      ["put", "/api/healthz"],
      ["get", "/api/healthz-extra"],
      ["get", "/api/healthzz"],
      ["get", "/api/healthz/extra"],
      ["get", "/api/healthz/"],
      ["get", "/API/HEALTHZ"],
    ] as [Method, string][]) {
      const res = await send(method, url);
      expect({ method, url, status: res.status }).toEqual({ method, url, status: 401 });
    }
  });
});

describe("11. passes", () => {
  it("a valid website cookie passes to the route", async () => {
    const res = await request(app).get("/api/campaign").set("Cookie", validCookie());
    expect(res.status).toBe(200);
    expect(res.body).not.toEqual(REFUSAL);
  });

  it("a valid tester key passes to the route", async () => {
    const res = await request(app).get("/api/campaign").set("X-Prelaunch-Key", TESTER_KEY);
    expect(res.status).toBe(200);
    const cats = await request(app).get("/api/cats").set("X-Prelaunch-Key", TESTER_KEY);
    expect(cats.status).toBe(200);
    expect(Array.isArray(cats.body)).toBe(true);
  });

  it("the second tester key passes during a change", async () => {
    process.env["PRELAUNCH_TESTER_KEYS"] = `${TESTER_KEY}, ${TESTER_KEY_2}`;
    const res = await request(app).get("/api/campaign").set("X-Prelaunch-Key", TESTER_KEY_2);
    expect(res.status).toBe(200);
  });

  it("a cookie among others, bad one first, passes", async () => {
    const res = await request(app)
      .get("/api/campaign")
      .set("Cookie", `${COOKIE}=v1.1.bad; a=b; ${validCookie()}`);
    expect(res.status).toBe(200);
  });

  it("wrong key, empty key, key in the query string, bad cookie → 401", async () => {
    const attempts = [
      request(app).get("/api/campaign").set("X-Prelaunch-Key", "wrong"),
      request(app).get("/api/campaign").set("X-Prelaunch-Key", `${TESTER_KEY}x`),
      request(app).get("/api/campaign").set("X-Prelaunch-Key", ""),
      request(app).get(`/api/campaign?key=${TESTER_KEY}`),
      request(app).get(`/api/campaign?x-prelaunch-key=${TESTER_KEY}`),
      request(app).get(`/api/campaign?X-Prelaunch-Key=${TESTER_KEY}`),
      request(app).get("/api/campaign").set("Cookie", `${COOKIE}=v1.9999999999.forged`),
      request(app).get("/api/campaign").set("Cookie", `${COOKIE}=${TESTER_KEY}`),
      request(app).get("/api/campaign").set("Authorization", `Bearer ${INTERNAL_TOKEN}`),
    ];
    for (const attempt of attempts) {
      const res = await attempt;
      expect(res.status).toBe(401);
      expect(res.body).toEqual(REFUSAL);
    }
  });

  it("a cookie signed with a key that isn't configured → 401", async () => {
    const other = [randomBytes(32)];
    const res = await request(app)
      .get("/api/campaign")
      .set("Cookie", `${COOKIE}=${signSession(other, Math.floor(Date.now() / 1000))}`);
    expect(res.status).toBe(401);
  });
});

describe("12. /api/internal/* takes only the Worker's bearer", () => {
  const url = "/api/internal/people/allowed";

  it("right bearer → passes the gate (reaches the router; the route itself is PR #20's)", async () => {
    const res = await request(app).post(url).set("Authorization", `Bearer ${INTERNAL_TOKEN}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("website cookie → 401; tester key → 401; nothing → 401; wrong bearer → 401", async () => {
    for (const attempt of [
      request(app).post(url).set("Cookie", validCookie()),
      request(app).post(url).set("X-Prelaunch-Key", TESTER_KEY),
      request(app).post(url),
      request(app).post(url).set("Authorization", `Bearer ${INTERNAL_TOKEN}x`),
      request(app).post(url).set("Authorization", INTERNAL_TOKEN),
      request(app).post(url).set("Authorization", `Bearer ${TESTER_KEY}`),
    ]) {
      const res = await attempt;
      expect(res.status).toBe(401);
      expect(res.body).toEqual(REFUSAL);
    }
  });

  it("no token configured → 503 not_configured, whatever is sent", async () => {
    delete process.env["INTERNAL_PEOPLE_TOKEN"];
    for (const attempt of [
      request(app).post(url),
      request(app).post(url).set("Authorization", `Bearer ${INTERNAL_TOKEN}`),
      request(app).post(url).set("Authorization", "Bearer "),
      request(app).post(url).set("X-Prelaunch-Key", TESTER_KEY),
    ]) {
      const res = await attempt;
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: "not_configured" });
    }
  });
});

describe("12a (partial). /api/team/* skips the pass (Decision 1)", () => {
  // PR #20's /api/team routes don't exist yet. Whichever of this and PR #20
  // lands second walks every /api/team route and expects not_signed_in; here
  // we pin that the exemption is exactly /api/team and /api/team/*.
  it("reaches the router without a pass", async () => {
    for (const url of ["/api/team", "/api/team/me", "/API/TEAM/me", "/api//team/handoff"]) {
      const res = await send("get", url);
      expect({ url, status: res.status }).toEqual({ url, status: 404 });
      expect(res.body).toEqual({ error: "Not found" });
    }
  });
});

describe("13. CORS runs before the gate", () => {
  it("a preflight with no pass is answered by CORS (204), not 401", async () => {
    const res = await request(app)
      .options("/api/cats")
      .set("Origin", "https://example.org")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "x-prelaunch-key, content-type");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toBeTruthy();
  });

  it("a photo preflight from the app's own origin is answered by the photo CORS", async () => {
    const res = await request(app)
      .options("/api/photos/1")
      .set("Origin", "https://catspotters.com")
      .set("Access-Control-Request-Method", "GET");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://catspotters.com");
  });

  it("a 401 still carries Access-Control-Allow-Origin", async () => {
    const res = await request(app).get("/api/cats").set("Origin", "https://example.org");
    expect(res.status).toBe(401);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});

describe("14. a request without a pass is refused before the body is parsed", () => {
  it("a 25 MB body with no pass → 401, and the JSON parser never runs", async () => {
    const big = Buffer.from(JSON.stringify({ photo: "x".repeat(25 * 1024 * 1024 - 20) }));
    spies.jsonParserRuns = 0;
    // A raw client: the server answers before the client finishes sending,
    // so read the response as soon as it arrives and ignore the later reset.
    const server = app.listen(0);
    try {
      await new Promise<void>((r) => server.once("listening", () => r()));
      const { port } = server.address() as AddressInfo;
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request({
          host: "127.0.0.1",
          port,
          method: "POST",
          path: "/api/sightings",
          headers: { "content-type": "application/json", "content-length": big.length },
        });
        let answered = false;
        req.on("response", (res) => {
          answered = true;
          res.resume();
          resolve(res.statusCode ?? 0);
          req.destroy();
        });
        req.on("error", (err) => {
          if (!answered) reject(err);
        });
        // Send in 64 KB chunks and stop as soon as the server has answered.
        let offset = 0;
        const pump = () => {
          while (!answered && offset < big.length) {
            const chunk = big.subarray(offset, offset + 65536);
            offset += chunk.length;
            if (!req.write(chunk)) {
              req.once("drain", pump);
              return;
            }
          }
          if (!answered) req.end();
        };
        pump();
      });
      expect(status).toBe(401);
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    expect(spies.jsonParserRuns).toBe(0);
  });

  it("control: with a pass, the JSON parser does run (the spy works)", async () => {
    spies.jsonParserRuns = 0;
    await request(app)
      .post("/api/cats/1/claim")
      .set("X-Prelaunch-Key", TESTER_KEY)
      .send({ deviceId: "x" });
    expect(spies.jsonParserRuns).toBeGreaterThan(0);
  });
});

describe("15. when the gate is on", () => {
  it.each([
    ["production", "production"],
    ["unset", undefined],
    ["staging", "staging"],
  ])("NODE_ENV %s with PRELAUNCH_GATE unset → on", async (_label, nodeEnv) => {
    if (nodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = nodeEnv;
    delete process.env["PRELAUNCH_GATE"];
    const res = await send("get", "/api/campaign");
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REFUSAL);
    expect((await send("get", "/api/healthz")).status).toBe(200);
  });

  it("NODE_ENV=development or test with PRELAUNCH_GATE unset → off", async () => {
    delete process.env["PRELAUNCH_GATE"];
    for (const nodeEnv of ["development", "test"]) {
      process.env["NODE_ENV"] = nodeEnv;
      expect((await send("get", "/api/campaign")).status).toBe(200);
    }
  });

  it("PRELAUNCH_GATE=off with NODE_ENV=production → off: /api/cats answers without a pass", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["PRELAUNCH_GATE"] = "off";
    const res = await send("get", "/api/cats");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("PRELAUNCH_GATE=off with the secrets missing → still off (a deliberate launch needs no secrets)", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["PRELAUNCH_GATE"] = "off";
    delete process.env["PRELAUNCH_SESSION_KEYS"];
    delete process.env["PRELAUNCH_TESTER_KEYS"];
    expect((await send("get", "/api/campaign")).status).toBe(200);
  });

  it("PRELAUNCH_GATE=banana or OFF in production → on", async () => {
    process.env["NODE_ENV"] = "production";
    for (const flag of ["banana", "OFF", "0", "false", ""]) {
      process.env["PRELAUNCH_GATE"] = flag;
      expect({ flag, status: (await send("get", "/api/campaign")).status }).toEqual({ flag, status: 401 });
    }
  });

  it.each([
    ["session keys", "PRELAUNCH_SESSION_KEYS"],
    ["tester keys", "PRELAUNCH_TESTER_KEYS"],
  ])("PRELAUNCH_GATE unset in production with %s missing → 503, never open", async (_label, name) => {
    process.env["NODE_ENV"] = "production";
    delete process.env["PRELAUNCH_GATE"];
    delete process.env[name];
    for (const attempt of [
      request(app).get("/api/campaign"),
      request(app).get("/api/campaign").set("X-Prelaunch-Key", TESTER_KEY),
      request(app).get("/api/campaign").set("Cookie", `${COOKIE}=v1.1.x`),
    ]) {
      const res = await attempt;
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: "prelaunch_not_configured" });
    }
    expect((await send("get", "/api/healthz")).status).toBe(200);
  });

  it("a session key too short to be real counts as missing → 503", async () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["PRELAUNCH_GATE"];
    process.env["PRELAUNCH_SESSION_KEYS"] = "c2hvcnQ";
    expect((await send("get", "/api/campaign")).status).toBe(503);
  });

  it("the start-up line says what's configured, never the values", () => {
    const lines = describeGate();
    expect(lines).toEqual([
      "prelaunch gate: on (session keys: 1, tester keys: 1, internal token: yes)",
    ]);
    process.env["PRELAUNCH_GATE"] = "banana";
    process.env["NODE_ENV"] = "production";
    delete process.env["INTERNAL_PEOPLE_TOKEN"];
    const loud = describeGate();
    expect(loud[0]).toMatch(/^WARNING/);
    expect(loud[1]).toBe("prelaunch gate: on (session keys: 1, tester keys: 1, internal token: no)");
    const all = [...lines, ...loud].join("\n");
    for (const secret of [SESSION_KEY, TESTER_KEY, INTERNAL_TOKEN]) expect(all).not.toContain(secret);
    process.env["PRELAUNCH_GATE"] = "off";
    expect(describeGate()).toEqual(["prelaunch gate: off"]);
  });
});

describe("16. photos aren't stored by shared caches while the gate is on", () => {
  const TINY_JPEG_B64 =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
  let photoId: number;

  beforeEach(async () => {
    const [photo] = await db
      .insert(photosTable)
      .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
      .returning();
    photoId = photo!.id;
  });

  afterEach(async () => {
    await db.delete(photosTable).where(eq(photosTable.id, photoId));
  });

  it("gate on: Cache-Control private (a year, immutable) and Vary on both pass headers", async () => {
    const res = await request(app).get(`/api/photos/${photoId}`).set("X-Prelaunch-Key", TESTER_KEY);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    const vary = String(res.headers["vary"]).toLowerCase();
    expect(vary).toContain("cookie");
    expect(vary).toContain("x-prelaunch-key");
  });

  it("gate off: public, as today", async () => {
    process.env["PRELAUNCH_GATE"] = "off";
    const res = await request(app).get(`/api/photos/${photoId}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });
});

describe("17. logs never contain the key, the cookie or the bearer", () => {
  it("across passing and refused requests (tests 11–12 shapes)", async () => {
    spies.logLines.length = 0;
    const cookie = validCookie();
    await request(app).get("/api/campaign").set("X-Prelaunch-Key", TESTER_KEY);
    await request(app).get("/api/campaign").set("Cookie", cookie);
    await request(app).get("/api/campaign").set("X-Prelaunch-Key", "wrong");
    await request(app).get(`/api/campaign?key=${TESTER_KEY}`);
    await request(app)
      .post("/api/internal/people/allowed")
      .set("Authorization", `Bearer ${INTERNAL_TOKEN}`);
    await request(app).post("/api/internal/people/allowed").set("X-Prelaunch-Key", TESTER_KEY);
    await request(app).get("/api/cats").set("X-Prelaunch-Key", TESTER_KEY);

    expect(spies.logLines.length).toBeGreaterThanOrEqual(7);
    const all = spies.logLines.join("\n");
    expect(all).not.toContain(TESTER_KEY);
    expect(all).not.toContain(cookie.split("=")[1]!);
    expect(all).not.toContain(INTERNAL_TOKEN);
    expect(all).not.toContain(SESSION_KEY);
  });
});

describe("shared cookie vectors (the website checks the same file)", () => {
  it.each(vectors.vectors)("key $key signs to the expected value and verifies", (v) => {
    expect(vectors.cookieName).toBe(COOKIE);
    const keys = [Buffer.from(v.key, "base64url")];
    expect(signSession(keys, v.nowSeconds)).toBe(v.expectedValue);
    expect(verifySession(keys, `${COOKIE}=${v.expectedValue}`, v.nowSeconds)).toBe(true);
    expect(verifySession(keys, `${COOKIE}=${v.expectedValue}`, v.nowSeconds + vectors.sessionSeconds)).toBe(false);
  });
});
