import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "./app";
import { containsNul, NUL_MESSAGE } from "./middlewares/refuseNul";

afterAll(async () => {
  await pool.end();
});

// SYC-406: Postgres refuses \u0000 in text; the app answers 400 before any
// route runs, instead of a 500 from the database.
describe("containsNul", () => {
  it("finds a NUL in strings, keys, arrays and nested objects", () => {
    expect(containsNul("a\u0000b")).toBe(true);
    expect(containsNul({ a: { b: ["x", "y\u0000"] } })).toBe(true);
    expect(containsNul({ ["k\u0000"]: 1 })).toBe(true);
  });
  it("leaves ordinary bodies alone, including a literal backslash-u0000", () => {
    expect(containsNul({ a: "hello", n: 1, b: null, c: [true] })).toBe(false);
    expect(containsNul(JSON.parse('{"a":"\\\\u0000"}'))).toBe(false);
    expect(containsNul(Buffer.from("a\u0000b"))).toBe(false);
    expect(containsNul(undefined)).toBe(false);
  });
});

describe("a NUL character in a JSON body", () => {
  const nulBody = '{"deviceId":"x","note":"hi\\u0000there","lat":37.4,"lng":24.9}';

  for (const path of [
    "/api/reports",
    "/api/reports/drafts",
    "/api/sightings",
    "/api/issues",
    "/api/profiles/x/username",
  ]) {
    it(`on POST ${path} is a 400 with a plain message, not a 500`, async () => {
      const res = await request(app)
        .post(path)
        .set("Content-Type", "application/json")
        .send(nulBody);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: NUL_MESSAGE });
      expect(res.headers["cache-control"]).toBe("no-store");
    });
  }

  it("nested deep in an object is still refused", async () => {
    const res = await request(app)
      .post("/api/sightings")
      .set("Content-Type", "application/json")
      .send('{"a":{"b":[{"c":"\\u0000"}]}}');
    expect(res.status).toBe(400);
  });

  it("is refused in a form-encoded body too", async () => {
    const res = await request(app)
      .post("/api/reports")
      .type("form")
      .send("note=hi%00there");
    expect(res.status).toBe(400);
  });

  it("is refused on the dashboard path as well, with no CORS involved", async () => {
    const res = await request(app)
      .post("/api/team/anything")
      .set("Content-Type", "application/json")
      .send(nulBody);
    expect(res.status).toBe(400);
  });

  it("does not stop a body without one reaching its route", async () => {
    const res = await request(app)
      .post("/api/reports")
      .set("Content-Type", "application/json")
      .send('{"note":"fine"}');
    // Whatever the route says about this body, it was not the NUL guard.
    expect(res.body).not.toEqual({ error: NUL_MESSAGE });
  });
});
