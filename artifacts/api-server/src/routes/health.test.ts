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
    expect(res.body).toEqual({
      status: "ok",
      commit: "unknown",
      builtAt: "unknown",
      turnstile: { mode: "off", secret: "not_configured" },
    });
  });

  it("SYC-170: reports the Turnstile mode, and not_configured without the secret (never the secret)", async () => {
    const saved = [process.env["TURNSTILE_MODE"], process.env["TURNSTILE_SECRET_KEY"]];
    try {
      process.env["TURNSTILE_MODE"] = "observe";
      delete process.env["TURNSTILE_SECRET_KEY"];
      let res = await request(app).get("/api/healthz");
      expect(res.body.turnstile).toEqual({ mode: "observe", secret: "not_configured" });
      process.env["TURNSTILE_SECRET_KEY"] = "0x-health-secret";
      res = await request(app).get("/api/healthz");
      expect(res.body.turnstile).toEqual({ mode: "observe", secret: "configured" });
      expect(JSON.stringify(res.body)).not.toContain("0x-health-secret");
    } finally {
      if (saved[0] === undefined) delete process.env["TURNSTILE_MODE"];
      else process.env["TURNSTILE_MODE"] = saved[0];
      if (saved[1] === undefined) delete process.env["TURNSTILE_SECRET_KEY"];
      else process.env["TURNSTILE_SECRET_KEY"] = saved[1];
    }
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
