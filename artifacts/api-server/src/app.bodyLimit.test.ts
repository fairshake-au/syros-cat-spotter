import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "./app";

afterAll(async () => {
  await pool.end();
});

// SYC-415 spec §6.4: a spot too large to send is fixable (remove a photo),
// not a server failure the phone would retry for ever. One request only
// (memory note: no high-volume port experiments).
describe("an oversize request body", () => {
  it("gets 413 with a JSON reason, not a 500", async () => {
    const big = "a".repeat(26 * 1024 * 1024);
    const res = await request(app)
      .post("/api/sightings")
      .set("Content-Type", "application/json")
      .send(`{"deviceId":"x","photoBase64":"${big}","lat":37.4,"lng":24.9}`);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: "This spot is too large to send. Remove a photo and try again.",
    });
    expect(res.headers["cache-control"]).toBe("no-store");
  }, 60_000);
});
