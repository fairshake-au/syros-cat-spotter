import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { jsonErrorHandler } from "./app";

// The handler is registered last in app.ts (after the /api router), so any
// error thrown by a route flows into it. Here we exercise the exported
// handler with throwing routes mounted before it, mirroring that layout.
function makeApp() {
  const app = express();
  app.get("/boom", () => {
    throw new Error("secret internal detail: select * from profiles");
  });
  app.get("/boom-async", async () => {
    throw new Error("async failure with sql: insert into cats values ($1)");
  });
  app.use(jsonErrorHandler);
  return app;
}

describe("JSON error handler", () => {
  it("returns JSON with no stack trace or SQL when a route throws", async () => {
    const res = await request(makeApp()).get("/boom");
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({
      error: "Something went wrong. Please try again.",
    });
    expect(res.text).not.toMatch(/secret internal detail/);
    expect(res.text).not.toMatch(/at .*\.ts/);
  });

  it("handles async rejections from route handlers as JSON too", async () => {
    const res = await request(makeApp()).get("/boom-async");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: "Something went wrong. Please try again.",
    });
  });
});
