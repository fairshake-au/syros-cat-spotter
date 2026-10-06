import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
  rollbackLast,
} from "./runner";
import { schemaSignature, signatureDiff } from "./signature";

// The welfare_queue migration (SYC-43 part 2, PR 1; plan test P1-9), on a
// throwaway database. The links it adds are tested in peopleLeft.test.ts
// (P1-10).

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `welfare_queue_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
const migrations = readMigrations(defaultMigrationsFolder());
const mine = migrations.find((m) => m.tag.endsWith("_welfare_queue"));

let c: pg.Client;

const freshDb = async () => {
  await c?.end().catch(() => undefined);
  await admin.query(`drop database if exists "${name}"`);
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
};

beforeAll(async () => {
  await admin.connect();
});

afterAll(async () => {
  await c?.end().catch(() => undefined);
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

describe("P1-9: the welfare_queue migration", () => {
  it("is found, and is the one after people_left", () => {
    expect(mine).toBeDefined();
    expect(migrations[mine!.idx - 1]!.tag.endsWith("_people_left")).toBe(true);
  });

  it("rollback restores the schema from before it exactly, and up/down/up works", async () => {
    await freshDb();
    await migrateUp(c, migrations, { throughIdx: mine!.idx - 1 });
    const before = await schemaSignature(c, "public");
    await migrateUp(c, migrations, { throughIdx: mine!.idx });
    const after = await schemaSignature(c, "public");
    expect(await rollbackLast(c, migrations)).toBe(mine!.tag);
    expect(
      signatureDiff(await schemaSignature(c, "public"), before, {
        actual: "after rollback",
        expected: "before",
      }),
    ).toEqual([]);
    await migrateUp(c, migrations, { throughIdx: mine!.idx });
    expect(
      signatureDiff(await schemaSignature(c, "public"), after, {
        actual: "second up",
        expected: "first up",
      }),
    ).toEqual([]);
  });

  it("refuses to run while any state_changed_by holds a value, and changes nothing", async () => {
    await freshDb();
    await migrateUp(c, migrations, { throughIdx: mine!.idx - 1 });
    await c.query(
      `insert into welfare_reports
         (public_id, severity, lat, lng, client_ref, state_changed_by)
       values ('r-1', 'urgent', 37.4, 24.9, 'c-1', 'not-checked-by-the-database')`,
    );
    const before = await schemaSignature(c, "public");
    await expect(
      migrateUp(c, migrations, { throughIdx: mine!.idx }),
    ).rejects.toThrow(/state_changed_by is not empty/);
    expect(
      signatureDiff(await schemaSignature(c, "public"), before, {
        actual: "after refused migration",
        expected: "before",
      }),
    ).toEqual([]);
  });

  it("rollback refuses once a state change or team note is on record, and changes nothing", async () => {
    await freshDb();
    await migrateUp(c, migrations, { throughIdx: mine!.idx });
    const person = await c.query(
      `insert into people (email, name) values ('susan@example.com', 'Susan') returning id`,
    );
    await c.query(
      `insert into welfare_reports
         (public_id, severity, lat, lng, client_ref, team_note, team_note_by, team_note_at)
       values ('r-1', 'urgent', 37.4, 24.9, 'c-1', 'went', $1, now())`,
      [person.rows[0].id],
    );
    const after = await schemaSignature(c, "public");
    await expect(rollbackLast(c, migrations)).rejects.toThrow(
      /rolling back would erase who did what/,
    );
    expect(
      signatureDiff(await schemaSignature(c, "public"), after, {
        actual: "after refused rollback",
        expected: "before",
      }),
    ).toEqual([]);
  });
});
