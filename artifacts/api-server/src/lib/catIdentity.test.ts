import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catIdentityTable, catsTable, db, pool } from "@workspace/db";
import { like } from "drizzle-orm";
import { identityRowPastTheGuard } from "../test/merges";
import { MAX_MERGE_HOPS, canonicalCatOf, catsFeeding, catsMergedAway } from "./catIdentity";

// SYC-410 (which-cat-is-which.md §9.3; spec tests 15's core and 16): the one
// reader of merges, given rows inserted directly into cat_identity.
//
// cat_identity is append-only: this file's rows stay, naming only its own
// (deleted) cats, and the throwaway database goes at the end of the run.

const NAME_PREFIX = "VitestCatIdentity";
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

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 9));

async function cat(): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${NAME_PREFIX}${tag()}`, primaryPhotoId: 0, lat: 37.44, lng: 24.94, discovererDeviceId: "vitest-identity" })
    .returning({ id: catsTable.id });
  return c!.id;
}

async function merge(from: number, into: number, createdAt?: Date): Promise<number> {
  const [row] = await db
    .insert(catIdentityTable)
    .values({ catId: from, canonicalCatId: into, reason: "vitest merge", ...(createdAt ? { createdAt } : {}) })
    .returning({ id: catIdentityTable.id });
  return row!.id;
}

async function undo(mergeId: number, catId: number, createdAt?: Date): Promise<void> {
  await db.insert(catIdentityTable).values({
    catId,
    canonicalCatId: catId,
    supersedesId: mergeId,
    reason: "vitest undo",
    ...(createdAt ? { createdAt } : {}),
  });
}

const canonical = async (id: number, asOf?: Date) => (await canonicalCatOf([id], { asOf })).get(id);
const feeding = async (id: number, asOf?: Date) => (await catsFeeding([id], { asOf })).get(id)!.ids.sort((a, b) => a - b);
const sorted = (...ids: number[]) => [...ids].sort((a, b) => a - b);

describe("canonicalCatOf and catsFeeding", () => {
  it("a cat with no merge is its own cat, fed only by itself", async () => {
    const mimi = await cat();
    expect(await canonical(mimi)).toBe(mimi);
    expect(await feeding(mimi)).toEqual([mimi]);
    expect(await catsMergedAway([mimi])).toEqual(new Set());
  });

  it("a merge: Mimi is Agatha now, and Mimi's records feed Agatha", async () => {
    const mimi = await cat();
    const agatha = await cat();
    await merge(mimi, agatha);
    expect(await canonical(mimi)).toBe(agatha);
    expect(await canonical(agatha)).toBe(agatha);
    expect(await feeding(agatha)).toEqual(sorted(agatha, mimi));
    expect(await catsMergedAway([mimi, agatha])).toEqual(new Set([mimi]));
  });

  it("merge then undo: the undone merge counts for nothing", async () => {
    const mimi = await cat();
    const agatha = await cat();
    await undo(await merge(mimi, agatha), mimi);
    expect(await canonical(mimi)).toBe(mimi);
    expect(await feeding(agatha)).toEqual([agatha]);
    expect(await feeding(mimi)).toEqual([mimi]);
    expect(await catsMergedAway([mimi, agatha])).toEqual(new Set());
  });

  it("test 16: a chain Mimi → Agatha → Dora counts for Dora; undoing Agatha → Dora leaves Mimi in Agatha", async () => {
    const mimi = await cat();
    const agatha = await cat();
    const dora = await cat();
    await merge(mimi, agatha, day(3));
    const later = await merge(agatha, dora, day(5));
    expect(await canonical(mimi)).toBe(dora);
    expect(await feeding(dora)).toEqual(sorted(dora, agatha, mimi));
    // Agatha, though merged away, is still fed by the cat merged into her.
    expect(await feeding(agatha)).toEqual(sorted(agatha, mimi));
    // Mimi counts for Dora from the newer merge on her way there.
    const f = (await catsFeeding([dora])).get(dora)!;
    expect(f.since.get(mimi)).toEqual(day(5));
    expect(f.since.get(agatha)).toEqual(day(5));
    expect((await catsFeeding([agatha])).get(agatha)!.since.get(mimi)).toEqual(day(3));

    await undo(later, agatha, day(7));
    expect(await canonical(mimi)).toBe(agatha);
    expect(await canonical(agatha)).toBe(agatha);
    expect(await feeding(dora)).toEqual([dora]);
    expect(await feeding(agatha)).toEqual(sorted(agatha, mimi));
  });

  it("a loop has no canonical cat, and feeds nothing: each cat keeps its own records", async () => {
    const x = await cat();
    const y = await cat();
    const z = await cat();
    await merge(x, y);
    await merge(y, x);
    // z leads into the loop.
    await merge(z, x);
    expect(await canonical(x)).toBeNull();
    expect(await canonical(y)).toBeNull();
    expect(await canonical(z)).toBeNull();
    expect(await feeding(x)).toEqual([x]);
    expect(await feeding(y)).toEqual([y]);
    // Nobody reads their records, so none of them is left out of a list.
    expect(await catsMergedAway([x, y, z])).toEqual(new Set());
  });

  it(`a chain of ${MAX_MERGE_HOPS} merges resolves; one more is too deep, and feeds nothing`, async () => {
    const chain: number[] = [];
    for (let i = 0; i <= MAX_MERGE_HOPS + 1; i++) chain.push(await cat());
    for (let i = 0; i <= MAX_MERGE_HOPS; i++) await merge(chain[i]!, chain[i + 1]!);
    const end = chain[MAX_MERGE_HOPS + 1]!;
    expect(await canonical(chain[1]!)).toBe(end);
    expect(await canonical(chain[0]!)).toBeNull();
    const fed = await feeding(end);
    expect(fed).toContain(chain[1]);
    expect(fed).not.toContain(chain[0]);
  });

  it("two standing merges for one cat (bad data): the newest counts", async () => {
    const twice = await cat();
    const old = await cat();
    const newer = await cat();
    await merge(twice, old, day(2));
    await merge(twice, newer, day(4));
    expect(await canonical(twice)).toBe(newer);
    expect(await feeding(old)).toEqual([old]);
    expect(await feeding(newer)).toEqual(sorted(newer, twice));
  });

  it("review A1: two merges of one cat, the newer undone: the older, overridden merge stays dead", async () => {
    const mimi = await cat();
    const agatha = await cat();
    const dora = await cat();
    await merge(mimi, agatha, day(2));
    const newer = await merge(mimi, dora, day(4));
    await undo(newer, mimi, day(6));
    expect(await canonical(mimi, day(5))).toBe(dora);
    expect(await canonical(mimi)).toBe(mimi);
    expect(await feeding(agatha)).toEqual([agatha]);
    expect(await feeding(dora)).toEqual([dora]);
    expect(await catsMergedAway([mimi])).toEqual(new Set());
  });

  it("review A2: an undo row on another cat undoes nothing of Mimi's", async () => {
    const mimi = await cat();
    const agatha = await cat();
    const m = await merge(mimi, agatha, day(2));
    // Since migration 0054 the database refuses the row outright…
    await expect(undo(m, agatha, day(3))).rejects.toMatchObject({ cause: { message: expect.stringMatching(/supersedes only a merge of its own cat/) } });
    // …and a reader still ignores it if it ever got in.
    await identityRowPastTheGuard({ catId: agatha, canonicalCatId: agatha, supersedesId: m, reason: "vitest undo", createdAt: day(3) });
    expect(await canonical(mimi)).toBe(agatha);
    expect(await feeding(agatha)).toEqual(sorted(agatha, mimi));
  });

  it("two merges of one cat, the OLDER undone: the newer one still stands", async () => {
    const mimi = await cat();
    const agatha = await cat();
    const dora = await cat();
    const older = await merge(mimi, agatha, day(2));
    await merge(mimi, dora, day(4));
    await undo(older, mimi, day(6));
    expect(await canonical(mimi)).toBe(dora);
    expect(await feeding(dora)).toEqual(sorted(dora, mimi));
    expect(await feeding(agatha)).toEqual([agatha]);
  });

  it("asOf: the merges as they stood then, an undo counting only once entered", async () => {
    const mimi = await cat();
    const agatha = await cat();
    await undo(await merge(mimi, agatha, day(5)), mimi, day(8));
    expect(await canonical(mimi, day(4))).toBe(mimi);
    expect(await canonical(mimi, day(6))).toBe(agatha);
    expect(await canonical(mimi, day(9))).toBe(mimi);
    expect(await feeding(agatha, day(4))).toEqual([agatha]);
    expect(await feeding(agatha, day(6))).toEqual(sorted(agatha, mimi));
    expect(await feeding(agatha, day(9))).toEqual([agatha]);
  });

  it("excludeKinds: coat and markings stay each cat's own", async () => {
    const mimi = await cat();
    const agatha = await cat();
    await merge(mimi, agatha);
    const f = (await catsFeeding([agatha], { excludeKinds: ["coat", "markings"] })).get(agatha)!;
    expect(f.counts({ catId: mimi, kind: "sterilised" })).toBe(true);
    expect(f.counts({ catId: mimi, kind: "coat" })).toBe(false);
    expect(f.counts({ catId: mimi, kind: "markings" })).toBe(false);
    expect(f.counts({ catId: agatha, kind: "coat" })).toBe(true);
    const other = await cat();
    expect(f.counts({ catId: other, kind: "sterilised" })).toBe(false);
    // Without the option every kind counts.
    expect((await catsFeeding([agatha])).get(agatha)!.counts({ catId: mimi, kind: "coat" })).toBe(true);
  });

  it("answers many cats in one call, and nothing for no cats", async () => {
    const a = await cat();
    const b = await cat();
    await merge(a, b);
    const c = await canonicalCatOf([a, b, a]);
    expect([...c.entries()].sort()).toEqual([[a, b], [b, b]].sort());
    expect((await canonicalCatOf([])).size).toBe(0);
    expect((await catsFeeding([])).size).toBe(0);
  });
});
