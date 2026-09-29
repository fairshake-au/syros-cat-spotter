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
// and "neon" (Neon production: every migration, plus a simulated 0002 that
// adds photos.public_id, as the plan's test 4 describes).

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
 * old at 0000 with rows; neon at every migration plus a simulated 0002,
 * with the same rows, and marked as the copy of old (with old's
 * fingerprint, as db-ops' mark --fingerprint-file stores it).
 */
async function scenario(
  opts: { markWithFingerprint?: boolean } = {},
): Promise<{ old: pg.Client; neon: pg.Client; neonName: string }> {
  const old = (await freshDb()).client;
  const neonDb = await freshDb();
  const neon = neonDb.client;
  await migrateUp(old, migrations, { throughIdx: 0 });
  await migrateUp(neon, migrations);
  await neon.query(`alter table photos add column public_id text`);
  await seed(old);
  await seed(neon);
  const fp = await fingerprint(old);
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

afterEach(async () => {
  for (const c of open.splice(0)) await c.end();
});

afterAll(async () => {
  for (const name of created) {
    await admin.query(`drop database if exists "${name}" with (force)`);
  }
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
    expect(dry.noHomeInTarget).toEqual(["observations"]);
    expect(dry.noHomeRows).toEqual({ observations: 1 });
    expect(dry.droppedColumns).toEqual([
      { table: "photos", columns: ["public_id"] },
      { table: "sightings", columns: ["redacted_at", "redaction_reason"] },
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
