// SYC-221 PR 2. Same throwaway-database pattern as catHomePin.test.ts.
import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "./runner";

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `wording_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, readMigrations(defaultMigrationsFolder()));
});

afterAll(async () => {
  await c.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

const insertUpdate = (wording: string | null, day: string | null) =>
  c.query(
    `insert into cat_updates (cat_id, update_type, message, wording, wording_day)
     values (1, 'sighting', 'x', $1, $2)`,
    [wording, day],
  );

describe("cat_updates wording and wording_day", () => {
  it("allows no label, a plain label with no day, and a day label with a day", async () => {
    await expect(insertUpdate(null, null)).resolves.toBeTruthy();
    for (const w of ["sterilised", "spotted_again", "new_cat"]) {
      await expect(insertUpdate(w, null)).resolves.toBeTruthy();
    }
    for (const w of ["seen_weekday", "seen_date"]) {
      await expect(insertUpdate(w, "2026-10-27")).resolves.toBeTruthy();
    }
  });
  it("refuses a day label without a day", async () => {
    await expect(insertUpdate("seen_weekday", null)).rejects.toThrow(/cat_updates_wording_day_check/);
    await expect(insertUpdate("seen_date", null)).rejects.toThrow(/cat_updates_wording_day_check/);
  });
  it("refuses a day with any other label, or with no label", async () => {
    await expect(insertUpdate("sterilised", "2026-10-27")).rejects.toThrow(/cat_updates_wording_day_check/);
    await expect(insertUpdate(null, "2026-10-27")).rejects.toThrow(/cat_updates_wording_day_check/);
  });
  it("refuses a label that isn't one of the five", async () => {
    await expect(insertUpdate("rename", null)).rejects.toThrow(/cat_updates_wording_check/);
  });
});
