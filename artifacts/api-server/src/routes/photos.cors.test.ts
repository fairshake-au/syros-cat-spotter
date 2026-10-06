import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, photosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";

// hosting-and-photo-storage.md §6.2 item 3 / SYC-65: the photo route must
// deny the CORS header to an origin we didn't allowlist, while still
// serving the bytes to requests with no Origin header at all (native apps)
// and to the app's own catspotters.com origins (the web build).
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let photoId: number;
let publicId: string;

beforeAll(async () => {
  const [photo] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  photoId = photo!.id;
  publicId = photo!.publicId;
});

afterAll(async () => {
  await db.delete(photosTable).where(eq(photosTable.id, photoId));
  await pool.end();
});

describe("GET /api/photos/:publicId CORS", () => {
  it("serves the photo and omits ACAO for a disallowed origin", async () => {
    const res = await request(app)
      .get(`/api/photos/${publicId}`)
      .set("Origin", "https://evil-scraper.example");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("omits ACAO for a look-alike origin with no dot before catspotters (evilcatspotters.com)", async () => {
    const res = await request(app)
      .get(`/api/photos/${publicId}`)
      .set("Origin", "https://evilcatspotters.com");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("omits ACAO for a look-alike origin with catspotters.com as a subdomain of another domain", async () => {
    const res = await request(app)
      .get(`/api/photos/${publicId}`)
      .set("Origin", "https://catspotters.com.evil.io");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sets ACAO for the app's own origin", async () => {
    const res = await request(app)
      .get(`/api/photos/${publicId}`)
      .set("Origin", "https://catspotters.com");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://catspotters.com",
    );
  });

  it("sets ACAO for a catspotters.com subdomain (e.g. the web build on a preview host)", async () => {
    const res = await request(app)
      .get(`/api/photos/${publicId}`)
      .set("Origin", "https://team.catspotters.com");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://team.catspotters.com",
    );
  });

  it("sets ACAO for the Expo dev server on localhost", async () => {
    const res = await request(app)
      .get(`/api/photos/${publicId}`)
      .set("Origin", "http://localhost:8081");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://localhost:8081",
    );
  });

  it("still serves the photo with no Origin header at all (native app requests)", async () => {
    const res = await request(app).get(`/api/photos/${publicId}`);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("applies the same allow-list on other routes (SYC-106)", async () => {
    const res = await request(app)
      .get("/api/healthz")
      .set("Origin", "https://evil-scraper.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
