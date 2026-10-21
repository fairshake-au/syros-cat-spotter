import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations, rollbackLast } from "./runner";

// SYC-396 PR 3.1b (dashboard §10.3; plan Task 3.1.2): the history checks take
// the standard price's changes, subject 'vet_settings' and kind
// 'price_changed', and still refuse anything unknown. On throwaway databases.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");
const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const admin = new pg.Client({ connectionString: url("postgres") });

const all = readMigrations(defaultMigrationsFolder());
const mine = all.find((m) => m.tag.endsWith("_vet_settings_history"))!;
// Stop at this migration, so "roll back the last one" always means this one.
const migrations = all.filter((m) => m.idx <= mine.idx);

const insert = (c: pg.Client, subject: string, kind: string) =>
  c.query(
    `insert into mapping_events (subject_kind, subject_id, kind, actor_system, before, after)
     values ($1, 1, $2, 'system:seed', '{"eur":60}'::jsonb, '{"eur":65}'::jsonb)`,
    [subject, kind],
  );

async function freshDatabase(prefix: string): Promise<{ name: string; c: pg.Client }> {
  const name = `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
  await admin.query(`create database "${name}"`);
  const c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, migrations);
  return { name, c };
}

const made: { name: string; c: pg.Client }[] = [];

beforeAll(async () => {
  expect(mine).toBeDefined();
  await admin.connect();
});

afterAll(async () => {
  for (const { name, c } of made) {
    await c.end();
    await admin.query(`drop database if exists "${name}"`);
  }
  await admin.end();
});

describe("the vet_settings_history migration", () => {
  it("accepts a price change, and still refuses an unknown subject or kind", async () => {
    const db = await freshDatabase("vet_settings_test");
    made.push(db);
    await expect(insert(db.c, "vet_settings", "price_changed")).resolves.toBeDefined();
    await expect(insert(db.c, "vet_clinic", "price_changed")).rejects.toThrow(/mapping_events_subject_kind_ck/);
    await expect(insert(db.c, "vet_settings", "price_doubled")).rejects.toThrow(/mapping_events_kind_ck/);
    // The older kinds still go in.
    await expect(insert(db.c, "named_area", "area_moved")).resolves.toBeDefined();
  });

  it("the history still refuses an update and a delete of a price change", async () => {
    const db = await freshDatabase("vet_settings_ao");
    made.push(db);
    const { rows } = await insert(db.c, "vet_settings", "price_changed").then(() =>
      db.c.query<{ id: number }>(`select id from mapping_events where subject_kind = 'vet_settings'`),
    );
    await expect(
      db.c.query(`update mapping_events set after = '{"eur":1}'::jsonb where id = $1`, [rows[0]!.id]),
    ).rejects.toThrow(/append-only/);
    await expect(db.c.query(`delete from mapping_events where id = $1`, [rows[0]!.id])).rejects.toThrow(/append-only/);
  });

  it("the rollback refuses once a price change is in the history", async () => {
    const db = await freshDatabase("vet_settings_rbx");
    made.push(db);
    await insert(db.c, "vet_settings", "price_changed");
    await expect(rollbackLast(db.c, migrations)).rejects.toThrow(/Refusing to drop that history/);
  });

  it("with no price change, the rollback narrows the checks again", async () => {
    const db = await freshDatabase("vet_settings_rb");
    made.push(db);
    await rollbackLast(db.c, migrations);
    await expect(insert(db.c, "vet_settings", "area_moved")).rejects.toThrow(/mapping_events_subject_kind_ck/);
    await expect(insert(db.c, "named_area", "price_changed")).rejects.toThrow(/mapping_events_kind_ck/);
    await expect(insert(db.c, "named_area", "area_moved")).resolves.toBeDefined();
  });
});
