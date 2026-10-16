import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";
import app, { jsonErrorHandler } from "./app";

afterAll(async () => {
  await pool.end();
});

const SPOT_TOO_LARGE = "This spot is too large to send. Remove a photo and try again.";
const TOO_LARGE = "This request is too large.";

// SYC-415 spec §6.4: a spot too large to send is fixable (remove a photo),
// not a server failure the phone would retry for ever. One request per route
// (memory note: no high-volume port experiments).
describe("an oversize request body", () => {
  it("on POST /api/sightings gets 413 with the spot wording, not a 500", async () => {
    const big = "a".repeat(26 * 1024 * 1024);
    const res = await request(app)
      .post("/api/sightings")
      .set("Content-Type", "application/json")
      .send(`{"deviceId":"x","photoBase64":"${big}","lat":37.4,"lng":24.9}`);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: SPOT_TOO_LARGE });
    expect(res.headers["cache-control"]).toBe("no-store");
  }, 60_000);

  it("on any other route gets 413 with a plain reason (review of #212)", async () => {
    const big = "a".repeat(26 * 1024 * 1024);
    const res = await request(app)
      .post("/api/profiles/x/username")
      .set("Content-Type", "application/json")
      .send(`{"username":"${big}"}`);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: TOO_LARGE });
  }, 60_000);
});

describe("jsonErrorHandler and a too-large body", () => {
  function fakes(method: string, path: string) {
    const warn = vi.fn();
    const error = vi.fn();
    const req = { method, path, log: { warn, error } } as unknown as Request;
    const res = {
      headersSent: false,
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    return { req, res, warn, error };
  }
  const tooLarge = Object.assign(new Error("request entity too large"), {
    type: "entity.too.large",
    limit: 26214400,
    length: 27262976,
    // body-parser never attaches the body, but if anything did, it must not
    // reach the log.
    body: "SECRET-PHOTO-BYTES",
  });

  it("logs a warning with the limit, the length and the path, and never body content", () => {
    const { req, res, warn, error } = fakes("POST", "/api/sightings");
    jsonErrorHandler(tooLarge, req, res as unknown as Response, (() => {}) as NextFunction);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { limit: 26214400, length: 27262976, path: "/api/sightings" },
      "request body too large",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-PHOTO-BYTES");
    expect(error).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({ error: SPOT_TOO_LARGE });
  });

  it("uses the plain reason away from POST /api/sightings", () => {
    for (const [method, path] of [
      ["POST", "/api/profiles/x/username"],
      ["PUT", "/api/sightings"],
    ] as const) {
      const { req, res } = fakes(method, path);
      jsonErrorHandler(tooLarge, req, res as unknown as Response, (() => {}) as NextFunction);
      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.json).toHaveBeenCalledWith({ error: TOO_LARGE });
    }
  });
});
