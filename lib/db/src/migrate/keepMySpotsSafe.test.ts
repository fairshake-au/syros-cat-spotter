import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "./runner";

// SYC-3 Slice 1 step 1: the database's own guarantees for the shared
// "is this you?" tables (plan test 16b, and the append-only consent record
// of email-capture.md §5.6). The migration is found by its suffix, never its
// number, because it's regenerated on a rebase before merge.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `keep_safe_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  const migrations = readMigrations(defaultMigrationsFolder());
  expect(migrations.some((m) => m.tag.endsWith("_keep_my_spots_safe"))).toBe(true);
  await migrateUp(c, migrations);
});

afterAll(async () => {
  await c.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

const insertContact = (purpose: string, address: string | null, deviceId: string | null) =>
  c.query(
    `insert into email_contacts (purpose, address, address_hmac, address_mask, device_id)
     values ($1, $2, 'h', 'a•••@example.com', $3) returning id`,
    [purpose, address, deviceId],
  );

describe("email_contacts", () => {
  it("refuses a keep-safe row that holds an address (Decision 4)", async () => {
    await expect(insertContact("keep_safe", "a@example.com", "dev-a")).rejects.toThrow(
      /email_contacts_keep_safe_no_address_ck/,
    );
    await expect(
      c.query(`update email_contacts set address = 'a@example.com' where purpose = 'keep_safe'`),
    ).resolves.toBeDefined();
    const { rows } = await insertContact("keep_safe", null, "dev-a1");
    await expect(
      c.query(`update email_contacts set address = 'a@example.com' where id = $1`, [rows[0].id]),
    ).rejects.toThrow(/email_contacts_keep_safe_no_address_ck/);
  });

  it("lets report and news rows hold the address", async () => {
    await expect(insertContact("report", "r@example.com", null)).resolves.toBeDefined();
    await expect(insertContact("news", "n@example.com", "dev-n")).resolves.toBeDefined();
  });

  it("allows one keep-safe row per spotter, and lets siblings share a fingerprint", async () => {
    await insertContact("keep_safe", null, "dev-b");
    await expect(insertContact("keep_safe", null, "dev-b")).rejects.toThrow(
      /email_contacts_keep_safe_device_unique/,
    );
    await expect(insertContact("keep_safe", null, "dev-b-sibling")).resolves.toBeDefined();
  });

  it("refuses an unknown purpose", async () => {
    await expect(insertContact("restore", null, "dev-c")).rejects.toThrow(/email_contacts_purpose_ck/);
  });
});

describe("email_consent_events is append-only", () => {
  const insertEvent = async () =>
    (
      await c.query(
        `insert into email_consent_events (contact_id, device_id, address_hmac, purpose, event, surface, wording_version, language)
         values (1, 'dev-x', 'hx', 'keep_safe', 'consented', 'onboarding', 'keep_safe.v1', 'en') returning id`,
      )
    ).rows[0].id as number;

  it("refuses a delete, a truncate and an ordinary edit", async () => {
    const id = await insertEvent();
    await expect(c.query(`delete from email_consent_events where id = $1`, [id])).rejects.toThrow(/append-only/);
    await expect(c.query(`truncate email_consent_events`)).rejects.toThrow(/append-only/);
    await expect(
      c.query(`update email_consent_events set event = 'verified' where id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
  });

  it("allows redaction of who it was about, and nothing else", async () => {
    const id = await insertEvent();
    await expect(
      c.query(
        `update email_consent_events set device_id = null, contact_id = null, address_hmac = null,
           redacted_at = now(), redaction_reason = 'deleted' where id = $1`,
        [id],
      ),
    ).resolves.toBeDefined();
    const { rows } = await c.query(`select * from email_consent_events where id = $1`, [id]);
    expect(rows[0]).toMatchObject({ device_id: null, address_hmac: null, purpose: "keep_safe", wording_version: "keep_safe.v1" });

    const id2 = await insertEvent();
    // Redaction must clear the spotter; it can't be a cover for an edit.
    await expect(
      c.query(`update email_consent_events set redacted_at = now(), redaction_reason = 'x' where id = $1`, [id2]),
    ).rejects.toThrow(/append-only/);
    await expect(
      c.query(
        `update email_consent_events set device_id = null, contact_id = null, redacted_at = now(),
           redaction_reason = 'x', language = 'fr' where id = $1`,
        [id2],
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses a row that arrives already redacted", async () => {
    await expect(
      c.query(
        `insert into email_consent_events (purpose, event, redacted_at, redaction_reason)
         values ('keep_safe', 'consented', now(), 'x')`,
      ),
    ).rejects.toThrow(/already redacted/);
  });
});

describe("welfare_reports.reporter_contact_id", () => {
  it("now points at email_contacts", async () => {
    const { rows } = await c.query(
      `select confrelid::regclass::text as target from pg_constraint
        where conname = 'welfare_reports_reporter_contact_id_email_contacts_id_fk'`,
    );
    expect(rows[0]?.target).toBe("email_contacts");
  });
});
