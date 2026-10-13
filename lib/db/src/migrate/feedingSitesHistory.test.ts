import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
} from "./runner";

// SYC-209 PR 1.1: migration 0015_feeding_sites_and_history
// (docs/superpowers/plans/syc-209-feeding-sites-and-colonies.md, "PR 1.1";
// feeding-sites-and-colonies.md §8, §11.1, §15 tests 10, 11 and 24).
// The database's own half: whatever the app does, the history can't be
// edited except by a redaction that blanks it, a retired site is never
// public, and the migration refuses to run over a public site.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const suffix = crypto.randomBytes(4).toString("hex");
const fullName = `feeding_history_test_${suffix}`;
const stagedName = `feeding_history_staged_${suffix}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
let s: pg.Client;
let personId: string;

const migrations = readMigrations(defaultMigrationsFolder());
const MINE = migrations.find((m) => m.tag === "0015_feeding_sites_and_history")!;
const BEFORE = MINE.idx - 1;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${fullName}"`);
  await admin.query(`create database "${stagedName}"`);
  c = new pg.Client({ connectionString: url(fullName) });
  s = new pg.Client({ connectionString: url(stagedName) });
  await c.connect();
  await s.connect();
  await migrateUp(c, migrations);
  personId = (
    await c.query<{ id: string }>(
      `insert into people (email, name, added_by) values ('maria@example.com', 'Maria', 'cli:test') returning id`,
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  await c.end();
  await s.end();
  await admin.query(`drop database if exists "${fullName}"`);
  await admin.query(`drop database if exists "${stagedName}"`);
  await admin.end();
});

async function site(
  fields: Partial<{ name: string; colony_id: number | null }> = {},
): Promise<number> {
  const r = await c.query<{ id: number }>(
    `insert into feeding_sites (name, lat, lng, colony_id) values ($1, 37.4452, 24.9423, $2) returning id`,
    [fields.name ?? "Vaporia — Eleni's", fields.colony_id ?? null],
  );
  return r.rows[0]!.id;
}

async function event(
  fields: Partial<{
    kind: string;
    person_id: string | null;
    actor_system: string | null;
    redacted_at: string | null;
    redaction_reason: string | null;
  }> = {},
): Promise<number> {
  const r = await c.query<{ id: number }>(
    `insert into mapping_events (subject_kind, subject_id, kind, person_id, actor_system, before, after, note, redacted_at, redaction_reason)
     values ('site', 1, $1, $2, $3, '{"name": "Vaporia — Eleni''s"}', '{"name": "Vaporia — Maria''s"}', 'Eleni handed over', $4, $5)
     returning id`,
    [
      fields.kind ?? "renamed",
      fields.person_id === undefined ? personId : fields.person_id,
      fields.actor_system ?? null,
      fields.redacted_at ?? null,
      fields.redaction_reason ?? null,
    ],
  );
  return r.rows[0]!.id;
}

const eventRow = async (id: number) =>
  (await c.query(`select * from mapping_events where id = $1`, [id])).rows[0];

const REDACT = `update mapping_events
  set redacted_at = now(), redaction_reason = 'guardian asked to be forgotten',
      before = '{}'::jsonb, after = '{}'::jsonb, note = null
  where id = $1`;

const APPEND_ONLY = /mapping_events is append-only: the only permitted update is redaction/;

describe("mapping_events: who did it (spec §11.1)", () => {
  it("takes a person, or one of the app's own actors", async () => {
    await event();
    await event({ person_id: null, actor_system: "system:seed" });
    await event({ person_id: null, actor_system: "system:migration", kind: "existing" });
  });

  it("refuses a row with both a person and a system actor, or with neither", async () => {
    await expect(event({ actor_system: "system:seed" })).rejects.toThrow(
      /mapping_events_one_actor_ck/,
    );
    await expect(event({ person_id: null })).rejects.toThrow(/mapping_events_one_actor_ck/);
  });

  it("refuses an unknown system actor, kind or subject", async () => {
    await expect(event({ person_id: null, actor_system: "system:vision" })).rejects.toThrow(
      /mapping_events_actor_system_ck/,
    );
    await expect(event({ kind: "deleted" })).rejects.toThrow(/mapping_events_kind_ck/);
    await expect(
      c.query(
        `insert into mapping_events (subject_kind, subject_id, kind, actor_system) values ('cat', 1, 'created', 'system:seed')`,
      ),
    ).rejects.toThrow(/mapping_events_subject_kind_ck/);
  });

  it("refuses a person who isn't on the people list, and keeps a person with history from being deleted", async () => {
    await expect(event({ person_id: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(
      /mapping_events_person_id_people_id_fk/,
    );
    await event();
    await expect(c.query(`delete from people where id = $1`, [personId])).rejects.toThrow(
      /mapping_events_person_id_people_id_fk/,
    );
  });

  it("every row ever written has exactly one of person_id and actor_system", async () => {
    const r = await c.query(
      `select count(*)::int as n from mapping_events where (person_id is null) = (actor_system is null)`,
    );
    expect(r.rows[0].n).toBe(0);
  });
});

describe("mapping_events: add-only, with one redaction (spec test 11, database half)", () => {
  it("refuses delete", async () => {
    const id = await event();
    await expect(c.query(`delete from mapping_events where id = $1`, [id])).rejects.toThrow(
      /mapping_events is append-only: delete is not allowed/,
    );
  });

  it("refuses TRUNCATE", async () => {
    await expect(c.query(`truncate mapping_events`)).rejects.toThrow(
      /mapping_events is append-only: TRUNCATE is not allowed/,
    );
  });

  it("refuses a row that arrives already redacted", async () => {
    await expect(
      event({ redacted_at: new Date().toISOString(), redaction_reason: "x" }),
    ).rejects.toThrow(/cannot arrive already redacted/);
    await expect(event({ redaction_reason: "x" })).rejects.toThrow(
      /cannot arrive already redacted/,
    );
  });

  it("refuses a change of kind, even inside a redaction", async () => {
    const id = await event();
    await expect(
      c.query(`update mapping_events set kind = 'moved' where id = $1`, [id]),
    ).rejects.toThrow(APPEND_ONLY);
    await expect(
      c.query(
        `update mapping_events set kind = 'moved', redacted_at = now(), redaction_reason = 'r',
           before = '{}', after = '{}', note = null where id = $1`,
        [id],
      ),
    ).rejects.toThrow(APPEND_ONLY);
  });

  it("refuses a change to any other column: who, when, which subject", async () => {
    const id = await event();
    for (const set of [
      `subject_id = 2`,
      `at = now() - interval '1 day'`,
      `guardian_aware = true`,
      `person_id = null, actor_system = 'system:seed'`,
    ]) {
      await expect(
        c.query(`update mapping_events set ${set} where id = $1`, [id]),
      ).rejects.toThrow(APPEND_ONLY);
    }
  });

  it("refuses an edit of before, after or note without a redaction", async () => {
    const id = await event();
    await expect(
      c.query(`update mapping_events set before = '{"name": "x"}' where id = $1`, [id]),
    ).rejects.toThrow(APPEND_ONLY);
    await expect(
      c.query(`update mapping_events set before = '{}', after = '{}', note = null where id = $1`, [id]),
    ).rejects.toThrow(APPEND_ONLY);
  });

  it("refuses a redaction that doesn't blank all of before, after and note", async () => {
    const id = await event();
    for (const set of [
      `before = '{"name": "Vaporia — Eleni''s"}', after = '{}', note = null`,
      `before = null, after = '{}', note = null`,
      `before = '{}', after = '{"name": "x"}', note = null`,
      `before = '{}', after = '{}', note = 'Eleni handed over'`,
      `before = '{}', after = '{}', note = ''`,
    ]) {
      await expect(
        c.query(
          `update mapping_events set redacted_at = now(), redaction_reason = 'r', ${set} where id = $1`,
          [id],
        ),
      ).rejects.toThrow(APPEND_ONLY);
    }
  });

  it("refuses a redaction with no reason", async () => {
    const id = await event();
    for (const reason of [null, "", "   "]) {
      await expect(
        c.query(
          `update mapping_events set redacted_at = now(), redaction_reason = $2,
             before = '{}', after = '{}', note = null where id = $1`,
          [id, reason],
        ),
      ).rejects.toThrow(APPEND_ONLY);
    }
  });

  it("allows a redaction that blanks before, after and note, and keeps everything else", async () => {
    const id = await event();
    const was = await eventRow(id);
    await c.query(REDACT, [id]);
    const now = await eventRow(id);
    expect(now.before).toEqual({});
    expect(now.after).toEqual({});
    expect(now.note).toBeNull();
    expect(now.redacted_at).not.toBeNull();
    expect(now.redaction_reason).toBe("guardian asked to be forgotten");
    for (const col of ["id", "subject_kind", "subject_id", "kind", "person_id", "actor_system", "at", "guardian_aware"]) {
      expect(now[col]).toEqual(was[col]);
    }
  });

  it("lets the same redaction run again, but never changes or removes its stamp", async () => {
    const id = await event();
    await c.query(REDACT, [id]);
    await c.query(
      `update mapping_events set before = '{}', after = '{}', note = null where id = $1`,
      [id],
    );
    await expect(
      c.query(`update mapping_events set redaction_reason = 'another' where id = $1`, [id]),
    ).rejects.toThrow(APPEND_ONLY);
    await expect(
      c.query(`update mapping_events set redacted_at = now() + interval '1 day' where id = $1`, [id]),
    ).rejects.toThrow(APPEND_ONLY);
    await expect(
      c.query(
        `update mapping_events set redacted_at = null, redaction_reason = null where id = $1`,
        [id],
      ),
    ).rejects.toThrow(APPEND_ONLY);
    await expect(
      c.query(`update mapping_events set after = '{"name": "back"}' where id = $1`, [id]),
    ).rejects.toThrow(APPEND_ONLY);
  });
});

describe("colony_name_history: add-only, with one redaction", () => {
  let colonyId: number;
  beforeAll(async () => {
    colonyId = (
      await c.query<{ id: number }>(
        `insert into colonies (name, normalised_name, guardian_name) values ('Vaporia — Maria''s', 'vaporia — maria''s', 'Maria') returning id`,
      )
    ).rows[0]!.id;
  });

  const oldName = async () =>
    (
      await c.query<{ id: number }>(
        `insert into colony_name_history (colony_id, name, normalised_name, replaced_by)
         values ($1, 'Vaporia — Eleni''s', 'vaporia — eleni''s', $2) returning id`,
        [colonyId, personId],
      )
    ).rows[0]!.id;
  const nameRow = async (id: number) =>
    (await c.query(`select * from colony_name_history where id = $1`, [id])).rows[0];
  const NAME_ONLY = /colony_name_history is append-only: the only permitted update is redaction/;
  const REDACT_NAME = `update colony_name_history
    set name = '(name removed)', normalised_name = '(name removed)',
        redacted_at = now(), redaction_reason = 'guardian asked to be forgotten'
    where id = $1`;

  it("refuses delete", async () => {
    const id = await oldName();
    await expect(c.query(`delete from colony_name_history where id = $1`, [id])).rejects.toThrow(
      /colony_name_history is append-only: delete is not allowed/,
    );
  });

  it("refuses TRUNCATE", async () => {
    await expect(c.query(`truncate colony_name_history`)).rejects.toThrow(
      /colony_name_history is append-only: TRUNCATE is not allowed/,
    );
  });

  it("refuses a row that arrives already redacted", async () => {
    await expect(
      c.query(
        `insert into colony_name_history (colony_id, name, normalised_name, redacted_at, redaction_reason)
         values ($1, 'x', 'x', now(), 'r')`,
        [colonyId],
      ),
    ).rejects.toThrow(/cannot arrive already redacted/);
  });

  it("refuses a change of colony, date or author, even inside a redaction", async () => {
    const id = await oldName();
    for (const set of [
      `colony_id = colony_id`,
      `replaced_at = now() - interval '1 day'`,
      `replaced_by = 'someone'`,
    ]) {
      // Even `colony_id = colony_id`, which changes nothing, is refused: an
      // update that isn't a redaction is never allowed.
      await expect(
        c.query(`update colony_name_history set ${set} where id = $1`, [id]),
      ).rejects.toThrow(NAME_ONLY);
    }
    await expect(
      c.query(
        `update colony_name_history set replaced_by = 'someone', name = '(name removed)',
           normalised_name = '(name removed)', redacted_at = now(), redaction_reason = 'r' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(NAME_ONLY);
  });

  it("refuses a rename of an old name without a redaction, or to anything but the placeholder", async () => {
    const id = await oldName();
    await expect(
      c.query(`update colony_name_history set name = 'Vaporia' where id = $1`, [id]),
    ).rejects.toThrow(NAME_ONLY);
    await expect(
      c.query(
        `update colony_name_history set name = 'Vaporia', normalised_name = 'vaporia',
           redacted_at = now(), redaction_reason = 'r' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(NAME_ONLY);
    await expect(
      c.query(
        `update colony_name_history set name = '(name removed)', normalised_name = '(name removed)',
           redacted_at = now(), redaction_reason = '' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(NAME_ONLY);
  });

  it("refuses a redaction that blanks the name but leaves the folded name (which still holds it)", async () => {
    const id = await oldName();
    await expect(
      c.query(
        `update colony_name_history set name = '(name removed)',
           redacted_at = now(), redaction_reason = 'guardian asked to be forgotten' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(NAME_ONLY);
    await expect(
      c.query(
        `update colony_name_history set normalised_name = '(name removed)',
           redacted_at = now(), redaction_reason = 'guardian asked to be forgotten' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(NAME_ONLY);
  });

  it("allows a redaction to the placeholder, and keeps everything else", async () => {
    const id = await oldName();
    const was = await nameRow(id);
    await c.query(REDACT_NAME, [id]);
    const now = await nameRow(id);
    expect(now.name).toBe("(name removed)");
    expect(now.normalised_name).toBe("(name removed)");
    expect(now.redaction_reason).toBe("guardian asked to be forgotten");
    for (const col of ["id", "colony_id", "replaced_at", "replaced_by"]) {
      expect(now[col]).toEqual(was[col]);
    }
    await expect(
      c.query(`update colony_name_history set redaction_reason = 'another' where id = $1`, [id]),
    ).rejects.toThrow(NAME_ONLY);
  });
});

describe("feeding_sites: public needs a label and a code; retired is never public (spec test 10, database half)", () => {
  it("starts every site private, with no label, no code and no retirement", async () => {
    const id = await site();
    const r = await c.query(`select * from feeding_sites where id = $1`, [id]);
    expect(r.rows[0]).toMatchObject({
      is_public: false,
      public_label: null,
      public_id: null,
      retired_at: null,
      last_public_lat: null,
    });
    expect(r.rows[0].updated_at).toBeInstanceOf(Date);
  });

  it("refuses public without a label, or without a code", async () => {
    const id = await site();
    await expect(
      c.query(`update feeding_sites set is_public = true, public_id = $2 where id = $1`, [id, `code-${id}`]),
    ).rejects.toThrow(/feeding_sites_public_needs_label_ck/);
    await expect(
      c.query(`update feeding_sites set is_public = true, public_label = 'Near the church' where id = $1`, [id]),
    ).rejects.toThrow(/feeding_sites_public_needs_label_ck/);
  });

  it("refuses a retired site that is public, either way round", async () => {
    const id = await site();
    await c.query(
      `update feeding_sites set is_public = true, public_label = 'Near the church', public_id = $2 where id = $1`,
      [id, `code-${id}`],
    );
    await expect(
      c.query(`update feeding_sites set retired_at = now(), retired_by = $2 where id = $1`, [id, personId]),
    ).rejects.toThrow(/feeding_sites_retired_never_public_ck/);
    const other = await site();
    await c.query(`update feeding_sites set retired_at = now() where id = $1`, [other]);
    await expect(
      c.query(
        `update feeding_sites set is_public = true, public_label = 'x', public_id = $2 where id = $1`,
        [other, `code-${other}`],
      ),
    ).rejects.toThrow(/feeding_sites_retired_never_public_ck/);
  });

  it("refuses half a last public position", async () => {
    const id = await site();
    await expect(
      c.query(`update feeding_sites set last_public_lat = 37.44 where id = $1`, [id]),
    ).rejects.toThrow(/feeding_sites_last_public_pair_ck/);
    await c.query(
      `update feeding_sites set last_public_lat = 37.44, last_public_lng = 24.94 where id = $1`,
      [id],
    );
  });

  it("refuses a retiring person who isn't on the people list", async () => {
    const id = await site();
    await expect(
      c.query(`update feeding_sites set retired_at = now(), retired_by = $2 where id = $1`, [
        id,
        "00000000-0000-4000-8000-000000000000",
      ]),
    ).rejects.toThrow(/feeding_sites_retired_by_people_id_fk/);
  });
});

describe("public codes: never both current and superseded (spec §11.1)", () => {
  it("refuses an old code that is a site's current code", async () => {
    const id = await site();
    const code = `current-${id}`;
    await c.query(`update feeding_sites set public_id = $2 where id = $1`, [id, code]);
    await expect(
      c.query(
        `insert into feeding_site_old_codes (site_id, public_id, reason) values ($1, $2, 'moved')`,
        [id, code],
      ),
    ).rejects.toThrow(/still a site's current code/);
  });

  it("refuses a current code that has been superseded, on update and on insert", async () => {
    const id = await site();
    const code = `old-${id}`;
    await c.query(
      `insert into feeding_site_old_codes (site_id, public_id, reason) values ($1, $2, 'retired')`,
      [id, code],
    );
    await expect(
      c.query(`update feeding_sites set public_id = $2 where id = $1`, [id, code]),
    ).rejects.toThrow(/public_id is a superseded code/);
    await expect(
      c.query(
        `insert into feeding_sites (name, lat, lng, public_id) values ('x', 37.44, 24.94, $1)`,
        [code],
      ),
    ).rejects.toThrow(/public_id is a superseded code/);
  });

  it("lets a code be superseded: the new code first, then the old one recorded", async () => {
    const id = await site();
    await c.query(`update feeding_sites set public_id = $2 where id = $1`, [id, `first-${id}`]);
    await c.query("begin");
    await c.query(`update feeding_sites set public_id = $2 where id = $1`, [id, `second-${id}`]);
    await c.query(
      `insert into feeding_site_old_codes (site_id, public_id, reason) values ($1, $2, 'moved')`,
      [id, `first-${id}`],
    );
    await c.query("commit");
  });

  it("refuses an unknown reason", async () => {
    const id = await site();
    await expect(
      c.query(
        `insert into feeding_site_old_codes (site_id, public_id, reason) values ($1, $2, 'lost')`,
        [id, `r-${id}`],
      ),
    ).rejects.toThrow(/feeding_site_old_codes_reason_ck/);
  });
});

describe("site_page_reads", () => {
  it("records a person and a site, and has no position column", async () => {
    const id = await site();
    await c.query(`insert into site_page_reads (person_id, site_id) values ($1, $2)`, [personId, id]);
    const cols = await c.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'site_page_reads' order by ordinal_position`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual(["id", "person_id", "site_id", "at"]);
  });
});

describe("the migration on existing data (spec test 24)", () => {
  beforeEach(async () => {
    const tables = await s.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) {
      for (const t of tables.rows) {
        await s.query(`alter table if exists "${t.tablename}" disable trigger all`);
      }
    }
    await s.query(
      `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`,
    );
    await migrateUp(s, migrations, { throughIdx: BEFORE });
  });

  async function seed(): Promise<{ colony: number; sites: number[] }> {
    const colony = (
      await s.query<{ id: number }>(
        `insert into colonies (name, normalised_name, guardian_name) values ('Vaporia — Eleni''s', 'vaporia — eleni''s', 'Eleni') returning id`,
      )
    ).rows[0]!.id;
    const sites: number[] = [];
    for (const [name, lat, lng, col] of [
      ["Vaporia — Eleni's", 37.4452, 24.9423, colony],
      ["Kini harbour", 37.4431, 24.8987, null],
      ["Azolimnos steps", 37.4078, 24.9601, colony],
    ] as const) {
      sites.push(
        (
          await s.query<{ id: number }>(
            `insert into feeding_sites (name, lat, lng, colony_id) values ($1, $2, $3, $4) returning id`,
            [name, lat, lng, col],
          )
        ).rows[0]!.id,
      );
    }
    return { colony, sites };
  }

  const applied = async () =>
    (
      await s.query(`select count(*)::int as n from drizzle.__drizzle_migrations where created_at = $1`, [
        MINE.when,
      ])
    ).rows[0].n;

  it("stops with the ids listed when a site is already public, and changes nothing", async () => {
    const { sites } = await seed();
    await s.query(
      `update feeding_sites set is_public = true, made_public_by = 'someone' where id = any($1)`,
      [[sites[0], sites[2]]],
    );
    await expect(migrateUp(s, migrations)).rejects.toThrow(
      `feeding_sites public rows must be made private by hand first: ids ${sites[0]}, ${sites[2]}`,
    );
    expect(await applied()).toBe(0);
    const t = await s.query(`select to_regclass('public.mapping_events') as t`);
    expect(t.rows[0].t).toBeNull();
    const cols = await s.query(
      `select 1 from information_schema.columns where table_name = 'feeding_sites' and column_name = 'public_label'`,
    );
    expect(cols.rowCount).toBe(0);
  });

  it("runs once the public site is made private by hand", async () => {
    const { sites } = await seed();
    await s.query(`update feeding_sites set is_public = true where id = $1`, [sites[1]]);
    await expect(migrateUp(s, migrations)).rejects.toThrow(`ids ${sites[1]}`);
    await s.query(`update feeding_sites set is_public = false where id = $1`, [sites[1]]);
    await migrateUp(s, migrations);
    expect(await applied()).toBe(1);
  });

  it("gives each existing site exactly one system:migration 'existing' event with its name, position and colony", async () => {
    const { colony, sites } = await seed();
    await migrateUp(s, migrations);
    const r = await s.query(
      `select subject_kind, subject_id, kind, person_id, actor_system, after, before, note, redacted_at
         from mapping_events order by id`,
    );
    expect(r.rows).toHaveLength(sites.length);
    expect(r.rows.map((e) => e.subject_id)).toEqual(sites);
    for (const e of r.rows) {
      expect(e).toMatchObject({
        subject_kind: "site",
        kind: "existing",
        person_id: null,
        actor_system: "system:migration",
        before: null,
        note: null,
        redacted_at: null,
      });
    }
    expect(r.rows[0].after).toEqual({
      name: "Vaporia — Eleni's",
      lat: 37.4452,
      lng: 24.9423,
      colonyId: colony,
    });
    expect(r.rows[1].after).toEqual({ name: "Kini harbour", lat: 37.4431, lng: 24.8987, colonyId: null });
    const both = await s.query(
      `select count(*)::int as n from mapping_events where (person_id is null) = (actor_system is null)`,
    );
    expect(both.rows[0].n).toBe(0);
  });

  it("leaves every existing site private, with no label, no code and not retired", async () => {
    await seed();
    await migrateUp(s, migrations);
    const r = await s.query(
      `select count(*)::int as n from feeding_sites
        where is_public or public_label is not null or public_id is not null or retired_at is not null`,
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("runs on a database with no sites, writing no events", async () => {
    await migrateUp(s, migrations);
    const r = await s.query(`select count(*)::int as n from mapping_events`);
    expect(r.rows[0].n).toBe(0);
  });
});

// The rollback's up/down/up is proved for every migration, 0015 included, by
// runner.test.ts ("builds on an empty database and passes the up/down/up cycle").
