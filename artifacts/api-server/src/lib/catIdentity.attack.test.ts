import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { catIdentityTable, catsTable, db, observationsTable, pool } from "@workspace/db";
import { like } from "drizzle-orm";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import { canonicalCatOf, catsFeeding, catsMergedAway } from "./catIdentity";
import { claimEligibility } from "./claiming";
import { loadCatRecords, resolveAt } from "./observations";
import { resolveCat } from "./resolve";
import { loadTeamCats } from "./teamCatList";

// Adversarial review of PR #375 (SYC-410): try to make an undone merge count.
// Each test states what the spec says should happen; a red test is a finding.
// Kept as regression tests. A11 is `it.fails` until PR 3.1 (spec §9.10).

const NAME_PREFIX = "VitestIdentityAttack";
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

async function cat(createdAt = day(1)): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${NAME_PREFIX}${tag()}`, primaryPhotoId: 0, lat: 37.44, lng: 24.94, discovererDeviceId: "vitest-attack", createdAt })
    .returning({ id: catsTable.id });
  return c!.id;
}

async function merge(from: number, into: number, createdAt?: Date): Promise<number> {
  const [row] = await db
    .insert(catIdentityTable)
    .values({ catId: from, canonicalCatId: into, reason: "attack merge", ...(createdAt ? { createdAt } : {}) })
    .returning({ id: catIdentityTable.id });
  return row!.id;
}

async function undo(mergeId: number, catId: number, createdAt?: Date): Promise<number> {
  const [row] = await db
    .insert(catIdentityTable)
    .values({ catId, canonicalCatId: catId, supersedesId: mergeId, reason: "attack undo", ...(createdAt ? { createdAt } : {}) })
    .returning({ id: catIdentityTable.id });
  return row!.id;
}

async function sterilised(catId: number, at = day(2)) {
  await db.insert(observationsTable).values({
    catId,
    kind: "sterilised",
    value: { sterilised: true },
    accountId: "vitest-attack-staff",
    roleAtTime: "staff",
    observedAt: at,
    createdAt: at,
  });
}

const canonical = async (id: number, asOf?: Date) => (await canonicalCatOf([id], { asOf })).get(id);
const feeding = async (id: number, asOf?: Date) => (await catsFeeding([id], { asOf })).get(id)!.ids.sort((a, b) => a - b);
const sorted = (...ids: number[]) => [...ids].sort((a, b) => a - b);
const sterilisedOf = async (catId: number, asOf?: Date) => {
  const r = (await loadCatRecords([catId], db, { asOf })).get(catId)!;
  return resolveCat(r.observations, r.evidenceOfLife, asOf ?? new Date()).sterilised.value;
};

describe("attack: undone merges", () => {
  it("A1 two standing rows, the newer undone: the older, overridden merge comes back to life", async () => {
    // Mimi → Agatha (day 2), then Mimi → Dora (day 4) with no undo between
    // (the "several rows stand, newest wins" bad-data case), then the team
    // undoes the merge they can see (Mimi → Dora, day 6). Mimi's newest row is
    // now "Mimi is Mimi". The spec's undo (§4.4) says Mimi's statements stop
    // counting; nothing undid the Agatha merge, but it had already lost.
    const mimi = await cat();
    const agatha = await cat();
    const dora = await cat();
    await sterilised(mimi);
    await merge(mimi, agatha, day(2));
    const m2 = await merge(mimi, dora, day(4));
    await undo(m2, mimi, day(6));
    expect(await canonical(mimi, day(5))).toBe(dora);
    expect(await canonical(mimi)).toBe(mimi);
    expect(await feeding(agatha)).toEqual([agatha]);
    expect(await sterilisedOf(agatha)).toBeNull();
    expect(await catsMergedAway([mimi])).toEqual(new Set());
  });

  it("A2 an undo row naming another cat undoes nothing of Mimi's", async () => {
    // supersedes_id has no FK and no same-cat check: an undo written on
    // Agatha's id that points at Mimi's merge.
    const mimi = await cat();
    const agatha = await cat();
    const m = await merge(mimi, agatha, day(2));
    await undo(m, agatha, day(3));
    expect(await canonical(mimi)).toBe(agatha);
  });

  it("A3 undo of a middle link (refused by the write path, read anyway): Mimi alone, Agatha still in Dora", async () => {
    const mimi = await cat();
    const agatha = await cat();
    const dora = await cat();
    const m1 = await merge(mimi, agatha, day(2));
    await merge(agatha, dora, day(3));
    await undo(m1, mimi, day(4));
    expect(await canonical(mimi)).toBe(mimi);
    expect(await canonical(agatha)).toBe(dora);
    expect(await feeding(dora)).toEqual(sorted(dora, agatha));
    expect(await feeding(agatha)).toEqual([agatha]);
  });

  it("A4 re-merge after undo into another cat: only the new survivor is fed; asOf sees each window", async () => {
    const mimi = await cat();
    const agatha = await cat();
    const dora = await cat();
    await sterilised(mimi);
    const m1 = await merge(mimi, agatha, day(2));
    await undo(m1, mimi, day(4));
    await merge(mimi, dora, day(6));
    expect(await canonical(mimi)).toBe(dora);
    expect(await feeding(agatha)).toEqual([agatha]);
    expect(await feeding(dora)).toEqual(sorted(dora, mimi));
    expect(await canonical(mimi, day(3))).toBe(agatha);
    expect(await canonical(mimi, day(5))).toBe(mimi);
    expect(await canonical(mimi, day(7))).toBe(dora);
    expect(await sterilisedOf(agatha)).toBeNull();
    expect(await sterilisedOf(agatha, day(3))).toBe(true);
    expect(await sterilisedOf(agatha, day(5))).toBeNull();
    expect(await sterilisedOf(dora)).toBe(true);
  });

  it("A5 equal created_at: a merge and its undo in one transaction leave nothing at that instant", async () => {
    const mimi = await cat();
    const agatha = await cat();
    const at = day(9);
    await undo(await merge(mimi, agatha, at), mimi, at);
    expect(await canonical(mimi, at)).toBe(mimi);
    expect(await feeding(agatha, at)).toEqual([agatha]);
  });

  it("A6 equal created_at: two merges of one cat at one instant, the higher id wins everywhere", async () => {
    const mimi = await cat();
    const agatha = await cat();
    const dora = await cat();
    const at = day(9);
    await merge(mimi, agatha, at);
    await merge(mimi, dora, at);
    expect(await canonical(mimi)).toBe(dora);
    expect(await feeding(agatha)).toEqual([agatha]);
    expect(await feeding(dora)).toEqual(sorted(dora, mimi));
  });

  it("A7 an undo whose own row is backdated before the merge still undoes it now", async () => {
    const mimi = await cat();
    const agatha = await cat();
    await undo(await merge(mimi, agatha, day(5)), mimi, day(3));
    expect(await canonical(mimi)).toBe(mimi);
    expect(await canonical(mimi, day(4))).toBe(mimi);
    expect(await canonical(mimi, day(6))).toBe(mimi);
  });

  it("A8 a chain into a loop: Mimi → Agatha → Dora → Agatha. Nobody hidden, nobody fed", async () => {
    const mimi = await cat();
    const agatha = await cat();
    const dora = await cat();
    await merge(mimi, agatha, day(2));
    await merge(agatha, dora, day(3));
    await merge(dora, agatha, day(4));
    expect(await canonical(mimi)).toBeNull();
    expect(await catsMergedAway([mimi, agatha, dora])).toEqual(new Set());
    expect(await feeding(agatha)).toEqual([agatha]);
    expect(await feeding(dora)).toEqual([dora]);
  });

  it("A9 undo of the loop-closing link heals the chain", async () => {
    const mimi = await cat();
    const agatha = await cat();
    const dora = await cat();
    await merge(mimi, agatha, day(2));
    await merge(agatha, dora, day(3));
    const loop = await merge(dora, agatha, day(4));
    await undo(loop, dora, day(5));
    expect(await canonical(mimi)).toBe(dora);
    expect(await feeding(dora)).toEqual(sorted(dora, agatha, mimi));
    expect(await catsMergedAway([mimi, agatha, dora])).toEqual(new Set([mimi, agatha]));
  });

  it("A10 readers agree on A1: list, records and claim all treat Mimi as herself", async () => {
    const mimi = await cat();
    const agatha = await cat();
    const dora = await cat();
    await sterilised(mimi);
    await merge(mimi, agatha, day(2));
    const m2 = await merge(mimi, dora, day(4));
    await undo(m2, mimi, day(6));
    const listed = new Set((await loadTeamCats()).map((t) => t.id));
    expect(listed.has(mimi)).toBe(true);
    // Past the merged-away refusal: refused only because this phone never met her.
    expect(await claimEligibility(db, { catId: mimi, deviceId: "vitest-attack-none" })).toEqual({ ok: false, code: "NOT_MET" });
  });

  // Known gap, fixed in PR 3.1 (spec §9.10): records loaded with withHistory
  // know only the merges standing at load time, so resolveAt can't see a
  // merge undone since. Flip to `it` when PR 3.1's merge timeline lands.
  it.fails("A11 resolveAt agrees with loadCatRecords({ asOf }) inside an undone merge's window (spec §9.10)", async () => {
    // The CatHistory contract: resolveAt(records, T, now) is
    // loadCatRecords(…, { asOf: T }) then resolveCat, for records loaded at
    // or after T.
    const mimi = await cat();
    const agatha = await cat();
    await sterilised(mimi, day(2));
    await undo(await merge(mimi, agatha, day(3)), mimi, day(6));
    const T = day(4);
    const now = day(4);
    const history = (await loadCatRecords([agatha], db, { withHistory: true })).get(agatha)!;
    const viaAsOf = await sterilisedOf(agatha, T);
    expect(viaAsOf).toBe(true);
    expect(resolveAt(history, T, now)!.sterilised.value).toBe(viaAsOf);
  });
});
