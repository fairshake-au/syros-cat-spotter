import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
} from "./runner";

// SYC-43 part 2 plan, PR 6 (Decision 3): migration 0014, the add-only
// hide/restore log for photos. The database's own half of P6-9: whatever the
// app does, an event can't be changed or removed, and its author is either a
// linked team member or a public report (SYC-44's `report:<id>`).

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `photo_visibility_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
let photoId: number;
let personId: string;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, readMigrations(defaultMigrationsFolder()));
  photoId = (
    await c.query<{ id: number }>(`insert into photos (data) values ('eA==') returning id`)
  ).rows[0]!.id;
  personId = (
    await c.query<{ id: string }>(
      `insert into people (email, name, added_by) values ('susan@example.com', 'Susan', 'cli:test') returning id`,
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  await c.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

const hide = (author: string, person: string | null, action = "hide") =>
  c.query<{ id: number }>(
    `insert into photo_visibility_events (photo_id, action, author, person_id)
     values ($1, $2, $3, $4) returning id`,
    [photoId, action, author, person],
  );

describe("photo_visibility_events (migration 0014)", () => {
  it("takes a team member's hide and restore, and a public report's hide", async () => {
    await hide(personId, personId);
    await hide(personId, personId, "restore");
    await hide("report:9f3c2a71", null);
    const n = await c.query(`select count(*)::int as n from photo_visibility_events`);
    expect(n.rows[0].n).toBe(3);
  });

  it("refuses any action but hide or restore", async () => {
    await expect(hide(personId, personId, "delete")).rejects.toThrow(/photo_visibility_events_action_ck/);
  });

  it("refuses an author that is neither the linked person nor report:<id>", async () => {
    await expect(hide("someone", null)).rejects.toThrow(/photo_visibility_events_author_ck/);
    await expect(hide("report:", null)).rejects.toThrow(/photo_visibility_events_author_ck/);
    await expect(hide("report:1", personId)).rejects.toThrow(/photo_visibility_events_author_ck/);
    await expect(hide(personId, null)).rejects.toThrow(/photo_visibility_events_author_ck/);
  });

  it("refuses a photo or a person that doesn't exist", async () => {
    await expect(
      c.query(
        `insert into photo_visibility_events (photo_id, action, author) values (2147483000, 'hide', 'report:1')`,
      ),
    ).rejects.toThrow(/photo_visibility_events_photo_id_photos_id_fk/);
    const ghost = "00000000-0000-4000-8000-000000000000";
    await expect(hide(ghost, ghost)).rejects.toThrow(/photo_visibility_events_person_id_people_id_fk/);
  });

  it("is append-only: update, delete and TRUNCATE are refused (P6-9's backstop)", async () => {
    const { rows } = await hide(personId, personId);
    const id = rows[0]!.id;
    await expect(
      c.query(`update photo_visibility_events set action = 'restore' where id = $1`, [id]),
    ).rejects.toThrow(/append-only: UPDATE is not allowed/);
    await expect(
      c.query(`delete from photo_visibility_events where id = $1`, [id]),
    ).rejects.toThrow(/append-only: DELETE is not allowed/);
    await expect(c.query(`truncate photo_visibility_events`)).rejects.toThrow(
      /append-only: TRUNCATE is not allowed/,
    );
  });

  it("a person who has history here can't be hard-deleted (Decision 7's strict link)", async () => {
    await expect(c.query(`delete from people where id = $1`, [personId])).rejects.toThrow(
      /photo_visibility_events_person_id_people_id_fk/,
    );
  });
});

// The rollback's up/down/up is proved for every migration, 0014 included, by
// runner.test.ts ("builds on an empty database and passes the up/down/up cycle").
