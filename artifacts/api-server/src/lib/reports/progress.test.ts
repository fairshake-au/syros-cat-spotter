import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catsTable, db, observationsTable, pool } from "@workspace/db";
import { like } from "drizzle-orm";
import { SEED_AREAS } from "../areas/namedAreas";
import { catsAt, fewestFirst, loadProgressInputs, MAX_POINTS, pointOf, pointTimes, type ProgressInputs } from "./progress";
import { parseRange } from "./range";

// SYC-396 PR 3.3a, Task 3.3a.3: Sterilisation progress. Each point is the
// records as they stood on that date ("as of" means entered by then,
// Decision 10). Rows here carry chosen `createdAt`s, which only a test does;
// observations are append-only, so they stay, and every assertion is on this
// file's own cats.

const NAME_PREFIX = `VitestProgress${Date.now()}`;
let counter = 0;
const now = new Date("2026-10-18T13:40:00Z");

async function catCreated(at: Date) {
  counter += 1;
  const [cat] = await db
    .insert(catsTable)
    .values({ name: `${NAME_PREFIX}-${counter}`, description: "", primaryPhotoId: 0, lat: 37.44, lng: 24.9, discovererDeviceId: "vitest-progress", createdAt: at })
    .returning();
  return cat!;
}

async function said(catId: number, value: unknown, entered: Date, observedAt = entered) {
  await db.insert(observationsTable).values({
    catId,
    kind: "sterilised",
    value: value as object,
    accountId: "vitest-progress-staff",
    roleAtTime: "staff",
    observedAt,
    createdAt: entered,
  });
}

/** The inputs, narrowed to this file's cats. */
async function mine(ids: number[]): Promise<ProgressInputs> {
  const all = await loadProgressInputs(now);
  return { ...all, cats: all.cats.filter((c) => ids.includes(c.id)) };
}

afterAll(async () => {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  await pool.end();
});

let late: number;
let early: number;
beforeAll(async () => {
  const a = await catCreated(new Date("2026-09-01T09:00:00Z"));
  // Sterilised on 29 Sep, but the operation was only entered on 1 Oct.
  await said(a.id, { sterilised: true }, new Date("2026-10-01T09:00:00Z"), new Date("2026-09-29T09:00:00Z"));
  late = a.id;
  const b = await catCreated(new Date("2026-09-01T09:00:00Z"));
  await said(b.id, { sterilised: true }, new Date("2026-09-10T09:00:00Z"));
  early = b.id;
});

describe("a point uses the records as they stood then", () => {
  it("the point for 30 Sep counts a sterilisation entered on 1 Oct as not there yet", async () => {
    const inputs = await mine([late, early]);
    const range = parseRange({ range: "custom", from: "2026-09-01", to: "2026-09-30" }, now);
    const times = pointTimes(range, new Date("2026-09-01T09:00:00Z"));
    const last = times[times.length - 1]!;
    expect(last).toEqual(range.to);
    expect(pointOf(catsAt(inputs, last, SEED_AREAS), last)).toEqual({ at: last, confirmed: 1, street: 2 });
    const oct2 = new Date("2026-10-02T09:00:00Z");
    expect(pointOf(catsAt(inputs, oct2, SEED_AREAS), oct2)).toMatchObject({ confirmed: 2, street: 2 });
  });

  it("a cat not yet entered is not counted at all", async () => {
    const inputs = await mine([late, early]);
    const aug = new Date("2026-08-20T09:00:00Z");
    expect(pointOf(catsAt(inputs, aug, SEED_AREAS), aug)).toMatchObject({ confirmed: 0, street: 0 });
  });
});

describe("when the points fall", () => {
  it("week ends for 3 months or less, always ending at the range's end", () => {
    const range = parseRange({ range: "3months" }, now);
    const times = pointTimes(range, new Date("2020-01-01"));
    expect(times.length).toBeGreaterThanOrEqual(13);
    expect(times.length).toBeLessThanOrEqual(15);
    expect(times[times.length - 1]).toEqual(now);
    for (let i = 1; i < times.length; i++) expect(times[i]!.getTime()).toBeGreaterThan(times[i - 1]!.getTime());
  });

  it("month ends for longer, at most MAX_POINTS, keeping the first and the last", () => {
    const range = parseRange({ range: "all" }, now);
    const first = new Date("2022-01-15T10:00:00Z");
    const times = pointTimes(range, first);
    expect(times).toHaveLength(MAX_POINTS);
    expect(times[times.length - 1]).toEqual(now);
    // The end of January 2022 on Syros.
    expect(times[0]!.toISOString()).toBe("2022-01-31T21:59:59.999Z");
  });
});

describe("the colonies' order", () => {
  it("fewest confirmed sterilised first, colonies with no street cats last, ties by name", () => {
    const split = (s: number, n: number) => ({ sterilised: s, probably: 0, not_sterilised: n, not_known: 0 });
    const rows = fewestFirst([
      { name: "Empty", split: split(0, 0) },
      { name: "Half B", split: split(2, 2) },
      { name: "All", split: split(3, 0) },
      { name: "None", split: split(0, 5) },
      { name: "Half A", split: split(1, 1) },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["None", "Half A", "Half B", "All", "Empty"]);
  });
});
