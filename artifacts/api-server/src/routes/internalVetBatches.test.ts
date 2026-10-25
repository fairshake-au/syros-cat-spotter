import { randomBytes } from "node:crypto";
import request from "supertest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addPerson, db, photosTable, pool, vetBatchesTable } from "@workspace/db";
import app from "../app";
import { addCat, createBatch, getBatch } from "../lib/vetBatches";
import { removeTestPerson } from "../test/removeTestPerson";

// A test can make the clean-up report a failure (the route is otherwise real).
const forced = vi.hoisted(() => ({ result: null as { removed: number; failed: number } | null }));
vi.mock("../lib/vetBatches", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/vetBatches")>();
  return { ...real, removeStaleBatches: (...a: Parameters<typeof real.removeStaleBatches>) => forced.result ?? real.removeStaleBatches(...a) };
});

// SYC-677: the daily clean-up's door. MAIL_DRAIN_TOKEN only; the count is all it says.
const TOKEN = randomBytes(24).toString("base64url");
const SAVED = { ...process.env };
const email = `vitest-vetcleanup-${randomBytes(3).toString("hex")}@example.com`;
let personId = "";

beforeAll(async () => {
  personId = (await addPerson({ email, name: "Vt cleanup", addedBy: "cli:vitest", roles: ["staff"] })).id;
});

beforeEach(() => {
  process.env["MAIL_DRAIN_TOKEN"] = TOKEN;
  process.env["INTERNAL_PEOPLE_TOKEN"] = randomBytes(24).toString("base64url");
});
afterEach(() => {
  process.env = { ...SAVED };
  forced.result = null;
});
afterAll(async () => {
  await db.delete(vetBatchesTable).where(eq(vetBatchesTable.createdBy, personId));
  await removeTestPerson(email);
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
    expect(Object.keys(r.body)).toEqual(["removed", "failed"]);
    expect(Number.isInteger(r.body.removed)).toBe(true);
    expect(r.body.failed).toBe(0);
  });

  it("removes a batch untouched for more than 7 days, with its photo, and keeps a fresh one; the answer is counts", async () => {
    const jpeg = (seed: number) => sharp({ create: { width: 20, height: 20, channels: 3, background: { r: seed, g: 80, b: 120 } } }).jpeg().toBuffer();
    const old = await createBatch({ id: personId }, {});
    const fresh = await createBatch({ id: personId }, {});
    const a = await addCat(old, [await jpeg(10)]);
    const b = await addCat(fresh, [await jpeg(20)]);
    if (!a.ok || !b.ok) throw new Error("add failed");
    const oldPhoto = (await getBatch(old))!.cats[0]!.photos[0]!.photoId;
    await db.update(vetBatchesTable).set({ updatedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) }).where(eq(vetBatchesTable.id, old));

    const r = await request(app).post("/api/internal/vet-batches/cleanup").set("Authorization", `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.body.removed).toBeGreaterThanOrEqual(1);
    expect(r.body.failed).toBe(0);
    expect(await getBatch(old)).toBeNull();
    expect(await db.select().from(photosTable).where(eq(photosTable.id, oldPhoto))).toEqual([]);
    expect(await getBatch(fresh)).not.toBeNull();
  });

  it("answers 500 with the counts when a batch could not be removed, so the workflow fails", async () => {
    forced.result = { removed: 2, failed: 1 };
    const r = await request(app).post("/api/internal/vet-batches/cleanup").set("Authorization", `Bearer ${TOKEN}`);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ removed: 2, failed: 1 });
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
