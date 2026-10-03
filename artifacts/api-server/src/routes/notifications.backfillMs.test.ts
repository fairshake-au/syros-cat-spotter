import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import path from "node:path";
import { db, pool, catsTable, observationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

vi.mock("../lib/push", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

import app from "../app";
import { readMigrations } from "../../../../lib/db/src/migrate/runner";

// Review of PR #67 (SYC-52), finding B1: cat_updates.created_at used to be
// the column's own now() (microsecond precision) while the observation
// routes/notifications.ts writes for the same event came from a JS Date
// (millisecond precision), so migration 0006's care-update match key
// (observed_at = cat_updates.created_at) never matched a row the admin
// route had actually written — every legacy care fact would have been
// written twice by the backfill, and its own self-check didn't notice
// because it used the same broken key.
//
// Both halves of the fix are exercised here together, through the real
// route: routes/notifications.ts now writes cat_updates.created_at from the
// exact same Date it passes as the observation's observedAt (so the two
// agree to the millisecond), and the migration's match key compares with
// BETWEEN date_trunc('milliseconds', ...) AND ... rather than `=` (so it
// still recognises older, truly-mismatched legacy rows). Running the real
// migration SQL after a real admin-route write must find both rows already
// covered and insert nothing.
const OWNER_SECRET = "backfill-ms-probe-owner-secret";
process.env["OWNER_SECRET"] = OWNER_SECRET;

afterAll(async () => {
  await pool.end();
});

async function runBackfillStatementsDirectly(): Promise<void> {
  // Mirrors lib/db/src/migrate/backfill.test.ts's "running it twice" test:
  // 0006 is already applied to this run's throwaway database (every
  // checked-in migration is applied once, in globalSetup.ts), so this
  // re-executes its forward SQL directly rather than through the runner
  // (which refuses to re-apply an already-recorded migration).
  const migrations = readMigrations(
    path.resolve(__dirname, "../../../../lib/db/migrations"),
  );
  const migration = migrations.find(
    (m) => m.tag === "0006_data_spine_backfill",
  )!;
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const statement of migration.statements) {
      await client.query(statement);
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

describe("migration 0006 after real admin-route writes (review of PR #67, finding B1)", () => {
  it("a desexed and an adopted update written through the real admin route are both already covered: the backfill inserts nothing more", async () => {
    const [cat] = await db
      .insert(catsTable)
      .values({
        name: "BackfillMsProbeCat",
        description: "",
        primaryPhotoId: 0,
        lat: 37.44,
        lng: 24.9,
        discovererDeviceId: "backfill-ms-probe-discoverer",
      })
      .returning();

    for (const updateType of ["desexed", "adopted"]) {
      const res = await request(app)
        .post(`/api/cats/${cat!.id}/updates`)
        .set("Authorization", `Bearer ${OWNER_SECRET}`)
        .send({ updateType, message: "backfill ms probe" });
      expect(res.status).toBe(201);
    }

    await runBackfillStatementsDirectly();

    const rows = await db
      .select()
      .from(observationsTable)
      .where(eq(observationsTable.catId, cat!.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.suggestionSource === null)).toBe(true);
    expect(rows.every((r) => r.accountId === "system:admin-route")).toBe(true);
  });
});
