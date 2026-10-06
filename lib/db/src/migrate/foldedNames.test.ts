import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { foldedNameEquals } from "../catNames";
import { foldName } from "../fold";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
  rollbackLast,
} from "./runner";

// SYC-101 (DECISIONS.md Part 2g): the migration that moves cat-name
// uniqueness onto a folded form (0010_cats_folded_name), on a throwaway
// database brought up to just before it and seeded first.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `folded_names_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

const migrations = readMigrations(defaultMigrationsFolder());
const FOLDED = migrations.find((m) => m.tag === "0010_cats_folded_name")!;
const BEFORE = migrations.find((m) => m.idx === FOLDED.idx - 1)!.idx;
const upToFolded = () => migrateUp(c, migrations, { throughIdx: FOLDED.idx });

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

async function seedCat(catName: string): Promise<number> {
  const r = await c.query<{ id: number }>(
    `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id)
     values ($1, 0, 37.44, 24.94, 'd') returning id`,
    [catName],
  );
  return r.rows[0]!.id;
}

async function indexes(): Promise<string[]> {
  const r = await c.query<{ indexname: string }>(
    `select indexname from pg_indexes where tablename = 'cats' order by 1`,
  );
  return r.rows.map((row) => row.indexname);
}

describe("0010_cats_folded_name (SYC-101)", () => {
  it("fills the folded name for every existing cat, exactly as foldName folds it", async () => {
    // Production's names on 6 Oct 2026 were all plain Latin; the Greek and
    // accented ones are what the island will add.
    const names = [
      "Sunny Paws",
      "Harbor Whiskers",
      "Krispy",
      "Μιμή",
      "ΣΟΦΊΑΣ",
      "Zoë",
      "  Λευκή Γάτα ",
    ];
    for (const n of names) await seedCat(n);
    await upToFolded();
    const r = await c.query<{ name: string; normalised_name: string }>(
      `select name, normalised_name from cats order by id`,
    );
    expect(r.rows.map((row) => row.name)).toEqual(names);
    expect(r.rows.map((row) => row.normalised_name)).toEqual(
      names.map(foldName),
    );
    expect(await indexes()).toContain("cats_normalised_name_unique");
    expect(await indexes()).not.toContain("cats_name_lower_unique");
  });

  it("refuses, listing every clash, when existing names collide once folded", async () => {
    const mimi = await seedCat("Μιμή");
    const mimiCaps = await seedCat("ΜΙΜΗ");
    const zoe = await seedCat("Zoë");
    const zoePlain = await seedCat("Zoe");
    await seedCat("Krispy");
    const err = await upToFolded().then(
      () => null,
      (e: Error) => e,
    );
    expect(err).not.toBeNull();
    expect(err!.message).toContain("same once accents, case and final sigma");
    expect(err!.message).toContain(`μιμη: #${mimi} "Μιμή", #${mimiCaps} "ΜΙΜΗ"`);
    expect(err!.message).toContain(`zoe: #${zoe} "Zoë", #${zoePlain} "Zoe"`);
    expect(err!.message).not.toContain("Krispy");
    // Nothing landed: the old index and no new column.
    expect(await indexes()).toContain("cats_name_lower_unique");
    const col = await c.query(
      `select 1 from information_schema.columns
        where table_name = 'cats' and column_name = 'normalised_name'`,
    );
    expect(col.rowCount).toBe(0);
  });

  it("up-down-up: the rollback restores lower(name) and the names as typed", async () => {
    for (const n of ["Μιμή", "Zoë", "Krispy"]) await seedCat(n);
    await upToFolded();
    await rollbackLast(c, migrations);
    expect(await indexes()).toContain("cats_name_lower_unique");
    expect(await indexes()).not.toContain("cats_normalised_name_unique");
    const names = await c.query<{ name: string }>(`select name from cats order by id`);
    expect(names.rows.map((r) => r.name)).toEqual(["Μιμή", "Zoë", "Krispy"]);
    await upToFolded();
    const r = await c.query<{ normalised_name: string }>(
      `select normalised_name from cats order by id`,
    );
    expect(r.rows.map((row) => row.normalised_name)).toEqual(["μιμη", "zoe", "krispy"]);
  });

  it("the app's name lookup can use the unique index", async () => {
    // Review of #92: the ICU collation the fold lower-cases under leaked
    // into the comparison, so Postgres could not use the index at all.
    for (const n of ["Μιμή", "Zoë", "Krispy"]) await seedCat(n);
    await upToFolded();
    const { sql: text, params } = new PgDialect().sqlToQuery(foldedNameEquals("ΜΙΜΗ"));
    await c.query("set enable_seqscan = off");
    try {
      const plan = await c.query<{ "QUERY PLAN": string }>(
        `explain select id from cats where ${text}`,
        params,
      );
      expect(plan.rows.map((r) => r["QUERY PLAN"]).join("\n")).toContain(
        "cats_normalised_name_unique",
      );
      const hit = await c.query(`select name from cats where ${text}`, params);
      expect(hit.rows).toEqual([{ name: "Μιμή" }]);
    } finally {
      await c.query("reset enable_seqscan");
    }
  });
});
