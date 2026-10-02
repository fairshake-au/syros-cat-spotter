import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, photosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";

// hosting-and-photo-storage.md §6.2 item 4 / SYC-65 review: "keep
// Cache-Control: public, max-age=31536000, immutable, and add ETag plus
// If-None-Match support so repeat views cost nothing." Express already does
// this for free for any res.send(Buffer) when `etag` is enabled (the
// default — app.ts never disables it): a weak ETag is generated from the
// body and req.fresh drives an automatic 304 with no body on a matching
// If-None-Match. No code change was needed; this test proves that's true
// for THIS route rather than assuming Express's default behaviour holds.
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

describe("GET /api/photos/:publicId ETag / conditional requests", () => {
  it("emits an ETag alongside the immutable Cache-Control header", async () => {
    const res = await request(app).get(`/api/photos/${publicId}`);
    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBeDefined();
    expect(res.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("returns 304 with no body when If-None-Match matches the ETag", async () => {
    const first = await request(app).get(`/api/photos/${publicId}`);
    const etag = first.headers["etag"];
    expect(etag).toBeDefined();

    const second = await request(app)
      .get(`/api/photos/${publicId}`)
      .set("If-None-Match", etag);
    expect(second.status).toBe(304);
    expect(second.body).toEqual({});
    expect(second.text).toBeFalsy();
  });

  it("returns 200 with the body when If-None-Match doesn't match", async () => {
    const res = await request(app)
      .get(`/api/photos/${publicId}`)
      .set("If-None-Match", '"not-the-real-etag"');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
