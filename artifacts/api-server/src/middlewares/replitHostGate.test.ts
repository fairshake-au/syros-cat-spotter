/**
 * SYC-229: the API refuses requests that arrive on the deployment's own
 * `*.replit.app` address (a different Google front end from the custom
 * domains, so `trust proxy: 4` may not hold there), except /api/healthz, unless
 * ALLOW_REPLIT_HOST=1 is set for a recovery smoke run.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import { isReplitHost } from "./replitHostGate";

afterAll(async () => {
  await pool.end();
});

const saved = process.env["ALLOW_REPLIT_HOST"];
afterEach(() => {
  if (saved === undefined) delete process.env["ALLOW_REPLIT_HOST"];
  else process.env["ALLOW_REPLIT_HOST"] = saved;
});

const REPLIT_HOSTS = [
  "syros-cat-spotter-eu.replit.app",
  "SYROS-CAT-SPOTTER-EU.REPLIT.APP",
  "syros-cat-spotter-eu.replit.app:443",
  "syros-cat-spotter-eu.replit.app.",
  "cat-spotter.someone.repl.co",
];

const OUR_HOSTS = ["apptest.catspotters.com", "team.catspotters.com", "localhost:8080"];

// A cheap route that would otherwise answer 200 or the pre-launch 401 —
// anything but this gate's bare 404.
const ROUTE = "/api/cats";

describe("isReplitHost", () => {
  for (const host of REPLIT_HOSTS) {
    it(`treats ${host} as a Replit address`, () => {
      expect(isReplitHost(host)).toBe(true);
    });
  }
  for (const host of [
    ...OUR_HOSTS,
    "replit.app.catspotters.com",
    "evilreplit.app",
    "abc123.riker.replit.dev",
    undefined,
    "",
  ]) {
    it(`does not treat ${String(host)} as a Replit address`, () => {
      expect(isReplitHost(host)).toBe(false);
    });
  }
});

describe("replitHostGate on the real app", () => {
  for (const host of REPLIT_HOSTS) {
    it(`refuses ${ROUTE} on ${host} with a bare, uncached 404`, async () => {
      delete process.env["ALLOW_REPLIT_HOST"];
      const res = await request(app).get(ROUTE).set("Host", host);
      expect(res.status).toBe(404);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.text).toBe("");
    });
  }

  it("refuses a POST on the Replit address too", async () => {
    delete process.env["ALLOW_REPLIT_HOST"];
    const res = await request(app)
      .post("/api/sightings")
      .set("Host", "syros-cat-spotter-eu.replit.app")
      .send({});
    expect(res.status).toBe(404);
    expect(res.text).toBe("");
  });

  for (const host of OUR_HOSTS) {
    it(`lets ${ROUTE} through on ${host}`, async () => {
      delete process.env["ALLOW_REPLIT_HOST"];
      const res = await request(app).get(ROUTE).set("Host", host);
      expect(res.status).not.toBe(404);
    });
  }

  for (const host of [...REPLIT_HOSTS, ...OUR_HOSTS]) {
    it(`always answers GET /api/healthz on ${host}`, async () => {
      delete process.env["ALLOW_REPLIT_HOST"];
      const res = await request(app).get("/api/healthz").set("Host", host);
      expect(res.status).toBe(200);
    });
  }

  it("always answers HEAD /api/healthz on the Replit address", async () => {
    delete process.env["ALLOW_REPLIT_HOST"];
    const res = await request(app)
      .head("/api/healthz")
      .set("Host", "syros-cat-spotter-eu.replit.app");
    expect(res.status).toBe(200);
  });

  it("does not treat a look-alike of /api/healthz as the health check", async () => {
    delete process.env["ALLOW_REPLIT_HOST"];
    const res = await request(app)
      .get("/api/healthz/../cats")
      .set("Host", "syros-cat-spotter-eu.replit.app");
    expect(res.status).toBe(404);
    expect(res.text).toBe("");
  });

  it("lets everything through on the Replit address when ALLOW_REPLIT_HOST=1", async () => {
    process.env["ALLOW_REPLIT_HOST"] = "1";
    const res = await request(app).get(ROUTE).set("Host", "syros-cat-spotter-eu.replit.app");
    expect(res.status).not.toBe(404);
  });

  for (const value of ["0", "true", "yes", " 1", ""]) {
    it(`stays shut when ALLOW_REPLIT_HOST is ${JSON.stringify(value)} (only exactly "1" opens it)`, async () => {
      process.env["ALLOW_REPLIT_HOST"] = value;
      const res = await request(app)
        .get(ROUTE)
        .set("Host", "syros-cat-spotter-eu.replit.app");
      expect(res.status).toBe(404);
    });
  }

  it("a faked X-Forwarded-Host cannot unlock the Replit address", async () => {
    delete process.env["ALLOW_REPLIT_HOST"];
    const res = await request(app)
      .get(ROUTE)
      .set("Host", "syros-cat-spotter-eu.replit.app")
      .set("X-Forwarded-Host", "apptest.catspotters.com");
    expect(res.status).toBe(404);
    expect(res.text).toBe("");
  });

  it("a faked X-Forwarded-Host cannot shut a custom domain either", async () => {
    delete process.env["ALLOW_REPLIT_HOST"];
    const res = await request(app)
      .get(ROUTE)
      .set("Host", "apptest.catspotters.com")
      .set("X-Forwarded-Host", "syros-cat-spotter-eu.replit.app");
    expect(res.status).not.toBe(404);
  });
});
