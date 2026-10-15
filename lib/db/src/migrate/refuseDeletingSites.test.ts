import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "./runner";

// SYC-298: the database refuses to delete a feeding site or a colony (spec
// feeding-sites-and-colonies.md §2.5: sites are retired, colonies renamed).
// mapping_events.subject_id has no foreign key, so a delete would leave the
// history pointing at nothing. The migration is found by its tag name, not
// its number, so renumbering it needs no change here.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const dbName = `refuse_delete_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

const migrations = readMigrations(defaultMigrationsFolder());
const MINE = migrations.find((m) => m.tag.endsWith("_refuse_deleting_sites_and_colonies"));

beforeAll(async () => {
  expect(MINE).toBeDefined();
  await admin.connect();
  await admin.query(`create database "${dbName}"`);
  c = new pg.Client({ connectionString: url(dbName) });
  await c.connect();
  await migrateUp(c, migrations);
});

afterAll(async () => {
  await c.end();
  await admin.query(`drop database if exists "${dbName}"`);
  await admin.end();
});

async function newSite(): Promise<number> {
  return (
    await c.query<{ id: number }>(
      `insert into feeding_sites (name, lat, lng) values ('Vaporia', 37.4452, 24.9423) returning id`,
    )
  ).rows[0]!.id;
}

let colonyCount = 0;
async function newColony(): Promise<number> {
  const name = `Vaporia ${++colonyCount}`;
  return (
    await c.query<{ id: number }>(
      `insert into colonies (name, normalised_name, guardian_name) values ($1, lower($1), 'Maria') returning id`,
      [name],
    )
  ).rows[0]!.id;
}

const TABLES = [
  { table: "feeding_sites", make: newSite, guard: "feeding_sites_never_deleted" },
  { table: "colonies", make: newColony, guard: "colonies_never_deleted" },
] as const;

describe.each(TABLES)("$table is never deleted", ({ table, make, guard }) => {
  it("refuses a delete, with the reason and the id", async () => {
    const id = await make();
    await expect(c.query(`delete from ${table} where id = $1`, [id])).rejects.toThrow(
      new RegExp(`${table} rows are never deleted: retire a site, rename a colony \\(id ${id}\\)`),
    );
    expect((await c.query(`select 1 from ${table} where id = $1`, [id])).rowCount).toBe(1);
  });

  it("refuses TRUNCATE", async () => {
    await make();
    await expect(c.query(`truncate ${table} cascade`)).rejects.toThrow(
      new RegExp(`${table} is append-only: TRUNCATE is not allowed`),
    );
  });

  it("lets a delete through while the guard is off for one transaction, then is armed again", async () => {
    const first = await make();
    const second = await make();
    await c.query("begin");
    await c.query(`alter table ${table} disable trigger ${guard}`);
    await c.query(`delete from ${table} where id = $1`, [first]);
    await c.query(`alter table ${table} enable trigger ${guard}`);
    await c.query("commit");
    expect((await c.query(`select 1 from ${table} where id = $1`, [first])).rowCount).toBe(0);
    await expect(c.query(`delete from ${table} where id = $1`, [second])).rejects.toThrow(
      /rows are never deleted/,
    );
  });

  it("a failed bypass transaction leaves the guard armed", async () => {
    const id = await make();
    await c.query("begin");
    await c.query(`alter table ${table} disable trigger ${guard}`);
    await c.query("rollback");
    await expect(c.query(`delete from ${table} where id = $1`, [id])).rejects.toThrow(
      /rows are never deleted/,
    );
  });
});

describe("updates and inserts are untouched", () => {
  it("still lets a site be retired and a colony renamed", async () => {
    const s = await newSite();
    await c.query(`update feeding_sites set name = 'Vaporia 2' where id = $1`, [s]);
    const k = await newColony();
    await c.query(`update colonies set guardian_name = 'Eleni' where id = $1`, [k]);
  });
});
