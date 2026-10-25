import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool, profilesTable, deviceCredentialsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";

const D = "vitest-moments-stale";
const SECRET = "moments-stale-secret-0123456789abcdef";

async function cleanup() {
  await db.execute(sql`delete from badge_moments where device_id = ${D}`);
  await db.delete(profilesTable).where(eq(profilesTable.deviceId, D));
  await db.delete(deviceCredentialsTable).where(inArray(deviceCredentialsTable.deviceId, [D]));
}

beforeAll(async () => {
  await cleanup();
  await request(app).get(`/api/profiles/${D}`).set("X-Device-Secret", SECRET).expect(200);
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("GET /profiles/:deviceId/moments backlog", () => {
  it("retires badge moments older than 7 days, keeps week results and history", async () => {
    const ins = (kind: string, ids: string, ageDays: number) =>
      db.execute(sql`
        insert into badge_moments (device_id, kind, badge_ids, created_at)
        values (${D}, ${kind}, ${sql.raw(ids)}::text[], now() - ${ageDays} * interval '1 day')`);
    await ins("badges", "array['weeks_2']", 10); // stale
    await ins("badges", "array['areas_3']", 2); // fresh
    await ins("week_result", "'{}'", 30); // old but kept
    await ins("history", "array['weeks_4']", 30); // old but kept

    const res = await request(app).get(`/api/profiles/${D}/moments`).set("X-Device-Secret", SECRET);
    expect(res.status).toBe(200);
    const got = res.body.moments.map((m: { kind: string; badgeIds: string[] }) => [m.kind, m.badgeIds]);
    expect(got).toEqual([
      ["badges", ["areas_3"]],
      ["week_result", []],
      ["history", ["weeks_4"]],
    ]);

    // The stale one was marked celebrated in the same request.
    const stale = await db.execute(sql`
      select celebrated_at from badge_moments where device_id = ${D} and badge_ids = array['weeks_2']`);
    expect(stale.rows[0]!.celebrated_at).not.toBeNull();
  });
});
