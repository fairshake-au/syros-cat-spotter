import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
} from "./runner";

// SYC-209 PR 1.2: migration 0017_feeding_site_made_public_by_link
// (docs/superpowers/plans/syc-209-feeding-sites-and-colonies.md, "PR 1.2";
// feeding-sites-and-colonies.md §11.1, §15 test 24, the "rest").
// feeding_sites.made_public_by goes from text to a strict link to people.id.
// The migration refuses, listing the site ids and changing nothing, when a
// value is not a well-formed uuid or is not a person. colonies.created_by is
// not part of this and stays text.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const suffix = crypto.randomBytes(4).toString("hex");
const dbName = `made_public_by_test_${suffix}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let s: pg.Client;

const migrations = readMigrations(defaultMigrationsFolder());
const MINE = migrations.find(
  (m) => m.tag === "0017_feeding_site_made_public_by_link",
)!;
const BEFORE = MINE.idx - 1;

const STRANGER = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${dbName}"`);
  s = new pg.Client({ connectionString: url(dbName) });
  await s.connect();
});

afterAll(async () => {
  await s.end();
  await admin.query(`drop database if exists "${dbName}"`);
  await admin.end();
});

// A fresh database at the schema just before 0017, where made_public_by is
// still free text.
beforeEach(async () => {
  const tables = await s.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  for (const t of tables.rows) {
    await s.query(`alter table if exists "${t.tablename}" disable trigger all`);
  }
  await s.query(
    `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`,
  );
  await migrateUp(s, migrations, { throughIdx: BEFORE });
});

async function person(email: string): Promise<string> {
  return (
    await s.query<{ id: string }>(
      `insert into people (email, name, added_by) values ($1, $1, 'cli:test') returning id`,
      [email],
    )
  ).rows[0]!.id;
}

async function site(madePublicBy: string | null, name = "Vaporia"): Promise<number> {
  return (
    await s.query<{ id: number }>(
      `insert into feeding_sites (name, lat, lng, made_public_by) values ($1, 37.4452, 24.9423, $2) returning id`,
      [name, madePublicBy],
    )
  ).rows[0]!.id;
}

const applied = async () =>
  (
    await s.query(
      `select count(*)::int as n from drizzle.__drizzle_migrations where created_at = $1`,
      [MINE.when],
    )
  ).rows[0].n as number;

const columnType = async () =>
  (
    await s.query<{ data_type: string }>(
      `select data_type from information_schema.columns
        where table_name = 'feeding_sites' and column_name = 'made_public_by'`,
    )
  ).rows[0]!.data_type;

const values = async () =>
  (
    await s.query<{ id: number; v: string | null }>(
      `select id, made_public_by::text as v from feeding_sites order by id`,
    )
  ).rows;

/** The proof that a refusal changed nothing. */
async function expectUntouched(before: { id: number; v: string | null }[]) {
  expect(await applied()).toBe(0);
  expect(await columnType()).toBe("text");
  expect(await values()).toEqual(before);
  const fk = await s.query(
    `select 1 from pg_constraint where conname = 'feeding_sites_made_public_by_people_id_fk'`,
  );
  expect(fk.rowCount).toBe(0);
}

describe("migration 0017: made_public_by becomes a link to people (spec test 24, rest)", () => {
  it("stops with the site ids listed when a value is not a uuid, and changes nothing", async () => {
    const p = await person("maria@example.com");
    const ok = await site(p, "ok");
    const bad = await site("someone", "bad");
    const bad2 = await site("not-a-uuid-at-all", "bad2");
    await site(null, "null");
    const before = await values();
    await expect(migrateUp(s, migrations)).rejects.toThrow(
      `must be a person's id (a uuid); fix by hand first: site ids ${bad}, ${bad2}`,
    );
    await expectUntouched(before);
    expect(before.find((r) => r.id === ok)!.v).toBe(p);
  });

  it("refuses text that a loose cast would accept but is not a canonical uuid", async () => {
    const p = await person("maria@example.com");
    const braces = await site(`{${p}}`);
    const before = await values();
    await expect(migrateUp(s, migrations)).rejects.toThrow(`site ids ${braces}`);
    await expectUntouched(before);
  });

  it("refuses a bad value before any cast, so the message is ours and not a raw cast error", async () => {
    await site("someone");
    const err = await migrateUp(s, migrations).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/fix by hand first: site ids/);
    expect(err!.message).not.toMatch(/invalid input syntax for type uuid/);
  });

  it("stops with the site ids listed when a well-formed uuid is not a person, and changes nothing", async () => {
    const p = await person("maria@example.com");
    await site(p, "ok");
    const stranger = await site(STRANGER, "stranger");
    const stranger2 = await site(crypto.randomUUID(), "stranger2");
    const before = await values();
    await expect(migrateUp(s, migrations)).rejects.toThrow(
      `must be the id of a person on the people list; fix by hand first: site ids ${stranger}, ${stranger2}`,
    );
    await expectUntouched(before);
  });

  it("with both kinds present, names the not-a-uuid ones first, and changes nothing", async () => {
    const bad = await site("someone");
    await site(STRANGER);
    const before = await values();
    await expect(migrateUp(s, migrations)).rejects.toThrow(
      `(a uuid); fix by hand first: site ids ${bad}`,
    );
    await expectUntouched(before);
  });

  it("lists the ids in order, whatever order the rows were written in", async () => {
    // Written 30, 10, 20, so a list that follows storage order would be wrong.
    for (const [id, v] of [[30, "bad-c"], [10, "bad-a"], [20, "bad-b"]] as const) {
      await s.query(
        `insert into feeding_sites (id, name, lat, lng, made_public_by) values ($1, $2, 37.4452, 24.9423, $2)`,
        [id, v],
      );
    }
    const before = await values();
    await expect(migrateUp(s, migrations)).rejects.toThrow("site ids 10, 20, 30");
    await expectUntouched(before);
    await s.query(`update feeding_sites set made_public_by = $1`, [STRANGER]);
    await expect(migrateUp(s, migrations)).rejects.toThrow("site ids 10, 20, 30");
  });

  it("runs once the bad rows are fixed by hand", async () => {
    const p = await person("maria@example.com");
    const bad = await site("someone");
    await expect(migrateUp(s, migrations)).rejects.toThrow(`site ids ${bad}`);
    await s.query(`update feeding_sites set made_public_by = $2 where id = $1`, [bad, p]);
    await migrateUp(s, migrations);
    expect(await applied()).toBe(1);
    expect(await columnType()).toBe("uuid");
  });

  it("converts null and valid person ids unchanged, matching a capitalised id too", async () => {
    const a = await person("a@example.com");
    const b = await person("b@example.com");
    const sa = await site(a, "a");
    const sb = await site(b.toUpperCase(), "b-upper");
    const sn = await site(null, "none");
    await migrateUp(s, migrations);
    expect(await applied()).toBe(1);
    expect(await columnType()).toBe("uuid");
    expect(await values()).toEqual([
      { id: sa, v: a },
      { id: sb, v: b },
      { id: sn, v: null },
    ]);
  });

  it("runs on a database with no sites", async () => {
    await migrateUp(s, migrations);
    expect(await columnType()).toBe("uuid");
  });

  it("is not a row update: updated_at keeps its value", async () => {
    const p = await person("maria@example.com");
    const id = await site(p);
    await s.query(`alter table feeding_sites disable trigger feeding_sites_touch_updated_at`);
    await s.query(
      `update feeding_sites set updated_at = '2026-01-02 03:04:05.678901+00' where id = $1`,
      [id],
    );
    await s.query(`alter table feeding_sites enable trigger feeding_sites_touch_updated_at`);
    const stamp = () =>
      s
        .query<{ v: string }>(`select updated_at::text as v from feeding_sites where id = $1`, [id])
        .then((r) => r.rows[0]!.v);
    const seen = await stamp();
    expect(seen).toMatch(/:04:05\.678901/);
    await migrateUp(s, migrations);
    expect(await stamp()).toBe(seen);
  });

  it("then refuses a uuid that is not a person, on insert and on update", async () => {
    const p = await person("maria@example.com");
    const id = await site(p);
    await migrateUp(s, migrations);
    await expect(
      s.query(
        `insert into feeding_sites (name, lat, lng, made_public_by) values ('x', 37.44, 24.94, $1)`,
        [STRANGER],
      ),
    ).rejects.toThrow(/feeding_sites_made_public_by_people_id_fk/);
    await expect(
      s.query(`update feeding_sites set made_public_by = $2 where id = $1`, [id, STRANGER]),
    ).rejects.toThrow(/feeding_sites_made_public_by_people_id_fk/);
    // And a non-uuid can no longer be stored at all.
    await expect(
      s.query(`update feeding_sites set made_public_by = 'someone' where id = $1`, [id]),
    ).rejects.toThrow(/invalid input syntax for type uuid/);
  });

  it("then keeps a person who published a site from being deleted (no action)", async () => {
    const p = await person("maria@example.com");
    await site(p);
    await migrateUp(s, migrations);
    await expect(s.query(`delete from people where id = $1`, [p])).rejects.toThrow(
      /feeding_sites_made_public_by_people_id_fk/,
    );
  });

  it("leaves colonies.created_by as text (roles plan C7)", async () => {
    await migrateUp(s, migrations);
    const r = await s.query<{ data_type: string }>(
      `select data_type from information_schema.columns
        where table_name = 'colonies' and column_name = 'created_by'`,
    );
    expect(r.rows[0]!.data_type).toBe("text");
  });
});

// Up/down/up is proved for every migration, 0017 included, by runner.test.ts
// ("builds on an empty database and passes the up/down/up cycle"). What that
// test cannot know is that values survive the way back:
describe("migration 0017 rollback keeps the values", () => {
  it("turns the uuid back into the same text and drops only the link", async () => {
    const p = await person("maria@example.com");
    const id = await site(p);
    await migrateUp(s, migrations);
    expect(MINE.rollback).toBeTruthy();
    await s.query(MINE.rollback!);
    expect(await columnType()).toBe("text");
    expect(await values()).toEqual([{ id, v: p }]);
    await s.query(`update feeding_sites set made_public_by = 'someone' where id = $1`, [id]);
  });
});
