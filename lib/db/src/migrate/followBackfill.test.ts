import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
} from "./runner";

// SYC-624 B1: 0041 makes everyone who has spotted a cat, and every current
// owner, a follower of it. Runs on a throwaway database brought up to just
// before 0041 and seeded, then migrates through it.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `follow_backfill_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

const migrations = readMigrations(defaultMigrationsFolder());
const TARGET = migrations.find((m) => m.tag === "0041_cat_unfollows")!;
const BEFORE = migrations.find((m) => m.idx === TARGET.idx - 1)!.idx;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
});

afterAll(async () => {
  await c.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

beforeEach(async () => {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;`);
  await migrateUp(c, migrations, { throughIdx: BEFORE });
});

async function seedCat(catName: string, ownerDeviceId: string | null) {
  const r = await c.query<{ id: number }>(
    `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id, owner_device_id)
     values ($1, 0, 37.44, 24.94, 'discoverer', $2) returning id`,
    [catName, ownerDeviceId],
  );
  return r.rows[0]!.id;
}

async function seedSighting(catId: number, deviceId: string, status: string) {
  await c.query(
    `insert into sightings (cat_id, device_id, photo_id, lat, lng, status)
     values ($1, $2, 0, 37.44, 24.94, $3)`,
    [catId, deviceId, status],
  );
}

const followers = async (catId: number) =>
  (
    await c.query<{ device_id: string }>(
      `select device_id from cat_subscriptions where cat_id = $1 order by device_id`,
      [catId],
    )
  ).rows.map((r) => r.device_id);

describe("0041 follow backfill", () => {
  it("makes an owner with no sightings a follower", async () => {
    const cat = await seedCat("Owned", "owner-dev");
    await migrateUp(c, migrations, { throughIdx: TARGET.idx });
    expect(await followers(cat)).toEqual(["owner-dev"]);
  });

  it("makes resolved spotters followers, not pending ones or deleted devices", async () => {
    const cat = await seedCat("Seen", "deleted:abc");
    await seedSighting(cat, "spotter", "resolved");
    await seedSighting(cat, "spotter", "resolved");
    await seedSighting(cat, "pending-dev", "pending");
    await seedSighting(cat, "deleted:xyz", "resolved");
    await migrateUp(c, migrations, { throughIdx: TARGET.idx });
    expect(await followers(cat)).toEqual(["spotter"]);
  });

  it("does not duplicate an owner who also spotted, and skips unowned cats", async () => {
    const cat = await seedCat("Both", "owner-dev");
    await seedSighting(cat, "owner-dev", "resolved");
    const unowned = await seedCat("Nobody", null);
    await migrateUp(c, migrations, { throughIdx: TARGET.idx });
    expect(await followers(cat)).toEqual(["owner-dev"]);
    expect(await followers(unowned)).toEqual([]);
  });
});
