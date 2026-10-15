import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
  rollbackLast,
} from "./runner";
import { schemaSignature, signatureDiff } from "./signature";

// The issue_reports migration (SYC-44 PR 4.1): welfare_reports made able to
// hold "Report an issue" rows (kind = 'content'). Checks the database refuses
// what the plan says it refuses, and that the rollback works and says what it
// deletes. The route-level behaviour is in the api-server tests (T4-0 to T4-8).

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `issue_reports_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
const allMigrations = readMigrations(defaultMigrationsFolder());
const mine = allMigrations.find((m) => m.tag.endsWith("_issue_reports"))!;
// Stop at this migration, so "rollback the last one" always means this one.
const migrations = allMigrations.filter((m) => m.idx <= mine.idx);

let c: pg.Client;

const freshDb = async () => {
  await c?.end().catch(() => undefined);
  await admin.query(`drop database if exists "${name}"`);
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
};

beforeAll(async () => {
  expect(mine).toBeDefined();
  await admin.connect();
});

afterAll(async () => {
  await c?.end().catch(() => undefined);
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

let n = 0;
/** Inserts one welfare_reports row; `cols` are extra columns (name -> SQL literal). */
async function insert(cols: Record<string, string>) {
  const k = ++n;
  const all: Record<string, string> = {
    public_id: `'pub-${k}'`,
    severity: `'attention'`,
    client_ref: `'ref-${k}'`,
    ...cols,
  };
  const names = Object.keys(all);
  return c.query(
    `insert into welfare_reports (${names.join(", ")}) values (${names.map((x) => all[x]).join(", ")}) returning id`,
  );
}

const welfare = (extra: Record<string, string> = {}) => ({ lat: "37.4", lng: "24.9", ...extra });
const content = (extra: Record<string, string> = {}) => ({
  kind: `'content'`,
  reason: `'other'`,
  photo_state: `'none'`,
  ...extra,
});

async function photoId(): Promise<number> {
  const k = ++n;
  const r = await c.query(`insert into photos (data, mime, public_id) values ('x', 'image/jpeg', 'ph-${k}') returning id`);
  return r.rows[0].id;
}

describe("the issue_reports migration", () => {
  it("is found, and is the newest the other tests stop at", () => {
    expect(mine).toBeDefined();
    expect(mine.rollback).not.toBeNull();
  });

  it("rollback restores the schema from before it exactly, and up/down/up works", async () => {
    await freshDb();
    await migrateUp(c, migrations, { throughIdx: mine.idx - 1 });
    const before = await schemaSignature(c, "public");
    await migrateUp(c, migrations, { throughIdx: mine.idx });
    const after = await schemaSignature(c, "public");
    expect(await rollbackLast(c, migrations)).toBe(mine.tag);
    expect(
      signatureDiff(await schemaSignature(c, "public"), before, { actual: "after rollback", expected: "before" }),
    ).toEqual([]);
    await migrateUp(c, migrations, { throughIdx: mine.idx });
    expect(
      signatureDiff(await schemaSignature(c, "public"), after, { actual: "second up", expected: "first up" }),
    ).toEqual([]);
  });

  it("the rollback starts with the capitals warning", () => {
    expect(mine.rollback!.split("\n")[0]).toMatch(/^-- DELETES EVERY "REPORT AN ISSUE" ROW FIRST/);
  });

  describe("what the database refuses", () => {
    it("keeps lat and lng required for welfare rows, optional for content rows", async () => {
      await freshDb();
      await migrateUp(c, migrations);
      await expect(insert({ lat: "null", lng: "null" })).rejects.toThrow(/welfare_reports_position_ck/);
      await expect(insert({ lat: "37.4" })).rejects.toThrow(/welfare_reports_position_ck/);
      await expect(insert(welfare({ kind: `'welfare'` }))).resolves.toBeDefined();
      await expect(insert(content())).resolves.toBeDefined();
    });

    it("a reason is one of the nine keys, and present exactly when kind is content", async () => {
      await freshDb();
      await migrateUp(c, migrations);
      for (const reason of [
        "photo_private", "photo_inappropriate", "photo_not_cat", "wrong_cat", "wrong_name",
        "wrong_info", "location_revealing", "cat_died", "other",
      ]) {
        const extra: Record<string, string> = { reason: `'${reason}'` };
        if (reason.startsWith("photo_")) extra["photo_id"] = String(await photoId());
        await expect(insert(content(extra)), reason).resolves.toBeDefined();
      }
      await expect(insert(content({ reason: `'spam'` }))).rejects.toThrow(/welfare_reports_reason_ck/);
      await expect(insert({ kind: `'content'`, photo_state: `'none'` })).rejects.toThrow(/welfare_reports_reason_kind_ck/);
      await expect(insert(welfare({ reason: `'other'` }))).rejects.toThrow(/welfare_reports_reason_kind_ck/);
    });

    it("a content row is photo_state none, attention, not litter", async () => {
      await freshDb();
      await migrateUp(c, migrations);
      await expect(insert(content({ photo_state: `'pending'` }))).rejects.toThrow(/welfare_reports_content_shape_ck/);
      await expect(insert(content({ photo_state: `'attached'` }))).rejects.toThrow(/welfare_reports_content_shape_ck/);
      await expect(insert(content({ severity: `'urgent'` }))).rejects.toThrow(/welfare_reports_content_shape_ck/);
      await expect(insert(content({ is_litter: "true" }))).rejects.toThrow(/welfare_reports_content_shape_ck/);
      // A welfare row is unaffected: pending, urgent and litter are all fine.
      await expect(insert(welfare({ photo_state: `'pending'`, severity: `'urgent'`, is_litter: "true" }))).resolves.toBeDefined();
    });

    it("the three photo reasons carry a photo; wrong_cat may or may not", async () => {
      await freshDb();
      await migrateUp(c, migrations);
      for (const reason of ["photo_private", "photo_inappropriate", "photo_not_cat"]) {
        await expect(insert(content({ reason: `'${reason}'` })), reason).rejects.toThrow(/welfare_reports_photo_reason_photo_ck/);
        await expect(insert(content({ reason: `'${reason}'`, photo_id: String(await photoId()) })), reason).resolves.toBeDefined();
      }
      await expect(insert(content({ reason: `'wrong_cat'` }))).resolves.toBeDefined();
      await expect(insert(content({ reason: `'wrong_cat'`, photo_id: String(await photoId()) }))).resolves.toBeDefined();
    });

    it("photo_id must name a real photo", async () => {
      await freshDb();
      await migrateUp(c, migrations);
      await expect(insert(content({ reason: `'wrong_cat'`, photo_id: "999999" }))).rejects.toThrow(/welfare_reports_photo_id_photos_id_fk/);
    });

    it("hide_skipped is null or one of the five reasons; hidden_by_report defaults to false", async () => {
      await freshDb();
      await migrateUp(c, migrations);
      for (const v of ["already_hidden", "restored_before", "address_limit", "brake", "unchecked"]) {
        await expect(insert(content({ hide_skipped: `'${v}'` })), v).resolves.toBeDefined();
      }
      await expect(insert(content({ hide_skipped: `'nope'` }))).rejects.toThrow(/welfare_reports_hide_skipped_ck/);
      const r = await insert(welfare());
      const row = await c.query(`select hidden_by_report, hide_skipped, note_cleared_at from welfare_reports where id = $1`, [r.rows[0].id]);
      expect(row.rows[0]).toEqual({ hidden_by_report: false, hide_skipped: null, note_cleared_at: null });
    });
  });

  describe("the resend key (0023 adds the kind-aware key; the drop migration removes the old one)", () => {
    const drop = allMigrations.find((m) => m.tag.endsWith("_drop_old_resend_key"))!;
    // Stop at the drop migration, so "rollback the last one" means that one.
    const throughDrop = allMigrations.filter((m) => m.idx <= drop.idx);
    const resendIndexes = async () =>
      (
        await c.query(
          `select indexname from pg_indexes where tablename = 'welfare_reports' and indexname like 'welfare_reports_device%' order by 1`,
        )
      ).rows.map((r) => r.indexname);

    it("the drop migration is found, comes after the issue_reports one, and has a rollback", () => {
      expect(drop).toBeDefined();
      expect(drop.idx).toBeGreaterThan(mine.idx);
      expect(drop.rollback).not.toBeNull();
    });

    it("after 0023 the new key sits beside the old one; after the drop only the new one is left", async () => {
      await freshDb();
      await migrateUp(c, migrations);
      expect(await resendIndexes()).toEqual([
        "welfare_reports_device_client_ref_key",
        "welfare_reports_device_kind_client_ref_key",
      ]);
      await migrateUp(c, throughDrop);
      expect(await resendIndexes()).toEqual(["welfare_reports_device_kind_client_ref_key"]);
    });

    it("the two kinds are two reports, and the key still refuses a repeat of one kind", async () => {
      await freshDb();
      await migrateUp(c, throughDrop);
      await insert(welfare({ reporter_device: `'d1'`, client_ref: `'same'` }));
      await expect(insert(content({ reporter_device: `'d1'`, client_ref: `'same'` }))).resolves.toBeDefined();
      await expect(insert(welfare({ reporter_device: `'d1'`, client_ref: `'same'` }))).rejects.toThrow(
        /welfare_reports_device_kind_client_ref_key/,
      );
      await expect(insert(content({ reporter_device: `'d1'`, client_ref: `'same'` }))).rejects.toThrow(
        /welfare_reports_device_kind_client_ref_key/,
      );
    });

    it("the rollback starts with the capitals warning", () => {
      expect(drop.rollback!.split("\n")[0]).toMatch(/^-- DELETES EVERY "REPORT AN ISSUE" ROW FIRST/);
    });

    it("rollback deletes the content rows, keeps the welfare ones, and puts the old key back; up/down/up works", async () => {
      await freshDb();
      await migrateUp(c, throughDrop, { throughIdx: drop.idx - 1 });
      const before = await schemaSignature(c, "public");
      await migrateUp(c, throughDrop, { throughIdx: drop.idx });
      const after = await schemaSignature(c, "public");
      const w = await insert(welfare({ reporter_device: `'d1'`, client_ref: `'same'` }));
      await insert(content({ reporter_device: `'d1'`, client_ref: `'same'` }));
      expect(await rollbackLast(c, throughDrop)).toBe(drop.tag);
      expect((await c.query(`select id from welfare_reports`)).rows.map((r) => r.id)).toEqual([w.rows[0].id]);
      expect(
        signatureDiff(await schemaSignature(c, "public"), before, { actual: "after rollback", expected: "before" }),
      ).toEqual([]);
      // The old key is back and refuses a content row sharing the welfare row's device and reference.
      await expect(insert(content({ reporter_device: `'d1'`, client_ref: `'same'` }))).rejects.toThrow(
        /welfare_reports_device_client_ref_key/,
      );
      await migrateUp(c, throughDrop, { throughIdx: drop.idx });
      expect(
        signatureDiff(await schemaSignature(c, "public"), after, { actual: "second up", expected: "first up" }),
      ).toEqual([]);
    });
  });

  it("the new indexes and the digest guard table exist", async () => {
    await freshDb();
    await migrateUp(c, migrations);
    const idx = await c.query(
      `select indexname from pg_indexes where tablename = 'welfare_reports' and indexname in ('welfare_reports_kind_state_created_idx', 'welfare_reports_photo_id_idx') order by 1`,
    );
    expect(idx.rows).toHaveLength(2);
    await c.query(`insert into issue_digest_runs (day, sent_at) values ('2026-10-15', now())`);
    await expect(c.query(`insert into issue_digest_runs (day) values ('2026-10-15')`)).rejects.toThrow(/issue_digest_runs_pkey/);
  });

  it("rollback deletes every content row, keeps the welfare rows, and puts not-null back on lat and lng", async () => {
    await freshDb();
    await migrateUp(c, migrations);
    const w = await insert(welfare());
    const k = await insert(content());
    await c.query(
      `insert into mail_outbox (purpose, report_id, recipient_hash, payload) values ('issue_alert', $1, 'h', '{}')`,
      [k.rows[0].id],
    );
    expect(await rollbackLast(c, migrations)).toBe(mine.tag);
    const left = await c.query(`select id from welfare_reports`);
    expect(left.rows.map((r) => r.id)).toEqual([w.rows[0].id]);
    const nullable = await c.query(
      `select column_name, is_nullable from information_schema.columns where table_name = 'welfare_reports' and column_name in ('lat', 'lng') order by 1`,
    );
    expect(nullable.rows.map((r) => r.is_nullable)).toEqual(["NO", "NO"]);
    // The content row's queued email lost its report (set null), nothing else changed.
    const mail = await c.query(`select report_id from mail_outbox`);
    expect(mail.rows).toEqual([{ report_id: null }]);
  });
});
