import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
  rollbackLast,
} from "./runner";

// SYC-63's migration (plan syc-63-self-service-deletion.md §5): deletion
// clears sightings.device_id and cats.discoverer_device_id, so both may be
// null, but only on a redacted row; and sightings become append-only, with a
// status move and redaction the only updates.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `deletion_test_${crypto.randomBytes(4).toString("hex")}`;
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
  // As dataSpine.test.ts: the table owner switches the TRUNCATE guard off to
  // reset, inside one transaction so it is never off for anyone else.
  await c.query("begin");
  await c.query(`alter table sightings disable trigger sightings_no_truncate`);
  await c.query(`truncate sightings, cats restart identity cascade`);
  await c.query(`alter table sightings enable trigger sightings_no_truncate`);
  await c.query("commit");
});

async function sighting(
  fields: Partial<{ status: string; cat_id: number | null }> = {},
): Promise<number> {
  const r = await c.query<{ id: number }>(
    `insert into sightings (device_id, photo_id, lat, lng, status, cat_id)
     values ('dev-a', 1, 37.44, 24.94, $1, $2) returning id`,
    [fields.status ?? "pending", fields.cat_id ?? null],
  );
  return r.rows[0]!.id;
}

async function row(id: number) {
  const r = await c.query(`select * from sightings where id = $1`, [id]);
  return r.rows[0];
}

const REDACT = `update sightings set device_id = null, redacted_at = now(),
  redaction_reason = 'deleted by the person' where id = $1`;

describe("sightings: attribution", () => {
  it("refuses a sighting with no spotter", async () => {
    await expect(
      c.query(
        `insert into sightings (device_id, photo_id, lat, lng) values (null, 1, 0, 0)`,
      ),
    ).rejects.toThrow(/sightings_attribution_ck/);
  });

  it("refuses a sighting that arrives already redacted", async () => {
    await expect(
      c.query(
        `insert into sightings (device_id, photo_id, lat, lng, redacted_at, redaction_reason)
         values ('dev-a', 1, 0, 0, now(), 'x')`,
      ),
    ).rejects.toThrow(/cannot arrive already redacted/);
  });
});

describe("sightings: append-only, with status moves and redaction", () => {
  it("refuses delete", async () => {
    const id = await sighting();
    await expect(
      c.query(`delete from sightings where id = $1`, [id]),
    ).rejects.toThrow(/delete is not allowed/);
  });

  it("refuses TRUNCATE", async () => {
    await sighting();
    await expect(c.query(`truncate sightings cascade`)).rejects.toThrow(
      /TRUNCATE is not allowed/,
    );
  });

  it("allows the app's resolve: pending -> resolved, the cat set once", async () => {
    const id = await sighting();
    await c.query(
      `update sightings set cat_id = 7, status = 'resolved' where id = $1`,
      [id],
    );
    expect(await row(id)).toMatchObject({ cat_id: 7, status: "resolved" });
  });

  it("allows pending -> awaiting_team -> resolved (SYC-119)", async () => {
    const id = await sighting();
    await c.query(
      `update sightings set status = 'awaiting_team' where id = $1`,
      [id],
    );
    await c.query(
      `update sightings set cat_id = 3, status = 'resolved' where id = $1`,
      [id],
    );
    expect(await row(id)).toMatchObject({ cat_id: 3, status: "resolved" });
  });

  it("refuses moving a resolved sighting to another cat, or back to pending", async () => {
    const id = await sighting();
    await c.query(
      `update sightings set cat_id = 7, status = 'resolved' where id = $1`,
      [id],
    );
    await expect(
      c.query(`update sightings set cat_id = 8 where id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      c.query(
        `update sightings set status = 'pending', cat_id = null where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses a resolve that changes anything else", async () => {
    const id = await sighting();
    await expect(
      c.query(
        `update sightings set cat_id = 7, status = 'resolved', lat = 0 where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      c.query(`update sightings set status = 'resolved' where id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses awaiting_team with a cat, or an unknown status", async () => {
    const id = await sighting();
    await expect(
      c.query(
        `update sightings set status = 'awaiting_team', cat_id = 4 where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      c.query(`update sightings set status = 'hidden' where id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses any other update, and a no-op", async () => {
    const id = await sighting();
    await expect(
      c.query(`update sightings set lat = 1 where id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      c.query(`update sightings set device_id = 'dev-b' where id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      c.query(`update sightings set status = status where id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
  });

  it("allows redaction: author cleared, stamped, reasoned, everything else kept", async () => {
    const id = await sighting({ status: "resolved", cat_id: 5 });
    const before = await row(id);
    await c.query(REDACT, [id]);
    const after = await row(id);
    expect(after.device_id).toBeNull();
    expect(after.redacted_at).not.toBeNull();
    expect(after.redaction_reason).toBe("deleted by the person");
    expect({
      ...after,
      device_id: 0,
      redacted_at: 0,
      redaction_reason: 0,
    }).toEqual({
      ...before,
      device_id: 0,
      redacted_at: 0,
      redaction_reason: 0,
    });
  });

  it("refuses a redaction that keeps the author, has no reason, or changes another column", async () => {
    const id = await sighting();
    await expect(
      c.query(
        `update sightings set redacted_at = now(), redaction_reason = 'x' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      c.query(
        `update sightings set device_id = null, redacted_at = now() where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      c.query(
        `update sightings set device_id = null, redacted_at = now(), redaction_reason = '' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      c.query(
        `update sightings set device_id = null, redacted_at = now(), redaction_reason = 'x', lat = 0 where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("lets redaction re-run without restamping, and refuses a restamp", async () => {
    const id = await sighting();
    await c.query(REDACT, [id]);
    await c.query(
      `update sightings set device_id = null, redacted_at = redacted_at,
       redaction_reason = redaction_reason where id = $1`,
      [id],
    );
    await expect(
      c.query(
        `update sightings set redacted_at = now() + interval '1 day' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      c.query(`update sightings set device_id = 'dev-a' where id = $1`, [id]),
    ).rejects.toThrow(/append-only|sightings_attribution_ck/);
  });

  it("still lets the team resolve a redacted sighting that was waiting for them", async () => {
    const id = await sighting();
    await c.query(
      `update sightings set status = 'awaiting_team' where id = $1`,
      [id],
    );
    await c.query(REDACT, [id]);
    await c.query(
      `update sightings set cat_id = 9, status = 'resolved' where id = $1`,
      [id],
    );
    expect(await row(id)).toMatchObject({
      cat_id: 9,
      status: "resolved",
      device_id: null,
    });
  });
});

describe("cats: an unlinked discoverer", () => {
  const insertCat = (device: string | null, redacted = false) =>
    c.query(
      `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id, redacted_at, redaction_reason)
       values ($1, 1, 0, 0, $2, $3, $4) returning id`,
      [
        `cat-${crypto.randomBytes(3).toString("hex")}`,
        device,
        redacted ? new Date() : null,
        redacted ? "deleted by the person" : null,
      ],
    );

  it("refuses a null discoverer on an unstamped cat", async () => {
    await expect(insertCat(null)).rejects.toThrow(/cats_discoverer_ck/);
  });

  it("allows clearing the discoverer when the cat is stamped", async () => {
    const r = await insertCat("dev-a");
    const id = r.rows[0].id;
    await c.query(
      `update cats set discoverer_device_id = null, redacted_at = now(),
       redaction_reason = 'deleted by the person' where id = $1`,
      [id],
    );
    await expect(insertCat(null, true)).resolves.toBeTruthy();
  });

  it("uses the device index for a person's sightings", async () => {
    const r = await c.query(
      `select indexdef from pg_indexes where indexname = 'sightings_device_idx'`,
    );
    expect(r.rows[0]?.indexdef).toMatch(/WHERE \(device_id IS NOT NULL\)/);
  });
});

describe("rollback", () => {
  it("refuses once anybody has been deleted, and leaves the schema alone", async () => {
    const id = await sighting();
    await c.query(REDACT, [id]);
    await expect(
      rollbackLast(c, readMigrations(defaultMigrationsFolder())),
    ).rejects.toThrow(/somebody has been deleted/);
    const nullable = await c.query(
      `select is_nullable from information_schema.columns
       where table_name = 'sightings' and column_name = 'device_id'`,
    );
    expect(nullable.rows[0].is_nullable).toBe("YES");
  });
});
