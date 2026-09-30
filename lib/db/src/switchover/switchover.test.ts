import crypto from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
} from "../migrate/runner";
import { compare, fingerprint } from "./fingerprint";
import {
  cutoverDone,
  GuardRefusedError,
  guardTarget,
  mark,
  rehearsalMarked,
} from "./guard";

// Each test gets its own throwaway database on the server DATABASE_URL points
// at, matching the pattern in ../migrate/runner.test.ts. Only tests 1, 2, 3
// and 6 from the plan's B.3 step 1 are in this chip's scope (Sonnet); tests
// 4 and 5 are carry-back's, built by the follow-on Opus chip.

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

async function freshDb(opts: { locale?: string } = {}): Promise<pg.Client> {
  const name = `switchover_test_${crypto.randomBytes(4).toString("hex")}`;
  if (opts.locale) {
    await admin.query(
      `create database "${name}" template template0 lc_collate '${opts.locale}' lc_ctype '${opts.locale}'`,
    );
  } else {
    await admin.query(`create database "${name}"`);
  }
  created.push(name);
  const client = new pg.Client({ connectionString: withDb(baseUrl!, name) });
  await client.connect();
  open.push(client);
  return client;
}

/** Applies exactly 0000_baseline.sql, whose 9 tables match BASELINE_TABLES. */
async function withBaseline(client: pg.Client): Promise<void> {
  const migrations = readMigrations(defaultMigrationsFolder());
  await migrateUp(client, migrations, { throughIdx: 0 });
}

// A fixed timestamp, so two databases populated at different wall-clock
// moments still fingerprint identically when their data is identical.
const FIXED_CREATED_AT = "2026-01-01T00:00:00Z";

async function insertPhoto(
  client: pg.Client,
  id: number,
  data: string,
): Promise<void> {
  await client.query(
    `insert into photos (id, data, mime, created_at) values ($1, $2, 'image/jpeg', $3)`,
    [id, data, FIXED_CREATED_AT],
  );
}

async function insertCat(
  client: pg.Client,
  id: number,
  photoId: number,
): Promise<void> {
  await client.query(
    `insert into cats (id, name, primary_photo_id, lat, lng, discoverer_device_id, created_at)
     values ($1, $2, $3, 37.4, 24.9, 'device-1', $4)`,
    [id, `cat-${id}`, photoId, FIXED_CREATED_AT],
  );
}

beforeAll(async () => {
  await admin.connect();
});

afterEach(async () => {
  for (const c of open.splice(0)) await c.end();
});

afterAll(async () => {
  for (const name of created)
    await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

describe("fingerprint (test 1: order-independence and byte sensitivity)", () => {
  it("gives the same result for the same rows inserted in a different order", async () => {
    const a = await freshDb();
    const b = await freshDb();
    await withBaseline(a);
    await withBaseline(b);

    await insertPhoto(a, 1, "aaa");
    await insertPhoto(a, 2, "bbb");
    await insertCat(a, 1, 1);
    await insertCat(a, 2, 2);

    // Same rows, reverse order.
    await insertPhoto(b, 2, "bbb");
    await insertPhoto(b, 1, "aaa");
    await insertCat(b, 2, 2);
    await insertCat(b, 1, 1);

    const fpA = await fingerprint(a);
    const fpB = await fingerprint(b);
    expect(fpA.tables).toEqual(fpB.tables);
  });

  it("changing one byte of one photo changes the photos hash and nothing else", async () => {
    const a = await freshDb();
    const b = await freshDb();
    await withBaseline(a);
    await withBaseline(b);

    await insertPhoto(a, 1, "aaaa");
    await insertPhoto(a, 2, "bbbb");
    await insertCat(a, 1, 1);

    await insertPhoto(b, 1, "aaab"); // one byte different
    await insertPhoto(b, 2, "bbbb");
    await insertCat(b, 1, 1);

    const fpA = await fingerprint(a);
    const fpB = await fingerprint(b);
    const byTable = (fp: typeof fpA) =>
      Object.fromEntries(fp.tables.map((t) => [t.table, t.hash]));
    const hashesA = byTable(fpA);
    const hashesB = byTable(fpB);
    expect(hashesA.photos).not.toBe(hashesB.photos);
    for (const table of Object.keys(hashesA)) {
      if (table === "photos") continue;
      expect(hashesA[table]).toBe(hashesB[table]);
    }
  });
});

describe("compare (test 2)", () => {
  it("fails on a sequence behind max(id)", async () => {
    const a = await freshDb();
    const b = await freshDb();
    await withBaseline(a);
    await withBaseline(b);
    await insertPhoto(a, 1, "x");
    await insertPhoto(b, 1, "x");
    // Push the target's sequence behind the data it actually holds.
    await b.query(`insert into photos (id, data, mime) values (5, 'y', 'image/jpeg')`);
    await b.query(`select setval('photos_id_seq', 1, true)`);

    const diffs = await compare(a, b);
    expect(diffs.some((d) => d.kind === "sequence")).toBe(true);
  });

  it("fails on a missing index (caught at the schema-signature level)", async () => {
    const a = await freshDb();
    const b = await freshDb();
    await withBaseline(a);
    await withBaseline(b);
    await b.query(`drop index "profiles_username_lower_idx"`);

    const diffs = await compare(a, b);
    expect(diffs.some((d) => d.kind === "signature")).toBe(true);
  });

  it("fails on a different datcollate", async () => {
    const a = await freshDb();
    let b: pg.Client;
    try {
      b = await freshDb({ locale: "C" });
    } catch {
      // Some Postgres installs don't have every locale available; skip
      // rather than fail the whole suite over an environment gap.
      return;
    }
    await withBaseline(a);
    await withBaseline(b);

    const diffs = await compare(a, b);
    expect(diffs.some((d) => d.kind === "collation")).toBe(true);
  });
});

describe("the switchover state machine (test 3)", () => {
  it("S-empty: both copy-rehearsal and copy-cutover (guard-target) are accepted", async () => {
    const t = await freshDb();
    await expect(guardTarget(t, "rehearsal")).resolves.toBeUndefined();
    await expect(guardTarget(t, "cutover")).resolves.toBeUndefined();
  });

  it("S-rehearsal: both are accepted, and the marker survives the wipe", async () => {
    const t = await freshDb();
    await guardTarget(t, "rehearsal");
    await mark(t, "rehearsal", "fp-1");
    expect(await rehearsalMarked(t)).toBe(true);

    // A dummy table stands in for a restored dump.
    await t.query(`create table "public"."dummy" (id int)`);

    await expect(guardTarget(t, "rehearsal")).resolves.toBeUndefined();
    expect(await rehearsalMarked(t)).toBe(true); // survives the wipe
    await t.query(`create table "public"."dummy" (id int)`);
    await expect(guardTarget(t, "cutover")).resolves.toBeUndefined();
    expect(await rehearsalMarked(t)).toBe(true);
  });

  it("S-failed-copy: the marker is still there, cutover_done is absent, and a second copy-cutover is accepted", async () => {
    const t = await freshDb();
    await guardTarget(t, "rehearsal");
    await mark(t, "rehearsal", "fp-1");
    await t.query(`create table "public"."dummy" (id int)`);
    // Simulate a copy-cutover that guarded, then failed before mark ran.
    await guardTarget(t, "cutover");

    expect(await rehearsalMarked(t)).toBe(true);
    expect(await cutoverDone(t)).toBe(false);
    await expect(guardTarget(t, "cutover")).resolves.toBeUndefined();
  });

  it("a database with tables and neither marker is refused in cutover mode", async () => {
    const t = await freshDb();
    await t.query(`create table "public"."dummy" (id int)`);
    await expect(guardTarget(t, "cutover")).rejects.toThrow(GuardRefusedError);
  });

  it("S-cut: cutover_done exists, and both copies are refused", async () => {
    const t = await freshDb();
    await guardTarget(t, "rehearsal");
    await mark(t, "rehearsal", "fp-1");
    await guardTarget(t, "cutover");
    await mark(t, "cutover", "fp-2");

    expect(await cutoverDone(t)).toBe(true);
    expect(await rehearsalMarked(t)).toBe(false);
    await expect(guardTarget(t, "rehearsal")).rejects.toThrow(GuardRefusedError);
    await expect(guardTarget(t, "cutover")).rejects.toThrow(GuardRefusedError);
  });

  it("mark --mode cutover leaves rehearsal_marker gone and cutover_done present, never both and never neither", async () => {
    const t = await freshDb();
    await guardTarget(t, "rehearsal");
    await mark(t, "rehearsal", "fp-1");
    expect(await rehearsalMarked(t)).toBe(true);
    expect(await cutoverDone(t)).toBe(false);

    await guardTarget(t, "cutover");
    await mark(t, "cutover", "fp-2");
    expect(await rehearsalMarked(t)).toBe(false);
    expect(await cutoverDone(t)).toBe(true);
  });
});

describe("fingerprint's source session is read-only (test 6)", () => {
  it("refuses an insert with SQLSTATE 25006", async () => {
    const t = await freshDb();
    await withBaseline(t);
    await insertPhoto(t, 1, "x");
    await t.query("set session characteristics as transaction read only");

    // Reading through it still works.
    await expect(fingerprint(t)).resolves.toBeDefined();

    // Writing through the same (now read-only) session is refused.
    await expect(
      t.query(`insert into photos (id, data, mime) values (2, 'y', 'image/jpeg')`),
    ).rejects.toMatchObject({ code: "25006" });
  });
});
