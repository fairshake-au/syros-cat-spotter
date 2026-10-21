import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations, rollbackLast } from "./runner";

// SYC-396 PR 3.3a (dashboard §9.3; plan Task 3.3a.2): report_downloads, the
// record of who downloaded which report and when, never what was in it.
// Add-only: an UPDATE, a DELETE and a TRUNCATE are all refused. On a
// throwaway database.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");
const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `report_downloads_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

const all = readMigrations(defaultMigrationsFolder());
const mine = all.find((m) => m.tag.endsWith("_report_downloads"))!;
// Stop at this migration, so "roll back the last one" always means this one.
const migrations = all.filter((m) => m.idx <= mine.idx);
let personId: string;

beforeAll(async () => {
  expect(mine).toBeDefined();
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, migrations);
  personId = (
    await c.query<{ id: string }>(
      `insert into people (email, name, added_by, accepted_at) values ('eleni@example.com', 'Eleni', 'cli:test', now()) returning id`,
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  await c?.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

const refused = async (sql: string, params: unknown[] = []) => {
  await c.query("savepoint s");
  try {
    await c.query(sql, params);
    await c.query("release savepoint s");
    return null;
  } catch (err) {
    await c.query("rollback to savepoint s");
    return (err as Error).message;
  }
};

describe("the report_downloads migration", () => {
  it("has exactly who, which report, which range and when: no column for contents", async () => {
    const cols = (
      await c.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'report_downloads' order by ordinal_position`,
      )
    ).rows.map((r) => r.column_name);
    expect(cols).toEqual(["id", "person_id", "report", "range", "at"]);
  });

  it("takes a new row, stamped now", async () => {
    const row = (
      await c.query<{ at: Date }>(
        `insert into report_downloads (person_id, report, range) values ($1, 'progress', 'range=3months') returning at`,
        [personId],
      )
    ).rows[0]!;
    expect(Math.abs(row.at.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("refuses a row for nobody", async () => {
    await c.query("begin");
    try {
      expect(
        await refused(`insert into report_downloads (person_id, report, range) values (gen_random_uuid(), 'progress', 'range=all')`),
      ).toMatch(/foreign key/);
    } finally {
      await c.query("rollback");
    }
  });

  it("refuses an UPDATE, a DELETE and a TRUNCATE", async () => {
    await c.query("begin");
    try {
      expect(await refused(`update report_downloads set report = 'health'`)).toMatch(/append-only: update is not allowed/);
      expect(await refused(`delete from report_downloads`)).toMatch(/append-only: delete is not allowed/);
      expect(await refused(`truncate report_downloads`)).toMatch(/append-only|truncate/i);
    } finally {
      await c.query("rollback");
    }
    expect((await c.query(`select count(*)::int as n from report_downloads`)).rows[0].n).toBe(1);
  });

  it("rolls back to nothing", async () => {
    await rollbackLast(c, migrations);
    const left = await c.query(`select to_regclass('report_downloads') as t, to_regproc('report_downloads_append_only') as f`);
    expect(left.rows[0]).toEqual({ t: null, f: null });
  });
});
