import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catIdentityTable, catsTable, db, pool } from "@workspace/db";
import { like } from "drizzle-orm";
import { catsFeeding, feedingAt, mergeTimeline } from "./catIdentity";

// SYC-150 PR 3.1 (which-cat-is-which.md §9.10): the dated merge timeline
// answers catsFeeding's question at any moment, in TypeScript, from one
// load. Held here to the SQL rule (catsFeeding({ asOf })) for every cat of
// each cast, at every day around its merges and undos.

const NAME_PREFIX = "VitestMergeTimeline";
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
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

const day = (d: number) => new Date(Date.UTC(2026, 8, d, 9));

async function cat(): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${NAME_PREFIX}${tag()}`, primaryPhotoId: 0, lat: 37.44, lng: 24.94, discovererDeviceId: "vitest-timeline", createdAt: day(1) })
    .returning({ id: catsTable.id });
  return c!.id;
}
async function merge(from: number, into: number, d: number): Promise<number> {
  const [row] = await db.insert(catIdentityTable).values({ catId: from, canonicalCatId: into, reason: "vitest timeline", createdAt: day(d) }).returning();
  return row!.id;
}
async function undo(mergeId: number, catId: number, d: number) {
  await db.insert(catIdentityTable).values({ catId, canonicalCatId: catId, supersedesId: mergeId, reason: "vitest timeline undo", createdAt: day(d) });
}

const CASTS: { name: string; build: (c: number[]) => Promise<void> }[] = [
  { name: "a merge", build: async ([a, b]) => void (await merge(a!, b!, 3)) },
  { name: "a merge, undone", build: async ([a, b]) => undo(await merge(a!, b!, 3), a!, 6) },
  {
    name: "a chain of two, the later link undone",
    build: async ([a, b, d]) => {
      await merge(a!, b!, 3);
      await undo(await merge(b!, d!, 5), b!, 8);
    },
  },
  {
    name: "two merges of one cat, the newer undone",
    build: async ([a, b, d]) => {
      await merge(a!, b!, 3);
      await undo(await merge(a!, d!, 5), a!, 7);
    },
  },
  {
    name: "a loop",
    build: async ([a, b]) => {
      await merge(a!, b!, 3);
      await merge(b!, a!, 5);
    },
  },
];

describe.each(CASTS)("feedingAt agrees with catsFeeding({ asOf }): $name", ({ build }) => {
  it("for every cat, on every day", async () => {
    const cats = [await cat(), await cat(), await cat()];
    await build(cats);
    const timeline = await mergeTimeline([cats[0]!]);
    expect(timeline.length).toBeGreaterThan(0);
    for (let d = 2; d <= 9; d++) {
      const sql = await catsFeeding(cats, { asOf: day(d) });
      for (const id of cats) {
        expect(feedingAt(timeline, id, day(d)), `cat ${cats.indexOf(id)} on day ${d}`).toEqual(sql.get(id)!.since);
      }
    }
  });
});
