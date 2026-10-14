// Same throwaway-database pattern as deletionUnlinks.test.ts.
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
const name = `homepin_test_${crypto.randomBytes(4).toString("hex")}`;
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

const insertCat = (lat: number | null, lng: number | null) =>
  c.query(
    `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id, home_lat, home_lng)
     values ($1, 1, 37.44, 24.94, 'dev-a', $2, $3) returning id`,
    [`pin-${crypto.randomBytes(3).toString("hex")}`, lat, lng],
  );

describe("cats home pin", () => {
  it("allows both or neither", async () => {
    await expect(insertCat(null, null)).resolves.toBeTruthy();
    await expect(insertCat(37.44123, 24.94123)).resolves.toBeTruthy();
  });
  it("refuses one without the other", async () => {
    await expect(insertCat(37.44, null)).rejects.toThrow(/cats_home_pin_ck/);
    await expect(insertCat(null, 24.94)).rejects.toThrow(/cats_home_pin_ck/);
  });
});
