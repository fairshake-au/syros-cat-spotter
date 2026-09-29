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

  it("does NOT serve bytes for the numeric id — it redirects instead", async () => {
    const res = await request(app)
      .get(`/api/photos/${photoId}`)
      .redirects(0);
    expect(res.status).toBe(301);
    expect(res.headers["location"]).toBe(`/api/photos/${publicId}`);
    // The redirect response itself must carry no image bytes — walking the
    // numeric range must never yield anything but a pointer to an id you'd
    // already have to know.
    expect(res.headers["content-type"]).not.toBe("image/jpeg");
  });

  it("following the redirect lands on the real bytes", async () => {
    const redirect = await request(app)
      .get(`/api/photos/${photoId}`)
      .redirects(0);
    const followed = await request(app).get(redirect.headers["location"]);
    expect(followed.status).toBe(200);
    expect(followed.headers["content-type"]).toBe("image/jpeg");
    expect(followed.body.length).toBeGreaterThan(0);
  });

  it("404s for a numeric id that doesn't exist, rather than redirecting", async () => {
    const res = await request(app).get("/api/photos/999999999").redirects(0);
    expect(res.status).toBe(404);
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
