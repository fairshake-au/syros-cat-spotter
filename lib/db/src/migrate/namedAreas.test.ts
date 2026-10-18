import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations, rollbackLast } from "./runner";

// SYC-396 PR 2.4 (dashboard §3.3; plan Task 2.4.1): the named_areas table,
// seeded with the 21 areas, one area_added history row each dated 15 Oct
// 2026, and the history checks widened first so those rows are allowed. On a
// throwaway database.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");
const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `named_areas_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

const all = readMigrations(defaultMigrationsFolder());
const mine = all.find((m) => m.tag.endsWith("_named_areas"))!;
// Stop at this migration, so "roll back the last one" always means this one.
const migrations = all.filter((m) => m.idx <= mine.idx);

// The seed, as the app's SEED_AREAS lists it (namedAreas.ts), first and last.
const FIRST = { key: "ermoupoli", name: "Ermoupoli", lat: 37.4447, lng: 24.9417 };
const LAST = { key: "episkopio", name: "Episkopio", lat: 37.4367321, lng: 24.9179183 };

beforeAll(async () => {
  expect(mine).toBeDefined();
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, migrations);
});

afterAll(async () => {
  await c?.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

const areaEvents = async () =>
  (
    await c.query<{ id: number; subject_id: number; kind: string; actor_system: string; at: Date; after: Record<string, unknown> }>(
      `select id, subject_id, kind, actor_system, at, after from mapping_events where subject_kind = 'named_area' order by id`,
    )
  ).rows;

describe("the named_areas migration", () => {
  it("seeds the 21 areas in order, with the app's keys and centres", async () => {
    const rows = (await c.query(`select key, name, lat, lng, retired_at from named_areas order by id`)).rows;
    expect(rows).toHaveLength(21);
    expect(rows[0]).toEqual({ ...FIRST, retired_at: null });
    expect(rows[20]).toEqual({ ...LAST, retired_at: null });
    expect(new Set(rows.map((r) => r.key)).size).toBe(21);
  });

  it("writes one area_added per area, signed by the migration, dated 15 Oct 2026, holding the whole row", async () => {
    const events = await areaEvents();
    const areas = (await c.query(`select id, key, name, lat, lng from named_areas order by id`)).rows;
    expect(events).toHaveLength(21);
    events.forEach((e, i) => {
      expect(e.kind).toBe("area_added");
      expect(e.actor_system).toBe("system:migration");
      expect(e.at.toISOString()).toBe("2026-10-15T00:00:00.000Z");
      expect(e.subject_id).toBe(areas[i].id);
      const { id: _id, ...row } = areas[i];
      expect(e.after).toEqual({ ...row, retired: false });
    });
  });

  it("the history still refuses an update and a delete of an area row", async () => {
    const [first] = await areaEvents();
    await expect(
      c.query(`update mapping_events set after = '{"key":"kini"}'::jsonb where id = $1`, [first!.id]),
    ).rejects.toThrow(/append-only/);
    await expect(c.query(`delete from mapping_events where id = $1`, [first!.id])).rejects.toThrow(/append-only/);
  });

  it("the widened checks take the new kinds and still refuse unknown ones", async () => {
    await expect(
      c.query(
        `insert into mapping_events (subject_kind, subject_id, kind, actor_system) values ('named_area', 1, 'area_moved', 'system:seed')`,
      ),
    ).resolves.toBeDefined();
    await expect(
      c.query(
        `insert into mapping_events (subject_kind, subject_id, kind, actor_system) values ('named_area', 1, 'area_exploded', 'system:seed')`,
      ),
    ).rejects.toThrow(/mapping_events_kind_ck/);
    await expect(
      c.query(
        `insert into mapping_events (subject_kind, subject_id, kind, actor_system) values ('village', 1, 'area_moved', 'system:seed')`,
      ),
    ).rejects.toThrow(/mapping_events_subject_kind_ck/);
  });

  it("refuses the reserved key off, a key that isn't short and plain, and two live areas with one name", async () => {
    const add = (key: string, nm: string) =>
      c.query(`insert into named_areas (key, name, lat, lng) values ($1, $2, 37.44, 24.94)`, [key, nm]);
    await expect(add("off", "Somewhere")).rejects.toThrow(/named_areas_key_ck/);
    await expect(add("Kini2", "Somewhere")).rejects.toThrow(/named_areas_key_ck/);
    await expect(add("37-44", "Somewhere")).rejects.toThrow(/named_areas_key_ck/);
    await expect(add("kini", "Kini again")).rejects.toThrow(/named_areas_key_unique/);
    await expect(add("kini-2", "KINI")).rejects.toThrow(/named_areas_live_name_unique/);
    // A retired area's name is free again.
    await c.query(`update named_areas set retired_at = now() where key = 'lia'`);
    await expect(add("lia-2", "Lia")).resolves.toBeDefined();
  });

  it("the rollback refuses once the team's own changes are in the history", async () => {
    await expect(rollbackLast(c, migrations)).rejects.toThrow(/Refusing to drop their history/);
  });
});

describe("the named_areas rollback, with only the seed", () => {
  const fresh = `named_areas_rb_${crypto.randomBytes(4).toString("hex")}`;
  let r: pg.Client;

  beforeAll(async () => {
    await admin.query(`create database "${fresh}"`);
    r = new pg.Client({ connectionString: url(fresh) });
    await r.connect();
    await migrateUp(r, migrations);
  });

  afterAll(async () => {
    await r?.end();
    await admin.query(`drop database if exists "${fresh}"`);
  });

  it("drops the table and the seed history, and narrows the checks again", async () => {
    await rollbackLast(r, migrations);
    expect((await r.query(`select to_regclass('named_areas') as t`)).rows[0].t).toBeNull();
    expect((await r.query(`select count(*)::int as n from mapping_events where subject_kind = 'named_area'`)).rows[0].n).toBe(0);
    await expect(
      r.query(
        `insert into mapping_events (subject_kind, subject_id, kind, actor_system) values ('named_area', 1, 'created', 'system:seed')`,
      ),
    ).rejects.toThrow(/mapping_events_subject_kind_ck/);
    await expect(
      r.query(
        `insert into mapping_events (subject_kind, subject_id, kind, actor_system) values ('site', 1, 'area_added', 'system:seed')`,
      ),
    ).rejects.toThrow(/mapping_events_kind_ck/);
  });
});
