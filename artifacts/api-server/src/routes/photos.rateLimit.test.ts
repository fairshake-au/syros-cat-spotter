import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";

// hosting-and-photo-storage.md §6.2 item 2 / SYC-65: the photo route must
// carry its own per-IP budget (previously: none at all — only
// POST /api/sightings and POST /api/cats/name-suggestions had a limiter).
// This drives the real exported photoLimiter (300 requests / 15 min) past
// its budget rather than a scaled-down stand-in, so it proves the actual
// route wiring, not just the limiter's config shape.
afterAll(async () => {
  await pool.end();
});

describe("GET /api/photos/:id rate limiting", () => {
  it(
    "429s once the per-IP budget (300 / 15 min) is exceeded",
    async () => {
      let lastStatus = 0;
      for (let i = 0; i < 301; i++) {
        // Nonexistent id: the limiter runs before the route handler, so a
        // 404 underneath doesn't affect the count.
        const res = await request(app).get("/api/photos/999999999");
        lastStatus = res.status;
        if (lastStatus === 429) break;
      }
      expect(lastStatus).toBe(429);
    },
    20000,
  );
});
