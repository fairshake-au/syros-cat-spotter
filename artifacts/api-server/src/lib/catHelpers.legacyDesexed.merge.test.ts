import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { catIdentityTable, catUpdatesTable, catsTable, db, pool } from "@workspace/db";
import { like } from "drizzle-orm";

// Before the data spine's backfill is recorded, the sterilised line comes from
// the legacy `desexed` care update. Forced here by a gate that says "not yet".
vi.mock("./pr3Gate", () => ({ pr3Recorded: vi.fn(async () => false) }));

import { deriveCatStatuses } from "./catHelpers";

// SYC-410 PR 1.2, spec test 15 for the legacy `desexed` fallback: a desexed
// update on a cat merged into this one counts for her; after the undo, not.

const NAME_PREFIX = "VitestLegacyDesexed";
const LETTERS = "bcdfghjkmpqrvwxz";
let counter = 0;
const tag = () => {
  counter += 1;
  let n = counter;
  let out = "";
  do {
    out = LETTERS[n % 16] + out;
    n = Math.floor(n / 16);
  } while (n > 0);
  return out;
};

async function cleanup() {
  await db.delete(catUpdatesTable).where(like(catUpdatesTable.message, `${NAME_PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function cat(): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${NAME_PREFIX}${tag()}`, primaryPhotoId: 0, lat: 37.44, lng: 24.94, discovererDeviceId: "vitest-legacy" })
    .returning({ id: catsTable.id });
  return c!.id;
}

describe("deriveCatStatuses (legacy fallback), with a merge", () => {
  it("a desexed update on Mimi counts for Agatha while they are merged, and not before or after", async () => {
    const mimi = await cat();
    const agatha = await cat();
    await db.insert(catUpdatesTable).values({ catId: mimi, updateType: "desexed", message: `${NAME_PREFIX}desexed` });
    const sterilised = async (id: number) => (await deriveCatStatuses([{ id, ownerDeviceId: null }])).get(id)!.sterilised.value;

    expect(await sterilised(agatha)).not.toBe(true);
    expect(await sterilised(mimi)).toBe(true);

    const [m] = await db
      .insert(catIdentityTable)
      .values({ catId: mimi, canonicalCatId: agatha, reason: "vitest legacy" })
      .returning({ id: catIdentityTable.id });
    expect(await sterilised(agatha)).toBe(true);
    expect(await sterilised(mimi)).toBe(true);

    await db.insert(catIdentityTable).values({ catId: mimi, canonicalCatId: mimi, supersedesId: m!.id, reason: "vitest legacy undo" });
    expect(await sterilised(agatha)).not.toBe(true);
    expect(await sterilised(mimi)).toBe(true);
  });
});
