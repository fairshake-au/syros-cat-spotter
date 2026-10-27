import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, like, sql } from "drizzle-orm";
import { db, deviceCredentialsTable, markLeft, observationsTable, pool, sightingMovesTable, sightingsTable } from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { daysAgo, moveKit, tag } from "../test/moveKit";
import { signedPerson, type Signed } from "../test/roleKit";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { DELETED_BY_THE_PERSON, severPerson } from "../lib/severPerson";
import { moveSightingsIn, type MoveInput } from "../lib/moveSightings";

// SYC-150 PR 3.2 (which-cat-is-which.md §9.7 locks, §9.13 tests 6 and 13):
// a move racing a deletion, another move, and a late answer. Each race is a
// few real transactions, each held open at a known point while the other is
// seen waiting on a lock (pg_stat_activity), never a load loop. A held move
// runs `moveSightingsIn` (the route's own work) inside a transaction the
// test holds; the rest go through the routes.

const KEY = "vitest-move-race-key-0123456789abcdef-0123456789ab";
const kit = moveKit("VitestMoveRace");
let staff: Signed;
let person: { id: string; scopes: { role: string; colonyId: number | null }[] };

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await kit.cleanup();
  staff = await signedPerson(`racer${tag()}`, ["staff"]);
  person = { id: staff.id, scopes: [{ role: "staff", colonyId: null }] };
});
afterAll(async () => {
  await kit.cleanup();
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${kit.devicePrefix}%`));
  await markLeft(staff.email, "cli:vitest");
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const move = (body: object) =>
  request(app).post("/api/team/sightings/move").set("Origin", TEAM_ORIGIN).set("Cookie", staff.cookie).send(body);

/** Waits until `n` backends of this database are waiting on a lock (a second at most, then red). */
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

/** A transaction held open after `work`, until `release()`. */
function held<T>(work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) {
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

/** Every text-like column of every public table that holds `needle` (as severPerson.moves.test.ts). */
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

/** Mimi with a sighting to move (and one that stays), the spotter's clipped answer on it, and Agatha. */
async function spotted() {
  const mimi = await kit.cat();
  const agatha = await kit.cat();
  await kit.sighting(mimi, kit.device(), daysAgo(9));
  const spotter = kit.device();
  const s = await kit.sighting(mimi, spotter, daysAgo(3));
  const ear = await kit.answer(s, "ear_tip", { clipped: true, side: "left" });
  const body: MoveInput = { sightingIds: [s.id], expectedCatId: mimi, toCatId: agatha, reason: "wrong_pick", source: "cat_page" };
  return { mimi, agatha, spotter, s, ear, body };
}

const sever = (deviceId: string) => db.transaction((tx) => severPerson(tx, { deviceId, reason: DELETED_BY_THE_PERSON }));

describe("spec test 6: a deletion and a move at once leave no device id anywhere", () => {
  it("the deletion first: the move waits for it, then moves the sighting with nobody on it", async () => {
    const c = await spotted();
    const deleting = held((tx) => severPerson(tx, { deviceId: c.spotter, reason: DELETED_BY_THE_PERSON }));
    await deleting.done;
    const moving = move(c.body).then((r) => r);
    await waitersAtLeast(1);
    deleting.release();
    await deleting.committed;
    const res = await moving;
    expect(res.status).toBe(200);
    expect(await columnsHolding(c.spotter)).toEqual([]);
    const [copy] = await db.select().from(observationsTable).where(eq(observationsTable.supersedesId, c.ear.id));
    expect(copy).toMatchObject({ catId: c.agatha, deviceId: null, roleAtTime: "public" });
  });

  it("the move first: the deletion waits for it, then clears the copy too", async () => {
    const c = await spotted();
    const moving = held((tx) => moveSightingsIn(tx, person, c.body));
    await moving.done;
    const deleting = sever(c.spotter);
    await waitersAtLeast(1);
    moving.release();
    await moving.committed;
    await deleting;
    expect(await columnsHolding(c.spotter)).toEqual([]);
    const [copy] = await db.select().from(observationsTable).where(eq(observationsTable.supersedesId, c.ear.id));
    expect(copy).toMatchObject({ catId: c.agatha, deviceId: null });
  });

  it("the deletion arriving mid-move (the move held at the cats' lock): both finish, in the lock order, with no deadlock", async () => {
    // The move is stopped at §9.7 lock 4 by a third transaction holding the
    // old cat's row. Taken in the spec's order, the move already holds the
    // spotter's badges lock there, so the deletion waits for it at its first
    // step. Taken in any order that reaches the sightings before the badges
    // lock, the deletion gets in between and the two wait for each other.
    const c = await spotted();
    const gate = held((tx) => tx.execute(sql`select id from cats where id = ${c.mimi} for update`));
    await gate.done;
    const moving = move(c.body).then((r) => r);
    await waitersAtLeast(1);
    const deleting = sever(c.spotter).then(
      () => "deleted",
      (err: unknown) => err,
    );
    await waitersAtLeast(2);
    gate.release();
    await gate.committed;
    const [res, deleted] = await Promise.all([moving, deleting]);
    expect(deleted).toBe("deleted");
    expect(res.status).toBe(200);
    expect(await columnsHolding(c.spotter)).toEqual([]);
  });
});

describe("spec test 13: two moves at once, and a move and a late answer at once", () => {
  it("two moves of one sighting at once: exactly one succeeds; the other is told someone changed it", async () => {
    const c = await spotted();
    const dora = await kit.cat();
    const [a, b] = await Promise.all([move(c.body), move({ ...c.body, toCatId: dora })]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    const winner = a.status === 200 ? a : b;
    expect(loser.body.code).toBe("MOVED_ALREADY");
    expect(loser.body.current).toEqual([{ sightingId: c.s.id, catId: winner.body.toCatId, status: "resolved" }]);
    expect(await db.select().from(sightingMovesTable).where(eq(sightingMovesTable.sightingId, c.s.id))).toHaveLength(1);
    const [s] = await db.select().from(sightingsTable).where(eq(sightingsTable.id, c.s.id));
    expect(s!.catId).toBe(winner.body.toCatId);
  });

  const SECRET = "vitest-move-race-secret-0123456789abcd";
  const answer = (sightingId: number, deviceId: string, body: object) =>
    request(app).post(`/api/sightings/${sightingId}/answers`).set("X-Device-Secret", SECRET).send({ deviceId, ...body });
  const bind = async (deviceId: string) =>
    expect((await request(app).get(`/api/profiles/${deviceId}/username`).set("X-Device-Secret", SECRET)).status).toBe(200);

  it("an answer sent while the move is saving waits, then lands on the cat the sighting is filed under (Agatha)", async () => {
    const c = await spotted();
    await bind(c.spotter);
    const moving = held((tx) => moveSightingsIn(tx, person, c.body));
    await moving.done;
    const answering = answer(c.s.id, c.spotter, { foodAndWater: "yes" }).then((r) => r);
    await waitersAtLeast(1);
    moving.release();
    await moving.committed;
    const res = await answering;
    expect(res.status).toBe(200);
    expect(res.body.recorded).toEqual(["food_and_water"]);
    const rows = await db
      .select()
      .from(observationsTable)
      .where(and(eq(observationsTable.sightingId, c.s.id), eq(observationsTable.kind, "food_and_water")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ catId: c.agatha, deviceId: c.spotter, value: { present: true } });
  });

  it("an answer that gets in first lands on Mimi, and the move then carries it to Agatha", async () => {
    const c = await spotted();
    await bind(c.spotter);
    // Hold the answers lock the route takes, so the answer queues on it
    // first and the move (after its badges lock) queues behind it.
    const gate = held((tx) =>
      tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sighting-answers:${c.spotter}`}), ${c.mimi})`),
    );
    await gate.done;
    const answering = answer(c.s.id, c.spotter, { foodAndWater: "no" }).then((r) => r);
    await waitersAtLeast(1);
    const moving = move(c.body).then((r) => r);
    await waitersAtLeast(2);
    gate.release();
    await gate.committed;
    const [a, m] = await Promise.all([answering, moving]);
    expect(a.status).toBe(200);
    expect(m.status).toBe(200);
    const rows = await db
      .select()
      .from(observationsTable)
      .where(and(eq(observationsTable.sightingId, c.s.id), eq(observationsTable.kind, "food_and_water")));
    const original = rows.find((r) => r.catId === c.mimi)!;
    expect(original).toMatchObject({ deviceId: c.spotter, value: { present: false } });
    expect(rows.find((r) => r.catId === c.agatha)).toMatchObject({ supersedesId: original.id, deviceId: c.spotter });
  });
});
