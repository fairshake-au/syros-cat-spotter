import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "./runner";

// SYC-759 part 1: `TRUNCATE cats CASCADE` emptied every cat and the vet
// tables that point at them in one statement; nothing it reached had a
// guard. The migration is found by its tag name, not its number, so
// renumbering it (lib/db/migrations/README.md) needs no change here.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const dbName = `cats_no_truncate_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

const migrations = readMigrations(defaultMigrationsFolder());
const MINE = migrations.find((m) => m.tag.endsWith("_cats_no_truncate"));

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

describe("cats refuses TRUNCATE (SYC-759)", () => {
  it("refuses TRUNCATE ... CASCADE, which used to empty cats and the vet tables", async () => {
    await expect(c.query("truncate cats cascade")).rejects.toThrow(/cats is append-only: TRUNCATE is not allowed/);
  });

  it("refuses it with the referencing tables named alongside, too", async () => {
    await expect(c.query("truncate cats, vet_batch_cats, vet_visit_photos, vet_batch_photos")).rejects.toThrow(
      /cats is append-only: TRUNCATE is not allowed/,
    );
  });

  it("can be switched off for one statement by the table owner, the way tests empty a guarded table", async () => {
    await c.query("begin");
    try {
      await c.query("alter table cats disable trigger cats_no_truncate");
      await c.query("truncate cats cascade");
      await c.query("alter table cats enable trigger cats_no_truncate");
    } finally {
      await c.query("rollback");
    }
    await expect(c.query("truncate cats cascade")).rejects.toThrow(/append-only/);
  });
});
