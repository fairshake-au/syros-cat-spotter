import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import rateLimit from "express-rate-limit";

// Verifies the limiter configuration used for AI-backed endpoints: requests
// beyond the per-IP budget get a 429 with a JSON error, and rate-limit
// headers are emitted. Uses a fresh limiter instance (same options as
// middlewares/rateLimit.ts but a tiny budget) so the test is deterministic
// and doesn't consume the shared limiter's counters.
function appWithLimit(limit: number) {
  const app = express();
  app.set("trust proxy", 1);
  app.post(
    "/limited",
    rateLimit({
      windowMs: 60_000,
      limit,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests. Please try again later." },
    }),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  return app;
}

describe("per-IP rate limiting", () => {
  it("returns 429 with a JSON error once the budget is exhausted", async () => {
    const app = appWithLimit(2);
    await request(app).post("/limited").expect(200);
    await request(app).post("/limited").expect(200);
    const res = await request(app).post("/limited").expect(429);
    expect(res.body).toEqual({
      error: "Too many requests. Please try again later.",
    });
  });

  it("emits standard RateLimit headers", async () => {
    const app = appWithLimit(5);
    const res = await request(app).post("/limited").expect(200);
    expect(res.headers["ratelimit-limit"] ?? res.headers["ratelimit"]).toBeDefined();
  });
});
