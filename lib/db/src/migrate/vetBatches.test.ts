import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
} from "./runner";

// SYC-677 A: the vet batch tables and the kept-photo link.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `vet_batches_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
let personId: string;
let colonyId: number;
let catId: number;

const photo = async () =>
  (await c.query<{ id: number }>(`insert into photos (data) values ('eA==') returning id`))
    .rows[0]!.id;
const batch = async (colony: number | null = null, area: string | null = null) =>
  (
    await c.query<{ id: number }>(
      `insert into vet_batches (created_by, date, colony_id, area_key)
       values ($1, '2026-10-24', $2, $3) returning id`,
      [personId, colony, area],
    )
  ).rows[0]!.id;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, readMigrations(defaultMigrationsFolder()));
  personId = (
    await c.query<{ id: string }>(
      `insert into people (email, name, added_by) values ('vet@example.com', 'Vera', 'cli:test') returning id`,
    )
  ).rows[0]!.id;
  colonyId = (
    await c.query<{ id: number }>(`insert into colonies (name, normalised_name) values ('Test', 'test') returning id`)
  ).rows[0]!.id;
  catId = (
    await c.query<{ id: number }>(
      `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id) values ('Tom', $1, 37.4, 24.9, 'd') returning id`,
      [await photo()],
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  await c.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

describe("vet batch tables (SYC-677)", () => {
  it("takes a batch with a colony, a batch with an area, cats and photos", async () => {
    const a = await batch(colonyId);
    const b = await batch(null, "kini");
    expect(a).not.toBe(b);
    const known = await c.query(
      `insert into vet_batch_cats (batch_id, position, cat_id) values ($1, 0, $2) returning id`,
      [a, catId],
    );
    const fresh = await c.query(
      `insert into vet_batch_cats (batch_id, position, new_cat) values ($1, 1, $2) returning id`,
      [a, JSON.stringify({ name: null, description: "ginger" })],
    );
    const p = await photo();
    await c.query(
      `insert into vet_batch_photos (batch_cat_id, photo_id, position) values ($1, $2, 0)`,
      [known.rows[0].id, p],
    );
    expect(fresh.rows).toHaveLength(1);
  });

  it("takes a kept photo, once per photo", async () => {
    const p = await photo();
    const obs = await c.query<{ id: number }>(
      `insert into observations (cat_id, kind, value, device_id, observed_at)
       values ($1, 'vet_visit', '{}', 'd', now()) returning id`,
      [catId],
    );
    await c.query(`insert into vet_visit_photos (photo_id, visit_id, cat_id) values ($1, $2, $3)`, [
      p,
      obs.rows[0]!.id,
      catId,
    ]);
    await expect(
      c.query(`insert into vet_visit_photos (photo_id, visit_id, cat_id) values ($1, $2, $3)`, [
        p,
        obs.rows[0]!.id,
        catId,
      ]),
    ).rejects.toThrow();
  });

  it("deleting a batch removes its cats and their photo rows, not the photos", async () => {
    const id = await batch();
    const p = await photo();
    const bc = (
      await c.query<{ id: number }>(
        `insert into vet_batch_cats (batch_id, position, cat_id) values ($1, 0, $2) returning id`,
        [id, catId],
      )
    ).rows[0]!.id;
    await c.query(
      `insert into vet_batch_photos (batch_cat_id, photo_id, position) values ($1, $2, 0)`,
      [bc, p],
    );
    await c.query(`delete from vet_batches where id = $1`, [id]);
    expect((await c.query(`select 1 from vet_batch_cats where batch_id = $1`, [id])).rowCount).toBe(0);
    expect((await c.query(`select 1 from vet_batch_photos where batch_cat_id = $1`, [bc])).rowCount).toBe(0);
    expect((await c.query(`select 1 from photos where id = $1`, [p])).rowCount).toBe(1);
  });

  it("refuses a batch with both a colony and an area", async () => {
    await expect(batch(colonyId, "kini")).rejects.toThrow(/vet_batches_place_ck/);
  });

  it("refuses a batch cat with both a cat and a new cat", async () => {
    const id = await batch();
    await expect(
      c.query(
        `insert into vet_batch_cats (batch_id, position, cat_id, new_cat) values ($1, 0, $2, $3)`,
        [id, catId, JSON.stringify({ name: null, description: "x" })],
      ),
    ).rejects.toThrow(/vet_batch_cats_identity_ck/);
  });
});
