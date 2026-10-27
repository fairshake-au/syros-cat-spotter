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
  // The guards refuse TRUNCATE. The table owner can switch that one trigger
  // off, so tests reset that way; it needs no superuser. (The same owner
  // could disable any guard: they protect against mistakes and app code, not
  // against the database owner.)
  await c.query(
    `alter table observations disable trigger observations_no_truncate`,
  );
  await c.query(
    `alter table cat_identity disable trigger cat_identity_no_truncate`,
  );
  await c.query(
    `alter table colony_name_history disable trigger colony_name_history_no_truncate`,
  );
  await c.query(
    `alter table feeding_site_old_codes disable trigger feeding_site_old_codes_no_truncate`,
  );
  await c.query(`alter table feeding_sites disable trigger feeding_sites_no_truncate`);
  await c.query(`alter table colonies disable trigger colonies_no_truncate`);
  try {
    await c.query(
      `truncate observations, cat_identity, colony_name_history, colonies, feeding_sites restart identity cascade`,
    );
  } finally {
    await c.query(
      `alter table observations enable trigger observations_no_truncate`,
    );
    await c.query(
      `alter table cat_identity enable trigger cat_identity_no_truncate`,
    );
    await c.query(
      `alter table colony_name_history enable trigger colony_name_history_no_truncate`,
    );
    await c.query(
      `alter table feeding_site_old_codes enable trigger feeding_site_old_codes_no_truncate`,
    );
    await c.query(`alter table feeding_sites enable trigger feeding_sites_no_truncate`);
    await c.query(`alter table colonies enable trigger colonies_no_truncate`);
  }
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

  it("refuses restamping a row already redacted", async () => {
    const id = await observe();
    await redact(id);
    await expect(redact(id)).rejects.toThrow(
      /only permitted update is redaction/,
    );
  });

  it("lets deletion run again on a redacted row, and still empty a note it missed", async () => {
    const note = await observe({
      kind: "note",
      value: { text: "by the bakery" },
    });
    await redact(note);
    // A no-op rewrite of the same values is fine (deletion is re-runnable).
    await c.query(`update observations set value = value where id = $1`, [
      note,
    ]);
    await c.query(`update observations set value = '{}'::jsonb where id = $1`, [
      note,
    ]);
    const r = await c.query(`select value from observations where id = $1`, [
      note,
    ]);
    expect(r.rows[0].value).toEqual({});
    await expect(
      c.query(
        `update observations set redaction_reason = 'changed' where id = $1`,
        [note],
      ),
    ).rejects.toThrow(/only permitted update is redaction/);
  });

  it("refuses an empty redaction reason", async () => {
    const id = await observe();
    await expect(
      c.query(
        `update observations set redacted_at = now(), redaction_reason = '', device_id = null where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/only permitted update is redaction/);
  });

  it("refuses a redaction that rewrites a value's representation", async () => {
    const id = await observe({ value: { n: 1 } });
    await expect(redact(id, `, value = '{"n": 1.0}'::jsonb`)).rejects.toThrow(
      /only permitted update is redaction/,
    );
  });

  it("refuses a row that arrives already redacted", async () => {
    await expect(
      c.query(
        `insert into observations (cat_id, kind, value, observed_at, redacted_at, redaction_reason)
         values (1, 'sterilised', '{"sterilised": true}', now(), now(), 'x')`,
      ),
    ).rejects.toThrow(/cannot arrive already redacted/);
  });

  it("refuses TRUNCATE", async () => {
    await observe();
    await expect(c.query(`truncate observations`)).rejects.toThrow(
      /observations is append-only: TRUNCATE is not allowed/,
    );
    await expect(c.query(`truncate cat_identity`)).rejects.toThrow(
      /cat_identity is append-only: TRUNCATE is not allowed/,
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
    // Since 0053 the guard allows one update, redaction (SYC-150), so its
    // words changed from "append-only".
    await expect(
      c.query(`update cat_identity set canonical_cat_id = 3 where id = $1`, [
        id,
      ]),
    ).rejects.toThrow(/cat_identity is add-only: the only permitted update is redaction/);
    await expect(
      c.query(`delete from cat_identity where id = $1`, [id]),
    ).rejects.toThrow(/cat_identity is add-only: delete is not allowed/);
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

// §10.3 asked for what cats_name_lower_unique did with Greek names under this
// database's collation. It folded case letter for letter and nothing else:
// ΜΙΜΗ beside Μιμή, ΣΟΦΊΑΣ beside Σοφίας and the NFD spelling of any name were
// all accepted as separate cats, so records-import.md §2.4's "unique by
// construction" was false. SYC-101 (DECISIONS.md Part 2g) replaced it with
// cats_normalised_name_unique on a generated, foldName-folded column. These
// tests pin the new behaviour; foldSql.test.ts proves the column folds
// exactly as foldName does.
describe("cats_normalised_name_unique (SYC-101)", () => {
  beforeEach(async () => {
    await c.query(`truncate cats restart identity cascade`);
  });
  const addCat = (n: string) =>
    c.query(
      `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id) values ($1, 0, 37.44, 24.94, 'd')`,
      [n],
    );
  const clash = /cats_normalised_name_unique/;

  it("drops the old lower(name) index", async () => {
    const r = await c.query(
      `select 1 from pg_indexes where indexname = 'cats_name_lower_unique'`,
    );
    expect(r.rowCount).toBe(0);
  });

  it("folds accents: unaccented capitals are the same name", async () => {
    await addCat("Μιμή".normalize("NFC"));
    await expect(addCat("ΜΙΜΗ")).rejects.toThrow(clash);
  });

  it("folds final sigma", async () => {
    await addCat("Σοφίας".normalize("NFC"));
    await expect(addCat("ΣΟΦΊΑΣ".normalize("NFC"))).rejects.toThrow(clash);
  });

  it("normalises: NFC and NFD spellings are the same name", async () => {
    await addCat("Μιμή".normalize("NFC"));
    await expect(addCat("Μιμή".normalize("NFD"))).rejects.toThrow(clash);
  });

  it("folds Latin accents: Zoë and Zoe are the same name", async () => {
    await addCat("Zoë");
    await expect(addCat("zoe")).rejects.toThrow(clash);
  });

  it("keeps the name as typed and refreshes the folded form on a rename", async () => {
    await addCat("ΣΟΦΊΑΣ");
    let r = await c.query(`select name, normalised_name from cats`);
    expect(r.rows[0]).toEqual({ name: "ΣΟΦΊΑΣ", normalised_name: "σοφιασ" });
    await c.query(`update cats set name = 'Zoë'`);
    r = await c.query(`select name, normalised_name from cats`);
    expect(r.rows[0]).toEqual({ name: "Zoë", normalised_name: "zoe" });
  });

  it("refuses a writer that sets the folded form itself", async () => {
    await expect(
      c.query(
        `insert into cats (name, normalised_name, primary_photo_id, lat, lng, discoverer_device_id) values ('Mimi', 'other', 0, 37.44, 24.94, 'd')`,
      ),
    ).rejects.toThrow(/non-DEFAULT value into column "normalised_name"/);
  });

  it("does not fold Greek/Latin look-alike letters (Part 2m)", async () => {
    await addCat("ΑΓΑΘΗ");
    await expect(addCat("AΓAΘH")).resolves.toBeDefined();
  });
});
