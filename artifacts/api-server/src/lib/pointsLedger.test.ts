import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pointsLedgerTable } from "@workspace/db";
import { asc, eq, like, sql } from "drizzle-orm";
import { awardPoints } from "./pointsLedger";
import { POINTS_CONFIRM } from "./points";
import { athensDay, weekStartAthens } from "./weeks";

// SYC-150 PR 2.1 (plan C4, spec which-cat-is-which.md §9.8): points for
// finding a duplicate are their own ledger rows, with no sighting. They never
// make a same-day spot of the same cat a repeat: the once-a-day index and
// awardPoints' check both cover sighting rows only.

const DEVICE = "vitest-ledger-dup";
// Ledger rows hold no foreign keys; ids nothing else in the run uses.
const CAT = -715_001;
const OTHER_CAT = -715_002;
let nextSighting = -715_100;

async function cleanup() {
  await db.delete(pointsLedgerTable).where(like(pointsLedgerTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
afterAll(cleanup);

async function duplicateAward(deviceId: string, catId: number, at: Date) {
  await db.execute(sql`
    insert into points_ledger
      (device_id, sighting_id, duplicate_cat_low, duplicate_cat_high, cat_id,
       points, athens_day, week_start, earned_at, source)
    values
      (${deviceId}, null, ${OTHER_CAT}, ${catId}, ${catId},
       10, ${athensDay(at)}::date, ${weekStartAthens(at)}::date, ${at}, 'duplicate')
  `);
}

function spot(deviceId: string, catId: number, at: Date) {
  return db.transaction((tx) =>
    awardPoints(tx, { deviceId, sightingId: nextSighting--, catId, isNewCat: false, at }),
  );
}

describe("awardPoints beside duplicate-finder points (C4)", () => {
  it("pays a duplicate award and a same-day spot of the same cat both in full", async () => {
    const device = `${DEVICE}-both`;
    const at = new Date();
    await duplicateAward(device, CAT, at);
    const award = await spot(device, CAT, at);
    expect(award).toEqual({ points: POINTS_CONFIRM, repeatToday: false });
    const rows = await db
      .select({ points: pointsLedgerTable.points, sightingId: pointsLedgerTable.sightingId })
      .from(pointsLedgerTable)
      .where(eq(pointsLedgerTable.deviceId, device))
      .orderBy(asc(pointsLedgerTable.id));
    expect(rows.map((r) => r.points)).toEqual([10, POINTS_CONFIRM]);
    expect(rows[0]!.sightingId).toBeNull();
  });

  it("still pays a second spot of the same cat the same day nothing", async () => {
    const device = `${DEVICE}-repeat`;
    const at = new Date();
    await duplicateAward(device, CAT, at);
    expect(await spot(device, CAT, at)).toEqual({ points: POINTS_CONFIRM, repeatToday: false });
    expect(await spot(device, CAT, at)).toEqual({ points: 0, repeatToday: true });
  });
});
