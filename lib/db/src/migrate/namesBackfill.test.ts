import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { foldName } from "../fold";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
  rollbackLast,
} from "./runner";

// Data spine PR 3b (docs/superpowers/plans/data-spine.md, "PR 3b"): the
// current-names backfill (0011_data_spine_names_backfill), on a throwaway
// database brought up to just before it and seeded like production (plain
// English names) plus Greek and accented ones.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `names_backfill_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

const migrations = readMigrations(defaultMigrationsFolder());
const BACKFILL = migrations.find(
  (m) => m.tag === "0011_data_spine_names_backfill",
)!;
const BEFORE = migrations.find((m) => m.idx === BACKFILL.idx - 1)!.idx;
const runBackfill = () =>
  migrateUp(c, migrations, { throughIdx: BACKFILL.idx });

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
});

afterAll(async () => {
  await c.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

beforeEach(async () => {
  const tables = await c.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  if (tables.rows.length) {
    for (const t of tables.rows) {
      await c.query(`alter table if exists "${t.tablename}" disable trigger all`);
    }
    await c.query(
      `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`,
    );
  }
  await migrateUp(c, migrations, { throughIdx: BEFORE });
});

async function seedCat(catName: string, createdAt: Date): Promise<number> {
  const r = await c.query<{ id: number }>(
    `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id, created_at)
     values ($1, 0, 37.44, 24.94, 'discoverer', $2) returning id`,
    [catName, createdAt],
  );
  return r.rows[0]!.id;
}

/** A name observation exactly as data spine PR 2's go-forward writes make it. */
async function pr2Name(catId: number, catName: string, observedAt: Date) {
  await c.query(
    `insert into observations (cat_id, kind, value, device_id, role_at_time, authority_scope, observed_at)
     values ($1, 'name', $2, 'owner-device', 'public', 'owner_of_this_cat', $3)`,
    [catId, JSON.stringify({ name: catName, normalised: foldName(catName) }), observedAt],
  );
}

interface NameRow {
  cat_id: number;
  name: string;
  normalised: string;
  observed_at: Date;
  account_id: string | null;
  role_at_time: string;
  authority_scope: string;
  provenance: string;
  suggestion_source: string | null;
}

async function nameRows(catId?: number): Promise<NameRow[]> {
  const r = await c.query<NameRow>(
    `select cat_id, value->>'name' as name, value->>'normalised' as normalised,
            observed_at, account_id, role_at_time, authority_scope, provenance,
            suggestion_source
       from observations
      where kind = 'name' and ($1::int is null or cat_id = $1)
      order by cat_id, observed_at, id`,
    [catId ?? null],
  );
  return r.rows;
}

const day = (d: string) => new Date(`${d}T09:30:00.123456Z`);

describe("0011_data_spine_names_backfill (data spine PR 3b)", () => {
  it("writes one name per cat: its current name, folded form copied from the cat, dated at created_at", async () => {
    const seeds: [string, Date][] = [
      ["Sunny Paws", day("2026-08-01")],
      ["Krispy", day("2026-09-20")],
      ["Μιμή", day("2026-09-21")],
      ["ΣΟΦΊΑΣ", day("2026-09-22")],
      ["Zoë", day("2026-09-23")],
    ];
    const ids = [];
    for (const [n, at] of seeds) ids.push(await seedCat(n, at));
    await runBackfill();
    const rows = await nameRows();
    expect(rows).toHaveLength(seeds.length);
    rows.forEach((row, i) => {
      const [n, at] = seeds[i]!;
      expect(row).toEqual({
        cat_id: ids[i],
        name: n,
        normalised: foldName(n),
        observed_at: at,
        account_id: "system:legacy-backfill",
        role_at_time: "public",
        authority_scope: "none",
        provenance: "legacy",
        suggestion_source: "backfill:data-spine-names",
      });
    });
  });

  it("a cat renamed after PR 2 went live keeps both names in order, and gains no backdated name row", async () => {
    const created = day("2026-09-01");
    const catId = await seedCat("Ρούλα", created);
    // PR 2 recorded the name at naming time, then the owner's rename.
    await pr2Name(catId, "Ρούλα", day("2026-10-02"));
    await c.query(`update cats set name = 'Λίλη' where id = $1`, [catId]);
    await pr2Name(catId, "Λίλη", day("2026-10-04"));
    const untouched = await seedCat("Krispy", day("2026-09-03"));

    await runBackfill();

    const rows = await nameRows(catId);
    expect(rows.map((r) => [r.name, r.observed_at])).toEqual([
      ["Ρούλα", day("2026-10-02")],
      ["Λίλη", day("2026-10-04")],
    ]);
    expect(rows.every((r) => r.suggestion_source === null)).toBe(true);
    // The current name was not written again at created_at.
    expect(rows.some((r) => r.observed_at.getTime() === created.getTime())).toBe(false);
    // A cat with no name observation still got its backfill row.
    expect((await nameRows(untouched)).map((r) => r.suggestion_source)).toEqual([
      "backfill:data-spine-names",
    ]);
  });

  it("a cat created before PR 2 and renamed after it keeps only its rename: the lost original is not invented", async () => {
    // The realistic case (review of #94): PR 2 never wrote a name row for a
    // cat that already existed, so its only row is the rename. The original
    // name was never stored; the backfill must not paper over that by
    // writing the current name at created_at.
    const created = day("2026-08-01");
    const catId = await seedCat("Ρούλα", created);
    await c.query(`update cats set name = 'Λίλη' where id = $1`, [catId]);
    await pr2Name(catId, "Λίλη", day("2026-10-02"));

    await runBackfill();

    expect((await nameRows(catId)).map((r) => [r.name, r.observed_at, r.suggestion_source])).toEqual([
      ["Λίλη", day("2026-10-02"), null],
    ]);
  });

  it("up-down-up leaves the same rows, and the rollback removes only its own", async () => {
    const named = await seedCat("Ρούλα", day("2026-09-01"));
    await pr2Name(named, "Ρούλα", day("2026-10-02"));
    for (const n of ["Μιμή", "Krispy"]) await seedCat(n, day("2026-09-05"));

    await runBackfill();
    const first = await nameRows();
    await rollbackLast(c, migrations);
    // Only PR 2's row is left.
    expect((await nameRows()).map((r) => [r.cat_id, r.suggestion_source])).toEqual([
      [named, null],
    ]);
    await runBackfill();
    expect(await nameRows()).toEqual(first);
  });

  it("runs on an empty catalogue", async () => {
    await expect(runBackfill()).resolves.toBeDefined();
    expect(await nameRows()).toEqual([]);
  });
});
