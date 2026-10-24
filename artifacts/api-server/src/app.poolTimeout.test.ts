import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool, POOL_CONNECTION_TIMEOUT_MS, IDLE_IN_TRANSACTION_TIMEOUT_MS } from "@workspace/db";
import app from "./app";

afterAll(async () => {
  await pool.end();
});

// SYC-407: with every pool connection held, the next database call must fail
// fast with a clear error rather than wait for ever.
describe("the shared database pool", () => {
  it("has a connection timeout and an idle-in-transaction timeout", async () => {
    expect(POOL_CONNECTION_TIMEOUT_MS).toBe(10_000);
    expect((pool.options as { connectionTimeoutMillis?: number }).connectionTimeoutMillis).toBe(
      POOL_CONNECTION_TIMEOUT_MS,
    );
    const { rows } = await pool.query("show idle_in_transaction_session_timeout");
    // Postgres reports 60000 ms as "1min".
    expect(rows[0].idle_in_transaction_session_timeout).toBe("1min");
    expect(IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(60_000);
  });

  it("fails fast, with a clear error, when every connection is held", async () => {
    const opts = pool.options as { connectionTimeoutMillis?: number; max?: number };
    const original = opts.connectionTimeoutMillis;
    const held = [];
    try {
      for (let i = 0; i < (opts.max ?? 10); i++) held.push(await pool.connect());
      // The real limit is 10 s; shortened here so the test is quick. The
      // setting is read at each checkout.
      opts.connectionTimeoutMillis = 300;
      const started = Date.now();
      await expect(pool.query("select 1")).rejects.toThrow(/timeout exceeded when trying to connect/i);
      expect(Date.now() - started).toBeLessThan(3000);

      // And a real route answers 503 with Retry-After, not a hang or a 500.
      const res = await request(app).get("/api/cats");
      expect(res.status).toBe(503);
      expect(res.headers["retry-after"]).toBe("5");
      expect(res.body).toEqual({ error: "We're busy right now. Please try again in a moment." });
    } finally {
      opts.connectionTimeoutMillis = original;
      for (const c of held) c.release();
    }
    // Back to normal once the connections are returned.
    const { rows } = await pool.query("select 1 as ok");
    expect(rows[0].ok).toBe(1);
  });

  it("lets a hurt-cat report through when the limiter's counter times out (fail-open)", async () => {
    const { allowNewDevice } = await import("./middlewares/newDeviceLimit");
    const opts = pool.options as { connectionTimeoutMillis?: number; max?: number };
    const original = opts.connectionTimeoutMillis;
    const held = [];
    try {
      for (let i = 0; i < (opts.max ?? 10); i++) held.push(await pool.connect());
      opts.connectionTimeoutMillis = 300;
      expect(await allowNewDevice("203.0.113.9", Date.now(), { failOpen: true })).toBe(true);
      await expect(allowNewDevice("203.0.113.9", Date.now())).rejects.toThrow(/timeout exceeded/i);
    } finally {
      opts.connectionTimeoutMillis = original;
      for (const c of held) c.release();
    }
  });
});
