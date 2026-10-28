import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  catIdentityTable,
  db,
  duplicateDecisionsTable,
  duplicateReportsTable,
  mergeFollowChangesTable,
  newCatChecksTable,
  observationsTable,
  pool,
  sightingMovesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import { daysAgo, moveKit, tag } from "../test/moveKit";
import { moveSighting } from "../test/moves";
import { recordedMerge } from "../test/merges";
import { DELETED_BY_THE_PERSON, severPerson, severTeamMember } from "./severPerson";
import { agreeWithClip } from "./teamCorrections";

// SYC-150 PR 3.1 (which-cat-is-which.md §9.11; SYC-63): deleting a person
// keeps every move, merge and decision, with who made them cleared. Spec
// test 6's deletion half (a deletion and a move at once leave no device id
// anywhere) and test 28's record half.

const kit = moveKit("VitestSeverMoves");
beforeAll(kit.cleanup);
afterAll(async () => {
  await kit.cleanup();
  await pool.end();
});

/** Every text-like column of every public table that holds `needle` (as routes/me.delete.test.ts). */
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

/** A spotter with a clipped answer on a sighting of Mimi. */
async function spotted() {
  const mimi = await kit.cat();
  const agatha = await kit.cat();
  const spotter = kit.device();
  const s = await kit.sighting(mimi, spotter);
  const ear = await kit.answer(s, "ear_tip", { clipped: true, side: "left" });
  return { mimi, agatha, spotter, s, ear };
}

describe("a deleted team member: the moves, merges and decisions stay, with nobody on them (§9.11)", () => {
  it("severTeamMember clears the mover, the merger, the decider, the checker and their statements' author", async () => {
    const who = `vitest-sever-team-${tag()}`;
    const c = await spotted();
    const agreed = await agreeWithClip({ id: who, scopes: [{ role: "staff", colonyId: null }] }, c.ear.id);
    if (agreed === "already") throw new Error("expected an agreement");
    const moved = await moveSighting(c.s.id, c.agatha, { by: who });
    const dora = await kit.cat();
    const mergeId = await recordedMerge(dora, c.agatha, undefined, who);
    const [low, high] = [c.mimi, c.agatha].sort((a, b) => a - b);
    await db.insert(duplicateDecisionsTable).values({ catLow: low!, catHigh: high!, decision: "different", byAccountId: who });
    await db.insert(newCatChecksTable).values({ catId: c.agatha, byAccountId: who });
    expect(await columnsHolding(who)).toEqual(
      expect.arrayContaining([
        "observations.account_id",
        "sighting_moves.moved_by_account_id",
        "cat_identity.by_account_id",
        "duplicate_decisions.by_account_id",
        "new_cat_checks.by_account_id",
      ]),
    );

    await db.transaction((tx) => severTeamMember(tx, { accountId: who, reason: DELETED_BY_THE_PERSON }));
    await db.transaction((tx) => severTeamMember(tx, { accountId: who, reason: DELETED_BY_THE_PERSON }));

    expect(await columnsHolding(who)).toEqual([]);
    const [move] = await db.select().from(sightingMovesTable).where(eq(sightingMovesTable.id, moved.moveId));
    expect(move).toMatchObject({ movedByAccountId: null, toCatId: c.agatha, reason: "wrong_pick" });
    expect(move!.redactedAt).not.toBeNull();
    const [merge] = await db.select().from(catIdentityTable).where(eq(catIdentityTable.id, mergeId));
    expect(merge).toMatchObject({ byAccountId: null, catId: dora, canonicalCatId: c.agatha });
    expect(merge!.redactedAt).not.toBeNull();
    const [withdrawal] = await db.select().from(observationsTable).where(eq(observationsTable.id, moved.withdrawn[0]!.id));
    expect(withdrawal).toMatchObject({ accountId: null, value: { retracted: true }, supersedesId: agreed.id });
    expect(withdrawal!.redactedAt).not.toBeNull();
  });
});

describe("a deleted spotter (SYC-63): the new tables are in the sweep", () => {
  it("clears their 'same cat?' answers and the follows a merge copied, and a moved answer keeps no device", async () => {
    const c = await spotted();
    await moveSighting(c.s.id, c.agatha);
    const [low, high] = [c.mimi, c.agatha].sort((a, b) => a - b);
    const [report] = await db
      .insert(duplicateReportsTable)
      .values({ catLow: low!, catHigh: high!, source: "spotter_question", says: "same", deviceId: c.spotter, sightingId: c.s.id })
      .returning();
    await db.insert(mergeFollowChangesTable).values({ mergeId: 1, deviceId: c.spotter, kind: "follow", rowCreatedAt: daysAgo(1) });
    expect(await columnsHolding(c.spotter)).toEqual(
      expect.arrayContaining(["duplicate_reports.device_id", "merge_follow_changes.device_id", "observations.device_id"]),
    );

    await db.transaction((tx) => severPerson(tx, { deviceId: c.spotter, reason: DELETED_BY_THE_PERSON }));

    expect(await columnsHolding(c.spotter)).toEqual([]);
    const [kept] = await db.select().from(duplicateReportsTable).where(eq(duplicateReportsTable.id, report!.id));
    expect(kept).toMatchObject({ deviceId: null, says: "same", catLow: low, catHigh: high });
    expect(kept!.redactedAt).not.toBeNull();
  });
});

describe("spec test 6 (the deletion half): a deletion and a move at once leave no device id anywhere", () => {
  // Two real transactions, each holding its locks a moment so the other has
  // to wait: once with the deletion first, once with the move first. A few
  // requests, never a load loop.
  const HOLD = sql`select pg_sleep(0.3)`;

  it("the deletion first: the move waits, then copies the answer with nobody on it", async () => {
    const c = await spotted();
    let deleting!: () => void;
    const started = new Promise<void>((r) => (deleting = r));
    await Promise.all([
      db.transaction(async (tx) => {
        await severPerson(tx, { deviceId: c.spotter, reason: DELETED_BY_THE_PERSON });
        deleting();
        await tx.execute(HOLD);
      }),
      started.then(() => moveSighting(c.s.id, c.agatha)),
    ]);
    expect(await columnsHolding(c.spotter)).toEqual([]);
    const copies = await db.select().from(observationsTable).where(eq(observationsTable.supersedesId, c.ear.id));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ catId: c.agatha, deviceId: null, roleAtTime: "public" });
  });

  it("the move first: the deletion waits, then clears the copy too", async () => {
    const c = await spotted();
    let moving!: () => void;
    const started = new Promise<void>((r) => (moving = r));
    await Promise.all([
      db.transaction(async (tx) => {
        await moveSighting(c.s.id, c.agatha, {}, tx);
        moving();
        await tx.execute(HOLD);
      }),
      started.then(() => db.transaction((tx) => severPerson(tx, { deviceId: c.spotter, reason: DELETED_BY_THE_PERSON }))),
    ]);
    expect(await columnsHolding(c.spotter)).toEqual([]);
    const copies = await db.select().from(observationsTable).where(eq(observationsTable.supersedesId, c.ear.id));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ catId: c.agatha, deviceId: null });
  });
});
