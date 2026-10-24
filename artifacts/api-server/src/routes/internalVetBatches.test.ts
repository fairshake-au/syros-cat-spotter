import { randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import app from "../app";

// SYC-677: the daily clean-up's door. MAIL_DRAIN_TOKEN only; the count is all it says.
const TOKEN = randomBytes(24).toString("base64url");
const SAVED = { ...process.env };

beforeEach(() => {
  process.env["MAIL_DRAIN_TOKEN"] = TOKEN;
  process.env["INTERNAL_PEOPLE_TOKEN"] = randomBytes(24).toString("base64url");
});
afterEach(() => {
  process.env = { ...SAVED };
});
afterAll(async () => {
  await pool.end();
});

describe("POST /api/internal/vet-batches/cleanup", () => {
  it("refuses no token and a wrong token", async () => {
    expect((await request(app).post("/api/internal/vet-batches/cleanup")).status).toBe(401);
    const bad = await request(app).post("/api/internal/vet-batches/cleanup").set("Authorization", "Bearer nope");
    expect(bad.status).toBe(401);
  });

  it("fails closed when no token is configured", async () => {
    delete process.env["MAIL_DRAIN_TOKEN"];
    const r = await request(app).post("/api/internal/vet-batches/cleanup").set("Authorization", `Bearer ${TOKEN}`);
    expect(r.status).toBe(503);
  });

  it("answers a count and nothing else", async () => {
    const r = await request(app).post("/api/internal/vet-batches/cleanup").set("Authorization", `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body)).toEqual(["removed"]);
    expect(Number.isInteger(r.body.removed)).toBe(true);
  });

  it("the pre-launch gate lets this path through with the drain token, and with nothing else", async () => {
    process.env["PRELAUNCH_GATE"] = "on";
    process.env["PRELAUNCH_SESSION_KEYS"] = Buffer.alloc(32, 9).toString("base64url");
    process.env["PRELAUNCH_TESTER_KEYS"] = "a-tester-key";
    const PATH = "/api/internal/vet-batches/cleanup";
    expect((await request(app).post(PATH).set("Authorization", `Bearer ${TOKEN}`)).status).toBe(200);
    expect((await request(app).post(PATH)).status).toBe(401);
    expect((await request(app).post(PATH).set("X-Prelaunch-Key", "a-tester-key")).status).toBe(401);
    // Only POST, only exactly this path.
    expect((await request(app).get(PATH).set("Authorization", `Bearer ${TOKEN}`)).status).toBe(401);
    expect((await request(app).post(`${PATH}/x`).set("Authorization", `Bearer ${TOKEN}`)).status).toBe(401);
    expect((await request(app).post("/api/internal/vet-batches").set("Authorization", `Bearer ${TOKEN}`)).status).toBe(401);
  });
});
