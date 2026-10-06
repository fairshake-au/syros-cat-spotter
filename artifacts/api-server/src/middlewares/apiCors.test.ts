/**
 * SYC-106: the API answers cross-origin only to the origins on apiCors's
 * allow-list, on every public route, not just /api/photos (photos.cors.test.ts
 * covers that one). Native apps send no Origin and must keep working.
 */
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import { isAllowedOrigin, replitOrigins } from "./apiCors";

afterAll(async () => {
  await pool.end();
});

const ALLOWED = [
  "https://catspotters.com",
  "https://apptest.catspotters.com",
  "https://team.catspotters.com",
  "http://localhost:8081",
  "http://127.0.0.1:19006",
  "exp://192.168.1.20:8081",
];

const REFUSED = [
  "https://evil.example",
  "https://evilcatspotters.com",
  "https://catspotters.com.evil.example",
  "http://catspotters.com",
  "https://someone-else.riker.replit.dev",
  "https://someone-else.replit.app",
  "null",
];

describe("apiCors on a representative public route (GET /api/healthz)", () => {
  for (const origin of REFUSED) {
    it(`gives ${origin} no Access-Control-Allow-Origin, but still answers`, async () => {
      const res = await request(app).get("/api/healthz").set("Origin", origin);
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  }

  for (const origin of ALLOWED) {
    it(`echoes ${origin} back`, async () => {
      const res = await request(app).get("/api/healthz").set("Origin", origin);
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
      expect(res.headers["vary"]).toMatch(/Origin/i);
    });
  }

  it("never sends the wildcard", async () => {
    const res = await request(app).get("/api/healthz").set("Origin", "https://catspotters.com");
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
  });

  it("serves a request with no Origin at all (the native app)", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("answers an allowed origin's preflight, and not an unlisted one's", async () => {
    const ok = await request(app)
      .options("/api/sightings")
      .set("Origin", "https://catspotters.com")
      .set("Access-Control-Request-Method", "POST");
    expect(ok.status).toBe(204);
    expect(ok.headers["access-control-allow-origin"]).toBe("https://catspotters.com");

    const refused = await request(app)
      .options("/api/sightings")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");
    expect(refused.headers["access-control-allow-origin"]).toBeUndefined();
    expect(refused.headers["access-control-allow-methods"]).toBeUndefined();
  });
});

describe("Replit's own domains", () => {
  it("are read from Replit's environment, not a *.replit wildcard", () => {
    const origins = replitOrigins({
      REPLIT_DOMAINS: "cat-spotter.replit.app, apptest.catspotters.com",
      REPLIT_DEV_DOMAIN: "abc123.riker.replit.dev",
      REPLIT_EXPO_DEV_DOMAIN: "abc123.expo.riker.replit.dev",
    });
    expect([...origins].sort()).toEqual([
      "https://abc123.expo.riker.replit.dev",
      "https://abc123.riker.replit.dev",
      "https://apptest.catspotters.com",
      "https://cat-spotter.replit.app",
    ]);
  });

  it("is empty off Replit", () => {
    expect(replitOrigins({}).size).toBe(0);
  });

  it("an unrelated Replit app is refused", () => {
    expect(isAllowedOrigin("https://someone-else.replit.app")).toBe(false);
  });
});
