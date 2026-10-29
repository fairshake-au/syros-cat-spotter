import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, like, sql } from "drizzle-orm";
import { catSubscriptionsTable, db, deviceCredentialsTable, markLeft, pool, sightingsTable } from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { daysAgo, moveKit, tag } from "../test/moveKit";
import { signedPerson, type Signed } from "../test/roleKit";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { canonicalCatOf } from "../lib/catIdentity";
import { DELETED_BY_THE_PERSON, severPerson } from "../lib/severPerson";
import { MergeRefused, mergeCatsIn, type MergeInput } from "../lib/mergeCats";
import { moveSightingsIn } from "../lib/moveSightings";

// SYC-59 PR 4.1 (which-cat-is-which.md §9.2, §9.7 locks; spec test 16a): a
// merge racing a resolve, a move and a deletion. Each race is a few real
// transactions, one held open at a known point while the other is seen
// waiting on a lock (pg_stat_activity), never a load loop. A held merge runs
// `mergeCatsIn` (the route's own work) inside a transaction the test holds.

const KEY = "vitest-merge-race-key-0123456789abcdef-0123456789a";
const kit = moveKit("VitestMergeRace");
let staff: Signed;
let person: { id: string; scopes: { role: string; colonyId: number | null }[] };

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await kit.cleanup();
  staff = await signedPerson(`mracer${tag()}`, ["staff"]);
  person = { id: staff.id, scopes: [{ role: "staff", colonyId: null }] };
});
afterAll(async () => {
  await kit.cleanup();
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${kit.devicePrefix}%`));
  await markLeft(staff.email, "cli:vitest");
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

/** Waits until `n` backends of this database are waiting on a lock (five seconds at most, then red). */
async function waitersAtLeast(n: number): Promise<void> {
  const until = Date.now() + 5_000;
  for (;;) {
    const r = await pool.query<{ n: number }>(
      "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
    );
    if (r.rows[0]!.n >= n) return;
    if (Date.now() > until) throw new Error(`expected ${n} waiting on a lock, saw ${r.rows[0]!.n}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** A transaction held open after `work`, until `release()`. */
function held<T>(work: (tx: Tx) => Promise<T>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let ready!: (v: T) => void;
  const done = new Promise<T>((r) => (ready = r));
  const committed = db.transaction(async (tx) => {
    const out = await work(tx);
    ready(out);
    await gate;
    return out;
  });
  return { done, release, committed };
}

/** Every text-like column of every public table that holds `needle`. */
async function columnsHolding(needle: string): Promise<string[]> {
  const cols = await db.execute<{ table_name: string; column_name: string }>(sql`
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and t.table_type = 'BASE TABLE'
       and c.data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY')`);
  const hits: string[] = [];
  for (const { table_name, column_name } of cols.rows) {
    const r = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table_name)}
          where ${sql.identifier(column_name)}::text like ${"%" + needle + "%"}`,
    );
    if (r.rows[0]!.n > 0) hits.push(`${table_name}.${column_name}`);
  }
  return hits;
}

const SECRET = "vitest-merge-race-secret-0123456789abc";
const resolve = (sightingId: number, deviceId: string, catId: number) =>
  request(app).post(`/api/sightings/${sightingId}/resolve`).set("X-Device-Secret", SECRET).send({ deviceId, catId, pickedFrom: "nearby" });
const bind = async (deviceId: string) =>
  expect((await request(app).get(`/api/profiles/${deviceId}/username`).set("X-Device-Secret", SECRET)).status).toBe(200);
const merge = (body: MergeInput) => request(app).post("/api/team/cats/merge").set("Origin", TEAM_ORIGIN).set("Cookie", staff.cookie).send(body);

const sightingRow = async (id: number) => (await db.select().from(sightingsTable).where(eq(sightingsTable.id, id)))[0]!;

/** Agatha (one sighting) and Mimi (one sighting from `spotter`); the merge's body. */
async function pair(spotter = kit.device()) {
  const agatha = await kit.cat(daysAgo(60));
  const mimi = await kit.cat(daysAgo(40));
  await kit.sighting(agatha, kit.device(), daysAgo(30));
  const s = await kit.sighting(mimi, spotter, daysAgo(5));
  const body: MergeInput = { survivorId: agatha, mergedId: mimi, expectedSightingCounts: [1, 1], reasonText: "Same cat", survivorChosen: "default" };
  return { agatha, mimi, s, spotter, body };
}

async function pendingFrom(deviceId: string) {
  const [p] = await db
    .insert(sightingsTable)
    .values({ deviceId, photoId: await kit.photo(), lat: 37.4441, lng: 24.9412, status: "pending", createdAt: new Date() })
    .returning();
  return p!;
}

/** No resolved sighting is filed under a cat that is merged away (§9.2). */
async function noSightingOnAMergedAwayCat(catIds: number[]) {
  const canonical = await canonicalCatOf(catIds);
  for (const id of catIds) {
    if (canonical.get(id) === id) continue;
    const left = await db.select().from(sightingsTable).where(and(eq(sightingsTable.catId, id), eq(sightingsTable.status, "resolved")));
    expect(left).toEqual([]);
  }
}

describe("spec test 16a: a resolve racing a merge never leaves a resolved sighting on the merged-away cat", () => {
  it("the merge first: the resolve waits, then files the sighting under the survivor", async () => {
    const c = await pair();
    const e = kit.device();
    await bind(e);
    const p = await pendingFrom(e);
    const merging = held((tx) => mergeCatsIn(tx, person, c.body));
    await merging.done;
    const resolving = resolve(p.id, e, c.mimi).then((r) => r);
    await waitersAtLeast(1);
    merging.release();
    await merging.committed;
    const res = await resolving;
    expect(res.status).toBe(200);
    expect(res.body.cat.id).toBe(c.agatha);
    expect((await sightingRow(p.id)).catId).toBe(c.agatha);
    await noSightingOnAMergedAwayCat([c.mimi]);
  });

  it("the resolve first: the merge waits for it, sees one more sighting than the screen showed, and is refused (STALE)", async () => {
    const c = await pair();
    const e = kit.device();
    const p = await pendingFrom(e);
    // A resolve onto Mimi, in flight: the cat locked as the route locks it, the sighting filed.
    const resolving = held(async (tx) => {
      await tx.execute(sql`select id from cats where id = ${c.mimi} for share`);
      await tx.update(sightingsTable).set({ catId: c.mimi, status: "resolved" }).where(eq(sightingsTable.id, p.id));
    });
    await resolving.done;
    const merging = merge(c.body).then((r) => r);
    await waitersAtLeast(1);
    resolving.release();
    await resolving.committed;
    const res = await merging;
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("STALE");
    expect((await canonicalCatOf([c.mimi])).get(c.mimi)).toBe(c.mimi);
    expect((await sightingRow(p.id)).catId).toBe(c.mimi);
  });

  it("the database's own check: a merge whose moves missed a resolved sighting is refused at commit", async () => {
    const c = await pair();
    // mergeCatsIn, but the merged-away cat gets another resolved sighting inside the same transaction after its moves.
    const e = kit.device();
    const p = await pendingFrom(e);
    const err = await db
      .transaction(async (tx) => {
        await mergeCatsIn(tx, person, c.body);
        await tx.execute(sql`alter table sightings disable trigger sightings_not_under_merged_away`);
        await tx.update(sightingsTable).set({ catId: c.mimi, status: "resolved" }).where(eq(sightingsTable.id, p.id));
        await tx.execute(sql`alter table sightings enable trigger sightings_not_under_merged_away`);
      })
      .then(
        () => null,
        (e: unknown) => e as { message: string; cause?: { message: string } },
      );
    expect(`${err?.message} ${err?.cause?.message}`).toMatch(/still has resolved sightings/);
    expect((await canonicalCatOf([c.mimi])).get(c.mimi)).toBe(c.mimi);
    expect((await sightingRow(p.id)).status).toBe("pending");
  });
});

describe("a merge racing a move", () => {
  it("the move first: the merge waits, sees one sighting fewer, and is refused (STALE)", async () => {
    const c = await pair();
    await kit.sighting(c.mimi, kit.device(), daysAgo(9));
    const dora = await kit.cat(daysAgo(80));
    const moving = held((tx) =>
      moveSightingsIn(tx, person, { sightingIds: [c.s.id], expectedCatId: c.mimi, toCatId: dora, reason: "wrong_pick", source: "cat_page" }),
    );
    await moving.done;
    const merging = merge({ ...c.body, expectedSightingCounts: [1, 2] }).then((r) => r);
    await waitersAtLeast(1);
    moving.release();
    await moving.committed;
    const res = await merging;
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("STALE");
    expect((await sightingRow(c.s.id)).catId).toBe(dora);
  });

  it("the merge first: the move waits, then is told the sighting changed (MOVED_ALREADY)", async () => {
    const c = await pair();
    await kit.sighting(c.mimi, kit.device(), daysAgo(9));
    const dora = await kit.cat(daysAgo(80));
    const merging = held((tx) => mergeCatsIn(tx, person, { ...c.body, expectedSightingCounts: [1, 2] }));
    await merging.done;
    const moving = request(app)
      .post("/api/team/sightings/move")
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", staff.cookie)
      .send({ sightingIds: [c.s.id], expectedCatId: c.mimi, toCatId: dora, reason: "wrong_pick", source: "cat_page" })
      .then((r) => r);
    await waitersAtLeast(1);
    merging.release();
    await merging.committed;
    const res = await moving;
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MOVED_ALREADY");
    expect((await sightingRow(c.s.id)).catId).toBe(c.agatha);
  });
});

describe("two merges sharing a cat at once (review of #390, R6)", () => {
  it("Mimi→Agatha and Agatha→Dora together, with one spotter in all three: one succeeds, the other is refused, no deadlock, nothing stranded", async () => {
    const dora = await kit.cat(daysAgo(90));
    const agatha = await kit.cat(daysAgo(60));
    const mimi = await kit.cat(daysAgo(40));
    const shared = kit.device();
    for (const cat of [dora, agatha, mimi]) await kit.sighting(cat, shared, daysAgo(10));
    const body = (survivorId: number, mergedId: number): MergeInput => ({ survivorId, mergedId, expectedSightingCounts: [1, 1], reasonText: "Same cat", survivorChosen: "default" });
    const run = (survivorId: number, mergedId: number) =>
      db
        .transaction((tx) => mergeCatsIn(tx, person, body(survivorId, mergedId)))
        .then(() => "ok")
        .catch((e: unknown) => (e instanceof MergeRefused ? e.code : `ERR ${String(e)}`));
    const out = await Promise.all([run(agatha, mimi), run(dora, agatha)]);
    expect(out.filter((o) => o === "ok")).toHaveLength(1);
    expect(out.filter((o) => o.startsWith("ERR"))).toEqual([]);
    await noSightingOnAMergedAwayCat([dora, agatha, mimi]);
  });
});

describe("a merge racing the spotter's deletion: no device id left anywhere", () => {
  const sever = (deviceId: string) => db.transaction((tx) => severPerson(tx, { deviceId, reason: DELETED_BY_THE_PERSON }));

  it("the merge first (it holds the spotter's badges lock): the deletion waits, then clears everything the merge wrote", async () => {
    const spotter = kit.device();
    const c = await pair(spotter);
    await db.insert(catSubscriptionsTable).values({ deviceId: spotter, catId: c.mimi });
    const merging = held((tx) => mergeCatsIn(tx, person, c.body));
    await merging.done;
    const deleting = sever(spotter).then(() => "deleted");
    await waitersAtLeast(1);
    merging.release();
    await merging.committed;
    expect(await deleting).toBe("deleted");
    expect((await sightingRow(c.s.id)).catId).toBe(c.agatha);
    expect(await columnsHolding(spotter)).toEqual([]);
  });

  it("the deletion first: the merge waits, then moves the sighting with nobody on it", async () => {
    const spotter = kit.device();
    const c = await pair(spotter);
    await db.insert(catSubscriptionsTable).values({ deviceId: spotter, catId: c.mimi });
    const deleting = held((tx) => severPerson(tx, { deviceId: spotter, reason: DELETED_BY_THE_PERSON }));
    await deleting.done;
    const merging = merge(c.body).then((r) => r);
    await waitersAtLeast(1);
    deleting.release();
    await deleting.committed;
    const res = await merging;
    expect(res.status).toBe(200);
    expect(await sightingRow(c.s.id)).toMatchObject({ catId: c.agatha, deviceId: null });
    expect(await columnsHolding(spotter)).toEqual([]);
  });
});
