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
});
