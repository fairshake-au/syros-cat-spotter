import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "./runner";

// SYC-462 (spec §4.1): migration 0034. A photo has no picture exactly when it
// is marked removed, with who and why; a removed photo can't be restored, and
// the rollback refuses (dropping nothing) once any photo is removed.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `photo_removal_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
let personId: string;

const newPhoto = async () =>
  (await c.query<{ id: number }>(`insert into photos (data) values ('eA==') returning id`)).rows[0]!
    .id;
const remove = (id: number) =>
  c.query(
    `update photos set data = null, removed_at = now(), removed_by = $1, removed_reason = 'SYC-1' where id = $2`,
    [personId, id],
  );

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, readMigrations(defaultMigrationsFolder()));
  personId = (
    await c.query<{ id: string }>(
      `insert into people (email, name, added_by) values ('susan@example.com', 'Susan', 'cli:test') returning id`,
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  await c?.end();
  await admin.query(`drop database if exists "${name}" with (force)`);
  await admin.end();
});

describe("T0b: photos_removed_ck", () => {
  it("accepts a removed photo with no picture, who and why", async () => {
    const id = await newPhoto();
    await remove(id);
    const r = await c.query(`select data, removed_reason from photos where id = $1`, [id]);
    expect(r.rows[0]).toEqual({ data: null, removed_reason: "SYC-1" });
  });

  it.each([
    ["no picture, not marked removed", `data = null`],
    ["marked removed, picture still there", `removed_at = now(), removed_by = $P, removed_reason = 'SYC-1'`],
    ["removed without who", `data = null, removed_at = now(), removed_reason = 'SYC-1'`],
    ["removed without why", `data = null, removed_at = now(), removed_by = $P`],
  ])("refuses %s", async (_label, set) => {
    const id = await newPhoto();
    await expect(
      c.query(`update photos set ${set.replace("$P", `'${personId}'`)} where id = $1`, [id]),
    ).rejects.toThrow(/photos_removed_ck/);
  });

  it("and the foreign key refuses removed_by naming no person", async () => {
    const id = await newPhoto();
    await expect(
      c.query(
        `update photos set data = null, removed_at = now(), removed_by = gen_random_uuid(), removed_reason = 'SYC-1' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("an ordinary new photo (the running app's insert) still works", async () => {
    const r = await c.query(`insert into photos (data, mime) values ('eA==', 'image/jpeg') returning removed_at`);
    expect(r.rows[0]).toEqual({ removed_at: null });
  });
});

describe("T0c: a removed photo can't be restored", () => {
  const event = (id: number, action: string, reason: string | null = null) =>
    c.query(
      `insert into photo_visibility_events (photo_id, action, author, person_id, reason) values ($1, $2, $3::text, $3::uuid, $4)`,
      [id, action, personId, reason],
    );

  it("refuses a restore event by raw SQL, and still allows a hide", async () => {
    const id = await newPhoto();
    await event(id, "hide", "privacy");
    await remove(id);
    await expect(event(id, "restore")).rejects.toThrow(/removed for good/);
    await event(id, "hide");
  });

  it("still allows restoring a photo that isn't removed", async () => {
    const id = await newPhoto();
    await event(id, "hide");
    await event(id, "restore");
  });
});

describe("T0: the rollback's guard", () => {
  it("refuses, and drops nothing, when a photo is removed", async () => {
    const m = readMigrations(defaultMigrationsFolder()).find((f) => f.tag.startsWith("0034_"));
    expect(m?.rollback).toBeTruthy();
    const id = await newPhoto();
    await remove(id);
    await c.query("begin");
    try {
      await expect(c.query(m!.rollback!)).rejects.toThrow(/removed for good/);
    } finally {
      await c.query("rollback");
    }
    const cols = await c.query(
      `select column_name from information_schema.columns where table_name = 'photos' and column_name = 'removed_at'`,
    );
    expect(cols.rowCount).toBe(1);
  });
});
