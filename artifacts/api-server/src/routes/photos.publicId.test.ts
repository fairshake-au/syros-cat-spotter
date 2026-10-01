import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, photosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";
import { photoUrl } from "../lib/catHelpers";

// hosting-and-photo-storage.md §6.2 item 1 / SYC-98: unguessable photo ids.
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

describe("GET /api/photos/:id — public_id vs the legacy numeric id", () => {
  it("serves the photo bytes for the public id", async () => {
    const res = await request(app).get(`/api/photos/${publicId}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("404s for a public-id-shaped string that doesn't exist", async () => {
    const res = await request(app).get(
      "/api/photos/not-a-real-token-00000000000",
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  // SYC-112 (done in this PR; decided 1 Oct 2026, Fable review finding 3):
  // the numeric id used to 301-redirect to the public_id. That handed out
  // the exact thing it was meant to protect — the Location header *is* the
  // public_id, so walking the numeric range harvested every photo's
  // public_id in one rate-limit window, and since they're immutable and
  // cached a year, a harvested one stays valid forever. A 404 leaks
  // nothing: it looks identical whether the numeric id exists or not, and
  // carries no Location header pointing at a real public_id.
  it("a real photo's numeric id 404s — it is never served, redirected, or looked up", async () => {
    const res = await request(app)
      .get(`/api/photos/${photoId}`)
      .redirects(0);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
    expect(res.headers["location"]).toBeUndefined();
    expect(res.headers["content-type"]).not.toBe("image/jpeg");
  });

  it("404s for a numeric id that doesn't exist, identically to one that does", async () => {
    const res = await request(app).get("/api/photos/999999999").redirects(0);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("404s a numeric segment outside Postgres's int4 range instead of 500ing (nit 9)", async () => {
    const res = await request(app)
      .get("/api/photos/99999999999999999999")
      .redirects(0);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("the public id is not the sequential integer id, and isn't shaped like one", async () => {
    expect(publicId).not.toBe(String(photoId));
    expect(/^\d+$/.test(publicId)).toBe(false);
    // 128 bits of randomness — plenty long enough not to be guessable by a
    // scraper walking short strings.
    expect(publicId.length).toBeGreaterThanOrEqual(20);
  });
});

describe("catHelpers.photoUrl", () => {
  it("returns the public-id URL for a real photo", async () => {
    expect(await photoUrl(photoId)).toBe(`/api/photos/${publicId}`);
  });

  it("returns null for the primaryPhotoId: 0 sentinel without minting a token", async () => {
    expect(await photoUrl(0)).toBeNull();
  });

  it("returns null for a photo id that doesn't exist", async () => {
    expect(await photoUrl(999999999)).toBeNull();
  });
});
