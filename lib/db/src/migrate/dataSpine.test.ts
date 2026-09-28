import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "./runner";

// The data spine's tables as the migration builds them (cat-record-data-spine
// .md §10.1, §10.3, §10.5, §8.5), on a throwaway database.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `spine_test_${crypto.randomBytes(4).toString("hex")}`;
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
  // TRUNCATE is not a row-level UPDATE or DELETE, so the guards allow it.
  await c.query(
    `truncate observations, cat_identity, colony_name_history, colonies, feeding_sites restart identity cascade`,
  );
});

async function observe(
  fields: Partial<{
    kind: string;
    value: unknown;
    device_id: string | null;
    account_id: string | null;
  }> = {},
): Promise<number> {
  const r = await c.query<{ id: number }>(
    `insert into observations (cat_id, kind, value, device_id, account_id, observed_at)
     values (1, $1, $2, $3, $4, now()) returning id`,
    [
      fields.kind ?? "ear_tip",
      JSON.stringify(fields.value ?? { clipped: true, side: "left" }),
      fields.device_id === undefined ? "device-a" : fields.device_id,
      fields.account_id ?? null,
    ],
  );
  return r.rows[0]!.id;
}

const redact = (id: number, extra = "") =>
  c.query(
    `update observations
        set redacted_at = now(), redaction_reason = 'deletion request',
            device_id = null, account_id = null ${extra}
      where id = $1`,
    [id],
  );

describe("observations: attribution", () => {
  it("takes exactly one of device or account", async () => {
    await observe();
    await observe({ device_id: null, account_id: "acct-1" });
    await expect(observe({ device_id: null })).rejects.toThrow(
      /observations_attribution_ck/,
    );
    await expect(observe({ account_id: "acct-1" })).rejects.toThrow(
      /observations_attribution_ck/,
    );
  });

  it("defaults role, scope and provenance to a volunteered public statement", async () => {
    const id = await observe();
    const r = await c.query(
      `select role_at_time, authority_scope, provenance from observations where id = $1`,
      [id],
    );
    expect(r.rows[0]).toEqual({
      role_at_time: "public",
      authority_scope: "none",
      provenance: "volunteered",
    });
  });
});

describe("observations: append-only, with redaction the one exception", () => {
  it("refuses delete", async () => {
    const id = await observe();
    await expect(
      c.query(`delete from observations where id = $1`, [id]),
    ).rejects.toThrow(/append-only: delete is not allowed/);
  });

  it("refuses an ordinary update", async () => {
    const id = await observe();
    await expect(
      c.query(`update observations set kind = 'sterilised' where id = $1`, [
        id,
      ]),
    ).rejects.toThrow(/only permitted update is redaction/);
  });

  it("allows redaction: stamped, reasoned, author cleared, everything else kept", async () => {
    const id = await observe();
    await redact(id);
    const r = await c.query(`select * from observations where id = $1`, [id]);
    expect(r.rows[0]).toMatchObject({
      device_id: null,
      account_id: null,
      kind: "ear_tip",
      value: { clipped: true, side: "left" },
      redaction_reason: "deletion request",
    });
    expect(r.rows[0].redacted_at).toBeInstanceOf(Date);
  });

  it("refuses a redaction that keeps the author, or has no reason", async () => {
    const id = await observe();
    await expect(
      c.query(
        `update observations set redacted_at = now(), redaction_reason = 'x' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/only permitted update is redaction/);
    await expect(
      c.query(
        `update observations set redacted_at = now(), device_id = null where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/only permitted update is redaction/);
  });

  it("refuses a redaction that also changes another column", async () => {
    const id = await observe();
    await expect(
      redact(id, `, observed_at = now() - interval '1 day'`),
    ).rejects.toThrow(/only permitted update is redaction/);
  });

  it("empties a note's text on redaction, and only a note's", async () => {
    const note = await observe({
      kind: "note",
      value: { text: "outside Maria's door" },
    });
    await redact(note, `, value = '{}'::jsonb`);
    const r = await c.query(`select value from observations where id = $1`, [
      note,
    ]);
    expect(r.rows[0].value).toEqual({});

    const tip = await observe();
    await expect(redact(tip, `, value = '{}'::jsonb`)).rejects.toThrow(
      /only permitted update is redaction/,
    );
  });

  it("refuses any change to a row already redacted", async () => {
    const id = await observe();
    await redact(id);
    await expect(redact(id)).rejects.toThrow(
      /only permitted update is redaction/,
    );
  });
});

describe("cat_identity: a merge is a row and an unmerge is another row", () => {
  it("refuses update and delete", async () => {
    const r = await c.query<{ id: number }>(
      `insert into cat_identity (cat_id, canonical_cat_id, reason) values (2, 1, 'same cat') returning id`,
    );
    const id = r.rows[0]!.id;
    await c.query(
      `insert into cat_identity (cat_id, canonical_cat_id, reason, supersedes_id) values (2, 2, 'unmerge', $1)`,
      [id],
    );
    await expect(
      c.query(`update cat_identity set canonical_cat_id = 3 where id = $1`, [
        id,
      ]),
    ).rejects.toThrow(/cat_identity is append-only: UPDATE/);
    await expect(
      c.query(`delete from cat_identity where id = $1`, [id]),
    ).rejects.toThrow(/cat_identity is append-only: DELETE/);
  });
});

describe("colonies and feeding sites", () => {
  it("keeps colony names unique by normalised form and history tied to a real colony", async () => {
    await c.query(
      `insert into colonies (name, normalised_name, guardian_name) values ('Vaporia — Eleni''s', 'vaporia — eleni''s', 'Eleni')`,
    );
    await expect(
      c.query(
        `insert into colonies (name, normalised_name) values ('VAPORIA — Eleni''s', 'vaporia — eleni''s')`,
      ),
    ).rejects.toThrow(/colonies_normalised_name_unique/);
    await expect(
      c.query(
        `insert into colony_name_history (colony_id, name, normalised_name) values (999, 'x', 'x')`,
      ),
    ).rejects.toThrow(/colony_name_history_colony_id_colonies_id_fk/);
  });

  it("makes a feeding site private unless someone says otherwise", async () => {
    const r = await c.query(
      `insert into feeding_sites (name, lat, lng) values ('Vaporia — Eleni''s', 37.44, 24.94) returning is_public, made_public_by`,
    );
    expect(r.rows[0]).toEqual({ is_public: false, made_public_by: null });
  });
});

// §10.3 asks for what cats_name_lower_unique actually does with Greek names
// under this database's collation to be written down. The answer:
//  - Case folds, under a UTF-8 ctype (C.UTF-8 locally, en_US.utf8 in CI's
//    postgres image): ΜΙΜΉ collides with Μιμή.
//  - Unicode normalisation does NOT happen: the NFD spelling of Μιμή is a
//    different string and is accepted as a second cat. Uniqueness therefore
//    holds only if every writer normalises to NFC first, as §10.3 requires.
describe("cats_name_lower_unique with Greek names", () => {
  beforeEach(async () => {
    await c.query(`truncate cats restart identity`);
  });
  const addCat = (n: string) =>
    c.query(
      `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id) values ($1, 0, 37.44, 24.94, 'd')`,
      [n],
    );

  it("folds case under this database's ctype", async () => {
    const ctype = await c.query<{ datctype: string }>(
      `select datctype from pg_database where datname = current_database()`,
    );
    expect(ctype.rows[0]!.datctype).toMatch(/utf-?8/i);
    await addCat("Μιμή".normalize("NFC"));
    await expect(addCat("ΜΙΜΉ".normalize("NFC"))).rejects.toThrow(
      /cats_name_lower_unique/,
    );
  });

  it("does not normalise: NFC and NFD spellings are two different names", async () => {
    await addCat("Μιμή".normalize("NFC"));
    await expect(addCat("Μιμή".normalize("NFD"))).resolves.toBeDefined();
  });
});
