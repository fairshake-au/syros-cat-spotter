import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "./runner";

// SYC-706 (migration 0044): a sighting stays append-only, but its place
// (area_key, on_island) may be stamped in the update that resolves it, or
// once on its own on a row that has none yet. Never restamped, never stamped
// alongside any other change.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `place_stamp_test_${crypto.randomBytes(4).toString("hex")}`;
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

beforeEach(async () => {
  await c.query("begin");
  await c.query(`alter table sightings disable trigger sightings_no_truncate`);
  await c.query(`truncate sightings, cats restart identity cascade`);
  await c.query(`alter table sightings enable trigger sightings_no_truncate`);
  await c.query("commit");
});

async function sighting(status = "pending"): Promise<number> {
  const r = await c.query<{ id: number }>(
    `insert into sightings (device_id, photo_id, lat, lng, status)
     values ('dev-a', 1, 37.44, 24.94, $1) returning id`,
    [status],
  );
  return r.rows[0]!.id;
}

async function row(id: number) {
  const r = await c.query(`select * from sightings where id = $1`, [id]);
  return r.rows[0];
}

describe("sightings: the place stamp (0044)", () => {
  it("accepts resolve plus stamp in one update", async () => {
    const id = await sighting();
    await c.query(
      `update sightings set cat_id = 7, status = 'resolved',
         area_key = 'ermoupoli', on_island = true where id = $1`,
      [id],
    );
    expect(await row(id)).toMatchObject({
      cat_id: 7,
      status: "resolved",
      area_key: "ermoupoli",
      on_island: true,
    });
  });

  it("accepts a stamp on its own on an unstamped row", async () => {
    const id = await sighting("pending");
    await c.query(`update sightings set cat_id = 7, status = 'resolved' where id = $1`, [id]);
    await c.query(
      `update sightings set area_key = 'off', on_island = true where id = $1`,
      [id],
    );
    expect(await row(id)).toMatchObject({ area_key: "off", on_island: true });
  });

  it("refuses a stamp with on_island left null", async () => {
    const id = await sighting();
    await expect(
      c.query(`update sightings set area_key = 'ermoupoli' where id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses a restamp of a stamped row", async () => {
    const id = await sighting();
    await c.query(
      `update sightings set area_key = 'ermoupoli', on_island = true where id = $1`,
      [id],
    );
    await expect(
      c.query(`update sightings set area_key = 'kini', on_island = true where id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      c.query(`update sightings set on_island = false where id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
    expect(await row(id)).toMatchObject({ area_key: "ermoupoli", on_island: true });
  });

  it("refuses a status move that overwrites a stamped place", async () => {
    const id = await sighting();
    await c.query(
      `update sightings set area_key = 'ermoupoli', on_island = true where id = $1`,
      [id],
    );
    await expect(
      c.query(
        `update sightings set cat_id = 7, status = 'resolved', area_key = 'kini' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      c.query(
        `update sightings set cat_id = 7, status = 'resolved', on_island = false where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
    // The same place written again through the move is fine.
    await c.query(
      `update sightings set cat_id = 7, status = 'resolved',
         area_key = 'ermoupoli', on_island = true where id = $1`,
      [id],
    );
    expect(await row(id)).toMatchObject({ status: "resolved", area_key: "ermoupoli" });
  });

  it("refuses a status move that stamps only one of the two", async () => {
    const id = await sighting();
    await expect(
      c.query(
        `update sightings set cat_id = 7, status = 'resolved', area_key = 'ermoupoli' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      c.query(
        `update sightings set cat_id = 7, status = 'resolved', on_island = true where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
    expect(await row(id)).toMatchObject({ status: "pending", area_key: null, on_island: null });
  });

  it("refuses a stamp alongside another column", async () => {
    const id = await sighting();
    await expect(
      c.query(
        `update sightings set area_key = 'ermoupoli', on_island = true, lat = 37.45 where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
    expect(await row(id)).toMatchObject({ area_key: null, on_island: null });
  });
});
