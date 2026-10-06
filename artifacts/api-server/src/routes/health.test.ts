/**
 * SYC-200: /api/healthz says which build is running. The real values are
 * baked in by build.mjs; outside a production build both read "unknown".
 */
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import { buildInfo } from "./health";

afterAll(async () => {
  await pool.end();
});

describe("GET /api/healthz", () => {
  it("reports the commit and build time alongside status", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", commit: "unknown", builtAt: "unknown" });
  });
});

describe("buildInfo", () => {
  it("passes the baked-in values through", () => {
    expect(buildInfo("21ab9a3", "2026-10-06T09:00:00.000Z")).toEqual({
      commit: "21ab9a3",
      builtAt: "2026-10-06T09:00:00.000Z",
    });
  });

  it("says unknown when the build couldn't supply them", () => {
    expect(buildInfo(undefined, "")).toEqual({ commit: "unknown", builtAt: "unknown" });
  });
});
