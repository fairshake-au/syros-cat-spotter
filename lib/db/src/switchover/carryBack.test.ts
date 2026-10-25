import crypto from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
} from "../migrate/runner";
import {
  carryBack,
  CarryBackRefusedError,
  formatCarryBackReport,
  type CarryBackReport,
} from "./carryBack";
import { compare, fingerprint } from "./fingerprint";
import { mark } from "./guard";

// SYC-121, task B.3 carry-back: the plan's tests 4 and 5, plus the safety
// properties around them (id collisions, exact values, ordering, re-runs,
// wrong targets). Each test builds two throwaway databases on the server
// DATABASE_URL points at: "old" (the old Replit database, at the baseline)
// and "neon" (Neon production: every migration, including SYC-98's real
// 0002 which adds photos.public_id, as the plan's test 4 describes).

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const admin = new pg.Client({ connectionString: withDb(baseUrl, "postgres") });
const created: string[] = [];
const open: pg.Client[] = [];

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function connectTo(name: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: withDb(baseUrl!, name) });
  await client.connect();
  open.push(client);
  return client;
}

async function freshDb(): Promise<{ name: string; client: pg.Client }> {
  const name = `carryback_test_${crypto.randomBytes(4).toString("hex")}`;
  await admin.query(`create database "${name}"`);
  created.push(name);
  return { name, client: await connectTo(name) };
}

const migrations = readMigrations(defaultMigrationsFolder());
const T0 = "2026-01-01T00:00:00.123456Z";

/** The same starting rows on both sides: what the copy put on Neon. */
async function seed(c: pg.Client): Promise<void> {
  await c.query(
    `insert into photos (id, data, mime, created_at) values
       (1, 'photo-one', 'image/jpeg', $1), (2, 'photo-two', 'image/png', $1)`,
    [T0],
  );
  await c.query(
    `insert into profiles (device_id, username, points, created_at) values
       ('dev-a', 'alice', 3, $1), ('dev-b', 'bob', 1, $1)`,
    [T0],
  );
  await c.query(
    `insert into cats (id, name, primary_photo_id, lat, lng, discoverer_device_id, created_at) values
       (1, 'Tom', 1, 37.4441234567, 24.9412345678, 'dev-a', $1),
       (2, 'Kitsos', 2, 37.45, 24.95, 'dev-b', $1)`,
    [T0],
  );
  await c.query(
    `insert into sightings (id, cat_id, device_id, photo_id, lat, lng, status, created_at)
     values (1, 1, 'dev-a', 1, 37.44, 24.94, 'approved', $1)`,
    [T0],
  );
  await c.query(
    `insert into cat_subscriptions (device_id, cat_id, created_at) values
       ('dev-a', 1, $1), ('dev-b', 2, $1)`,
    [T0],
  );
  await c.query(
    `insert into cat_updates (id, cat_id, update_type, message, created_at)
     values (1, 1, 'desexed', 'Tom was desexed', $1)`,
    [T0],
  );
  await c.query(
    `insert into notifications (id, device_id, cat_update_id, read, created_at)
     values (1, 'dev-a', 1, false, $1)`,
    [T0],
  );
  await c.query(
    `insert into push_tokens (device_id, token, updated_at) values ('dev-a', 'push-token-a', $1)`,
    [T0],
  );
  await c.query(
    `insert into device_credentials (device_id, secret_hash, created_at)
     values ('dev-a', 'SECRET-HASH-A-9f2c', $1)`,
    [T0],
  );
  for (const t of ["photos", "cats", "sightings", "cat_updates", "notifications"]) {
    await c.query(
      `select setval(pg_get_serial_sequence($1, 'id'), (select max(id) from ${t}), true)`,
      [t],
    );
  }
}

/**
 * old at 0000 with rows; neon at every migration (including the real 0002),
 * with the same rows, and marked as the copy of old (with old's
 * fingerprint, as db-ops' mark --fingerprint-file stores it).
 */
async function scenario(
  opts: {
    markWithFingerprint?: boolean;
    /**
     * The session timezone the copy's fingerprint was taken under, standing
     * in for the old Replit server's default when the carry-back target is a
     * Neon branch with a different default (the D.5 rehearsal).
     */
    copySessionTimezone?: string;
  } = {},
): Promise<{ old: pg.Client; neon: pg.Client; neonName: string }> {
  const oldDb = await freshDb();
  const old = oldDb.client;
  const neonDb = await freshDb();
  const neon = neonDb.client;
  await migrateUp(old, migrations, { throughIdx: 0 });
  await migrateUp(neon, migrations);
  await seed(old);
  await seed(neon);
  let fp;
  if (opts.copySessionTimezone) {
    const copySession = await connectTo(oldDb.name);
    await copySession.query(`set timezone = '${opts.copySessionTimezone}'`);
    fp = await fingerprint(copySession);
  } else {
    fp = await fingerprint(old);
  }
  await mark(
    neon,
    "cutover",
    "sha-of-fingerprint",
    opts.markWithFingerprint === false ? undefined : fp,
  );
  return { old, neon, neonName: neonDb.name };
}

/** What testers did on Neon in the plan's test 4. */
async function testersUseNeon(neon: pg.Client): Promise<void> {
  const photo = await neon.query<{ id: number }>(
    `insert into photos (data, mime, public_id) values ('new-photo-bytes', 'image/jpeg', 'pub-3') returning id`,
  );
  await neon.query(
    `insert into sightings (cat_id, device_id, photo_id, lat, lng) values (1, 'dev-b', $1, 37.46, 24.96)`,
    [photo.rows[0]!.id],
  );
  await neon.query(`update cats set name = 'Kitsos the Brave' where id = 2`);
  await neon.query(
    `delete from cat_subscriptions where device_id = 'dev-b' and cat_id = 2`,
  );
  await neon.query(
    `insert into observations (cat_id, kind, value, device_id, observed_at)
     values (1, 'note', '{"text": "sleeping"}', 'dev-a', now())`,
  );
}

function counts(report: CarryBackReport) {
  let inserts = 0;
  let updates = 0;
  let deletes = 0;
  for (const t of report.tables) {
    inserts += t.toInsert.length;
    updates += t.toUpdate.length;
    deletes += t.toDelete.length;
  }
  return { inserts, updates, deletes };
}

function table(report: CarryBackReport, name: string) {
  return report.tables.find((t) => t.table === name)!;
}

async function nextval(c: pg.Client, seq: string): Promise<number> {
  const r = await c.query<{ n: string }>(`select nextval($1)::text as n`, [seq]);
  return Number(r.rows[0]!.n);
}

async function maxId(c: pg.Client, t: string): Promise<number> {
  const r = await c.query<{ m: string }>(`select max(id)::text as m from ${t}`);
  return Number(r.rows[0]!.m);
}

beforeAll(async () => {
  await admin.connect();
});

// Each test drops its own databases, so no one hook has to drop all ~20 of
// them (that exceeded vitest's 10 s hook limit on CI's runner).
afterEach(async () => {
  for (const c of open.splice(0)) await c.end();
  for (const name of created.splice(0)) {
    await admin.query(`drop database if exists "${name}" with (force)`);
  }
}, 60_000);

afterAll(async () => {
  await admin.end();
});

describe("carry-back, end to end (test 4)", () => {
  it("dry run lists 2 inserts, 1 update, 1 delete and observations with no home; apply makes old equal and sequences right", async () => {
    const { old, neon } = await scenario();
    await testersUseNeon(neon);
    const before = await fingerprint(old);

    const dry = await carryBack(neon, old);
    expect(dry.applied).toBe(false);
    expect(counts(dry)).toEqual({ inserts: 2, updates: 1, deletes: 1 });
    expect(table(dry, "photos").toInsert).toEqual([3]);
    expect(table(dry, "sightings").toInsert).toEqual([2]);
    expect(table(dry, "cats").toUpdate).toEqual([2]);
    expect(table(dry, "cat_subscriptions").toDelete).toEqual([
      { device_id: "dev-b", cat_id: 2 },
    ]);
    // SYC-36: migration 0027 seeds one app_settings row (the donation link,
    // Samuel's Decision 6), and SYC-415's 0029 seeds a second (the
    // extra-photo switch, off); like observations, they live on Neon only.
    // SYC-396 PR 2.4's named_areas migration seeds 21 areas and one history
    // row each: Neon only too.
    expect(dry.noHomeInTarget).toEqual(["app_settings", "mapping_events", "named_areas", "observations"]);
    expect(dry.noHomeRows).toEqual({ app_settings: 2, mapping_events: 21, named_areas: 21, observations: 1 });
    expect(dry.droppedColumns).toEqual([
      // SYC-462's removal record (0034) lives on Neon only too; a removed
      // photo goes back as an empty picture (writeRows, test T17).
      { table: "photos", columns: ["public_id", "removed_at", "removed_by", "removed_reason"] },
      // SYC-101's generated folded name: the old database has no such
      // column, and recomputes nothing it needs from it.
      // SYC-63's deletion stamps live on Neon only, like the sightings ones.
      // SYC-130's home pin: also Neon only.
      {
        table: "cats",
        columns: [
          "normalised_name",
          "redacted_at",
          "redaction_reason",
          "home_lat",
          "home_lng",
        ],
      },
      // SYC-706's place stamp (0044): Neon only too. 0044's trigger lets a
      // row with no stamp be stamped once later.
      {
        table: "sightings",
        columns: ["redacted_at", "redaction_reason", "area_key", "on_island"],
      },
      // SYC-706's weekly-result bell entries (0045) and their place and
      // points (0046): Neon only too.
      { table: "notifications", columns: ["kind", "message", "place", "week_points"] },
      // SYC-706's push language (0047): Neon only too.
      { table: "push_tokens", columns: ["language"] },
    ]);
    expect(dry.baseline).toEqual({ status: "ok", changedTables: [] });
    // The dry run changed nothing.
    expect(await fingerprint(old)).toEqual(before);

    const applied = await carryBack(neon, old, { apply: true });
    expect(applied.applied).toBe(true);
    expect(counts(applied)).toEqual({ inserts: 2, updates: 1, deletes: 1 });

    expect(await compare(neon, old, { projected: true, onto: "target" })).toEqual([]);
    for (const t of ["photos", "sightings", "cats"]) {
      const m = await maxId(old, t);
      expect(await nextval(old, `${t}_id_seq`)).toBe(m + 1);
    }
    const name = await old.query(`select name from cats where id = 2`);
    expect(name.rows[0].name).toBe("Kitsos the Brave");
  });
});

describe("carry-back refuses a non-baseline old schema (test 5)", () => {
  it("refuses when the old database has a column Neon lacks", async () => {
    const { old, neon } = await scenario();
    await testersUseNeon(neon);
    await old.query(`alter table cats add column legacy_note text`);
    const before = await fingerprint(old);

    await expect(carryBack(neon, old, { apply: true })).rejects.toThrow(
      CarryBackRefusedError,
    );
    await expect(carryBack(neon, old, { apply: true })).rejects.toThrow(
      /legacy_note/,
    );
    expect(await fingerprint(old)).toEqual(before);
  });
});

describe("carry-back: exact values, secrets and every table", () => {
  it("carries photo bytes, credential hashes, push tokens and notifications exactly, and the report never shows them", async () => {
    const { old, neon } = await scenario();
    // Awkward bytes: backslashes, quotes, unicode, a NUL-free binary-ish
    // base64 blob of ~200 KB.
    const blob =
      "data:\\x00'\"é猫\n" + crypto.randomBytes(150_000).toString("base64");
    await neon.query(
      `insert into photos (data, mime, public_id) values ($1, 'image/webp', 'pub-big')`,
      [blob],
    );
    await neon.query(
      `update device_credentials set secret_hash = 'SECRET-HASH-A-ROTATED-77' where device_id = 'dev-a'`,
    );
    await neon.query(
      `insert into device_credentials (device_id, secret_hash) values ('dev-c-7a1f', 'SECRET-HASH-C-0b3e')`,
    );
    await neon.query(
      `update push_tokens set token = 'push-token-a2', updated_at = now() where device_id = 'dev-a'`,
    );
    await neon.query(`update notifications set read = true where id = 1`);
    await neon.query(
      `insert into notifications (device_id, cat_update_id) values ('dev-b', 1)`,
    );
    await neon.query(
      `update profiles set points = points + 5 where device_id = 'dev-b'`,
    );

    const dry = await carryBack(neon, old);
    const text = formatCarryBackReport(dry);
    expect(text).not.toMatch(/SECRET-HASH/);
    expect(text).not.toMatch(/push-token/);
    expect(text).not.toContain("dev-c-7a1f");
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
    expect(text).toMatch(/device_credentials: 1 insert, 1 update, 0 delete/);
    expect(text).toMatch(/#[0-9a-f]{12}/);

    const applied = await carryBack(neon, old, { apply: true });
    expect(applied.applied).toBe(true);
    expect(formatCarryBackReport(applied)).not.toMatch(/SECRET-HASH/);

    const oldPhoto = await old.query(`select data, mime from photos where id = 3`);
    expect(oldPhoto.rows[0].data).toBe(blob);
    expect(oldPhoto.rows[0].mime).toBe("image/webp");
    const creds = await old.query(
      `select device_id, secret_hash from device_credentials order by device_id`,
    );
    expect(creds.rows).toEqual([
      { device_id: "dev-a", secret_hash: "SECRET-HASH-A-ROTATED-77" },
      { device_id: "dev-c-7a1f", secret_hash: "SECRET-HASH-C-0b3e" },
    ]);
    // Microsecond timestamps survive (compare hashes their text form).
    expect(await compare(neon, old, { projected: true, onto: "target" })).toEqual([]);
  });
});

describe("carry-back of a photo removed for good (SYC-462, T17)", () => {
  it("carries a removed photo as an empty picture, and a second apply finds nothing to do", async () => {
    const { old, neon } = await scenario();
    const person = (
      await neon.query(
        `insert into people (email, name, added_by) values ('remover@example.com', 'R', 'cli:test') returning id`,
      )
    ).rows[0].id;
    // One photo removed after the copy (an update), and one added and removed on Neon (an insert).
    await neon.query(
      `update photos set data = null, removed_at = now(), removed_by = $1, removed_reason = 'SYC-462' where id = 1`,
      [person],
    );
    const added = (
      await neon.query(
        `insert into photos (data, mime, public_id, removed_at, removed_by, removed_reason)
         values (null, 'image/jpeg', 'pub-removed', now(), $1, 'SYC-462') returning id`,
        [person],
      )
    ).rows[0].id;
    const applied = await carryBack(neon, old, { apply: true });
    expect(applied.applied).toBe(true);
    // The old database is at the baseline: it has no public_id, so by id.
    const rows = await old.query(`select id, data from photos where id = any($1) order by id`, [[1, added]]);
    expect(rows.rows.map((r) => r.data)).toEqual(["", ""]);
    const again = await carryBack(neon, old, { apply: true });
    const photos = again.tables.find((t) => t.table === "photos");
    expect(photos?.toInsert ?? []).toEqual([]);
    expect(photos?.toUpdate ?? []).toEqual([]);
  });
});

describe("carry-back refuses id collisions and old-app writes since the copy", () => {
  it("refuses to apply when the old app wrote a row whose id Neon also used, and changes nothing", async () => {
    const { old, neon } = await scenario();
    // The old app, still reachable, took sighting id 2 after the copy...
    await old.query(
      `insert into sightings (cat_id, device_id, photo_id, lat, lng) values (2, 'dev-a', 2, 1, 1)`,
    );
    // ...and a tester on Neon took sighting id 2 as well.
    await testersUseNeon(neon);
    const before = await fingerprint(old);

    const dry = await carryBack(neon, old);
    expect(dry.baseline).toEqual({
      status: "changed",
      changedTables: ["sightings"],
    });
    expect(formatCarryBackReport(dry)).toMatch(/Apply will refuse/);

    await expect(carryBack(neon, old, { apply: true })).rejects.toThrow(
      /changed since the copy in: sightings/,
    );
    expect(await fingerprint(old)).toEqual(before);
  });

  it("refuses to apply when the source marker holds no copy fingerprint", async () => {
    const { old, neon } = await scenario({ markWithFingerprint: false });
    await testersUseNeon(neon);
    const dry = await carryBack(neon, old);
    expect(dry.baseline.status).toBe("missing");
    await expect(carryBack(neon, old, { apply: true })).rejects.toThrow(
      CarryBackRefusedError,
    );
  });
});

describe("carry-back orders its writes by foreign key", () => {
  it("inserts parents before children and deletes children before parents", async () => {
    const { old, neon } = await scenario();
    // A foreign key running against BASELINE_TABLES' order (cats is listed
    // before profiles), on both sides.
    for (const c of [old, neon]) {
      await c.query(
        `alter table cats add constraint cats_discoverer_fk
           foreign key (discoverer_device_id) references profiles(device_id)`,
      );
    }
    await neon.query(
      `insert into profiles (device_id, username) values ('dev-new', 'newbie')`,
    );
    await neon.query(
      `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id)
       values ('Pipitsa', 1, 37.1, 24.1, 'dev-new')`,
    );
    await neon.query(`delete from cat_subscriptions where cat_id = 2`);
    await neon.query(`delete from cats where id = 2`);
    await neon.query(`delete from profiles where device_id = 'dev-b'`);

    const applied = await carryBack(neon, old, { apply: true });
    expect(applied.applied).toBe(true);
    expect(await compare(neon, old, { projected: true, onto: "target" })).toEqual([]);
  });
});

describe("carry-back is safe to re-run", () => {
  it("a failure part-way through changes nothing, and a re-run then succeeds; a second apply is a no-op", async () => {
    const { old, neon } = await scenario();
    await testersUseNeon(neon);
    await neon.query(
      `insert into device_credentials (device_id, secret_hash) values ('dev-z', 'h')`,
    );
    // Make the old database fail late in the writes (device_credentials is
    // written after photos, cats and sightings).
    await old.query(
      `create function boom() returns trigger language plpgsql as $$
       begin raise exception 'simulated failure'; end $$`,
    );
    await old.query(
      `create trigger boom before insert on device_credentials
       for each row execute function boom()`,
    );
    const before = await fingerprint(old);

    await expect(carryBack(neon, old, { apply: true })).rejects.toThrow(
      /simulated failure/,
    );
    expect(await fingerprint(old)).toEqual(before);

    await old.query(`drop trigger boom on device_credentials`);
    const first = await carryBack(neon, old, { apply: true });
    expect(first.applied).toBe(true);
    expect(counts(first).inserts).toBe(3);

    const second = await carryBack(neon, old, { apply: true });
    expect(second.applied).toBe(true);
    expect(counts(second)).toEqual({ inserts: 0, updates: 0, deletes: 0 });
    expect(second.sequences).toEqual([]);
    expect(second.baseline.status).toBe("ok");
    expect(await compare(neon, old, { projected: true, onto: "target" })).toEqual([]);
  });
});

describe("carry-back refuses the wrong target or source", () => {
  it("refuses a target that carries cutover_done (a cut-over Neon branch)", async () => {
    const { old, neon } = await scenario();
    await mark(old, "cutover", "x");
    await expect(carryBack(neon, old)).rejects.toThrow(/cutover_done/);
  });

  it("refuses when the source and target are the same database", async () => {
    const { neon, neonName } = await scenario();
    const again = await connectTo(neonName);
    await expect(carryBack(neon, again)).rejects.toThrow(/same database/);
  });

  it("refuses a source with no switchover marker", async () => {
    const { old, neon } = await scenario();
    await neon.query(`drop schema switchover cascade`);
    await expect(carryBack(neon, old)).rejects.toThrow(/no switchover marker/);
  });
});

// Fable review, fix 1: the baseline's unique indexes on lower(name) and
// lower(username) (0000_baseline.sql) must not block a carry-back when a
// unique value moves between rows. Mirroring row by row in any fixed order
// passes through a state where two rows share the value.
describe("carry-back when a unique value moves between rows", () => {
  it("A1: cat 1 renamed Tom -> Tommy and a new cat named Tom", async () => {
    const { old, neon } = await scenario();
    await neon.query(`update cats set name = 'Tommy' where id = 1`);
    await neon.query(
      `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id)
       values ('Tom', 1, 37.2, 24.2, 'dev-b')`,
    );
    const applied = await carryBack(neon, old, { apply: true });
    expect(applied.applied).toBe(true);
    expect(await compare(neon, old, { projected: true, onto: "target" })).toEqual([]);
  });

  it("A2: cat Tom deleted and cat 2 renamed Tom", async () => {
    const { old, neon } = await scenario();
    await neon.query(`delete from cats where id = 1`);
    await neon.query(`update cats set name = 'Tom' where id = 2`);
    const applied = await carryBack(neon, old, { apply: true });
    expect(applied.applied).toBe(true);
    expect(await compare(neon, old, { projected: true, onto: "target" })).toEqual([]);
  });

  it("A3: two profiles swap usernames", async () => {
    const { old, neon } = await scenario();
    await neon.query(`update profiles set username = 'tmp' where device_id = 'dev-a'`);
    await neon.query(`update profiles set username = 'alice' where device_id = 'dev-b'`);
    await neon.query(`update profiles set username = 'bob' where device_id = 'dev-a'`);
    const applied = await carryBack(neon, old, { apply: true });
    expect(applied.applied).toBe(true);
    expect(await compare(neon, old, { projected: true, onto: "target" })).toEqual([]);
  });

  it("the unique indexes are back afterwards, exactly as they were", async () => {
    const { old, neon } = await scenario();
    await neon.query(`update cats set name = 'Tommy' where id = 1`);
    const defs = async () =>
      (
        await old.query<{ d: string }>(
          `select pg_get_indexdef(i.indexrelid) as d from pg_index i
             join pg_class c on c.oid = i.indrelid
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' order by 1`,
        )
      ).rows.map((r) => r.d);
    const before = await defs();
    await carryBack(neon, old, { apply: true });
    expect(await defs()).toEqual(before);
    await expect(
      old.query(`insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id)
                 values ('TOMMY', 1, 0, 0, 'x')`),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("a genuinely violating end state still rolls back cleanly", async () => {
    const { old, neon } = await scenario();
    // Neon without its unique index (SYC-101's folded one, which replaced
    // lower(name)) lets two cats differ only by case; the old database's
    // lower(name) index can't hold both.
    await neon.query(`drop index cats_normalised_name_unique`);
    await neon.query(
      `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id)
       values ('tom', 1, 37.2, 24.2, 'dev-b')`,
    );
    const before = await fingerprint(old);
    await expect(carryBack(neon, old, { apply: true })).rejects.toThrow();
    expect(await fingerprint(old)).toEqual(before);
    const idx = await old.query(
      `select 1 from pg_indexes where indexname = 'cats_name_lower_unique'`,
    );
    expect(idx.rowCount).toBe(1);
  });
});

// Fable re-check, N1: after one successful apply, the old database differs
// from the copy's fingerprint only by carry-back's own writes. A second
// rollback pass must still work; third-party writes must still be refused.
describe("carry-back leaves weekly-result bell entries on Neon (SYC-706)", () => {
  it("a week_result notification (no cat_update_id) neither stops nor reaches the old database", async () => {
    const { old, neon } = await scenario();
    await neon.query(
      `insert into notifications (device_id, kind, message)
       values ('dev-a', 'week_result', 'You came 2nd on Syros last week.')`,
    );
    // A cat notification made on Neon still goes back alongside it.
    await neon.query(
      `insert into notifications (device_id, cat_update_id) values ('dev-b', 1)`,
    );

    const dry = await carryBack(neon, old);
    expect(table(dry, "notifications").toInsert).toEqual([3]);

    const applied = await carryBack(neon, old, { apply: true });
    expect(applied.applied).toBe(true);
    const rows = await old.query(`select id from notifications order by id`);
    expect(rows.rows.map((r) => Number(r.id))).toEqual([1, 3]);
    expect(await compare(neon, old, { projected: true, onto: "target" })).toEqual([]);
    // Neon keeps its bell entry.
    const kept = await neon.query(`select count(*)::int as n from notifications where kind = 'week_result'`);
    expect(kept.rows[0].n).toBe(1);
  });
});

describe("a second carry-back pass after a successful apply", () => {
  it("E5: testers write again on Neon after an apply, and a second pass succeeds", async () => {
    const { old, neon } = await scenario();
    const signatureBefore = (await fingerprint(old)).schemaSignatureHash;
    await neon.query(`update cats set name = 'Kitsos II' where id = 2`);
    expect((await carryBack(neon, old, { apply: true })).applied).toBe(true);

    await neon.query(`update cats set name = 'Kitsos III' where id = 2`);
    await testersUseNeon(neon);
    const dry = await carryBack(neon, old);
    expect(dry.baseline).toEqual({ status: "ok", changedTables: [] });
    const second = await carryBack(neon, old, { apply: true });
    expect(second.applied).toBe(true);
    expect(await compare(neon, old, { projected: true, onto: "target" })).toEqual([]);
    // The anchor lives outside public: the old database's public schema
    // signature is exactly what it was.
    expect((await fingerprint(old)).schemaSignatureHash).toBe(signatureBefore);
  });

  it("an old-app write after the first apply is still refused", async () => {
    const { old, neon } = await scenario();
    await neon.query(`update cats set name = 'Kitsos II' where id = 2`);
    await carryBack(neon, old, { apply: true });

    await old.query(
      `insert into photos (data, mime) values ('old-app-after-rollback', 'image/jpeg')`,
    );
    await neon.query(
      `insert into photos (data, mime, public_id) values ('neon-again', 'image/jpeg', 'p')`,
    );
    const dry = await carryBack(neon, old);
    expect(dry.baseline).toEqual({ status: "changed", changedTables: ["photos"] });
    await expect(carryBack(neon, old, { apply: true })).rejects.toThrow(
      /changed since the copy in: photos/,
    );
  });

  it("the anchor only counts for the copy it came from", async () => {
    const { old, neon } = await scenario();
    await neon.query(`update cats set name = 'Kitsos II' where id = 2`);
    await carryBack(neon, old, { apply: true }); // anchor: cat 2 = 'Kitsos II'
    // The old app changes cat 2, then a new copy (a later cutover attempt)
    // is taken from that state and marked on Neon...
    await old.query(`update cats set name = 'Old app name' where id = 2`);
    await neon.query(`update cats set name = 'Old app name' where id = 2`);
    await mark(neon, "cutover", "sha-2", await fingerprint(old));
    // ...then the old app puts cat 2 back, so the old database matches the
    // first pass's anchor exactly but not the new copy, while a tester
    // renames cat 1 on Neon.
    await old.query(`update cats set name = 'Kitsos II' where id = 2`);
    await neon.query(`update cats set name = 'Tester rename' where id = 1`);
    // The stale anchor belongs to the earlier copy: it must not excuse the
    // old app's write (mirroring would overwrite it).
    await expect(carryBack(neon, old, { apply: true })).rejects.toThrow(
      /changed since the copy in: cats/,
    );
  });

  it("a dry run stays read-only: it never creates the anchor or its schema", async () => {
    const { old, neon } = await scenario();
    await testersUseNeon(neon);
    await carryBack(neon, old);
    const s = await old.query(
      `select 1 from pg_namespace where nspname = 'switchover'`,
    );
    expect(s.rowCount).toBe(0);
  });
});

// Fable review, fix 3: fingerprints and diffs must not depend on each
// server's session defaults (timezone, DateStyle, ...).
describe("fingerprints don't depend on session defaults", () => {
  it("compare finds no difference between identical databases with different default timezones", async () => {
    const a = (await freshDb()).client;
    const bDb = await freshDb();
    await admin.query(`alter database "${bDb.name}" set timezone = 'Pacific/Auckland'`);
    await admin.query(`alter database "${bDb.name}" set datestyle = 'SQL, DMY'`);
    const b = await connectTo(bDb.name);
    for (const c of [a, b]) {
      await migrateUp(c, migrations, { throughIdx: 0 });
      await seed(c);
    }
    expect(await compare(a, b)).toEqual([]);
  });

  it("a rehearsal target whose timezone differs from the copy's session still passes the unchanged-since-copy check", async () => {
    const { old, neon } = await scenario({ copySessionTimezone: "Pacific/Auckland" });
    await testersUseNeon(neon);
    const dry = await carryBack(neon, old);
    expect(dry.baseline).toEqual({ status: "ok", changedTables: [] });
    const applied = await carryBack(neon, old, { apply: true });
    expect(applied.applied).toBe(true);
  });
});
