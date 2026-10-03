import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
  rollbackLast,
} from "./runner";

// Data spine PR 3 (cat-record-data-spine.md §11.2 steps 3-4;
// docs/superpowers/plans/data-spine.md, PR 3): the backfill migration
// (0006_data_spine_backfill), proved on a throwaway database seeded like
// production (28 cats, 12 claimed, 35 care updates — none desexed/adopted —
// as read on 2 Oct 2026, plus a couple of desexed/adopted rows here so the
// care-update path has something to exercise).

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const suffix = crypto.randomBytes(4).toString("hex");
const name = `spine_backfill_test_${suffix}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

const migrations = readMigrations(defaultMigrationsFolder());
const BEFORE_BACKFILL = migrations.find(
  (m) => m.tag === "0005_sighting_matches",
)!.idx;
const BACKFILL = migrations.find(
  (m) => m.tag === "0006_data_spine_backfill",
)!.idx;

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

async function resetToBeforeBackfill(): Promise<void> {
  const tables = await c.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  if (tables.rows.length) {
    for (const t of tables.rows) {
      await c.query(
        `alter table if exists "${t.tablename}" disable trigger all`,
      );
    }
    await c.query(
      `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`,
    );
  }
  await migrateUp(c, migrations, { throughIdx: BEFORE_BACKFILL });
}

beforeEach(async () => {
  await resetToBeforeBackfill();
});

interface CatSeed {
  name: string;
  ownerDeviceId?: string | null;
  createdAt: Date;
}

async function seedCat(seed: CatSeed): Promise<number> {
  const r = await c.query<{ id: number }>(
    `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id, owner_device_id, created_at)
     values ($1, 0, 37.44, 24.94, 'discoverer', $2, $3)
     returning id`,
    [seed.name, seed.ownerDeviceId ?? null, seed.createdAt],
  );
  return r.rows[0]!.id;
}

async function seedCareUpdate(
  catId: number,
  updateType: "desexed" | "adopted" | "sighting",
  createdAt: Date,
): Promise<void> {
  await c.query(
    `insert into cat_updates (cat_id, update_type, message, created_at)
     values ($1, $2, '', $3)`,
    [catId, updateType, createdAt],
  );
}

async function observations(catId?: number) {
  const r = await c.query(
    catId == null
      ? `select * from observations order by id`
      : `select * from observations where cat_id = $1 order by id`,
    catId == null ? [] : [catId],
  );
  return r.rows;
}

describe("PR 3: backfill claims and care updates", () => {
  it("backfills 12 claimed cats as homed, matching production's 28/12 shape", async () => {
    for (let i = 0; i < 16; i++) {
      await seedCat({ name: `Street cat ${i}`, createdAt: new Date(2024, 0, 1) });
    }
    const claimedIds: number[] = [];
    for (let i = 0; i < 12; i++) {
      claimedIds.push(
        await seedCat({
          name: `Claimed cat ${i}`,
          ownerDeviceId: `device-${i}`,
          createdAt: new Date(2024, 1, i + 1),
        }),
      );
    }

    await migrateUp(c, migrations, { throughIdx: BACKFILL });

    const homed = await c.query(
      `select cat_id, device_id, authority_scope, role_at_time, provenance, value, observed_at, suggestion_source
         from observations where kind = 'life_status' order by cat_id`,
    );
    expect(homed.rows).toHaveLength(12);
    for (const row of homed.rows) {
      expect(claimedIds).toContain(row.cat_id);
      expect(row.authority_scope).toBe("owner_of_this_cat");
      expect(row.role_at_time).toBe("public");
      expect(row.provenance).toBe("legacy");
      expect(row.value).toEqual({ status: "homed" });
      expect(row.suggestion_source).toBe("backfill:data-spine");
      expect(row.device_id).toMatch(/^device-/);
    }
    // observed_at = the cat's created_at (the claim date was never stored).
    const oneResult = await c.query(
      `select o.observed_at, c.created_at from observations o
         join cats c on c.id = o.cat_id
        where o.kind = 'life_status' limit 1`,
    );
    const one = oneResult.rows[0]!;
    expect(one.observed_at.getTime()).toBe(one.created_at.getTime());
  });

  it("writes nothing for an unclaimed street cat", async () => {
    await seedCat({ name: "Street cat", createdAt: new Date() });
    await migrateUp(c, migrations, { throughIdx: BACKFILL });
    expect(await observations()).toHaveLength(0);
  });

  it("turns a desexed care update into a sterilised observation, and adopted into homed", async () => {
    const catId = await seedCat({ name: "Agatha", createdAt: new Date(2023, 0, 1) });
    const desexedAt = new Date(2023, 5, 10, 9, 0, 0);
    const adoptedAt = new Date(2023, 6, 20, 14, 30, 0);
    await seedCareUpdate(catId, "desexed", desexedAt);
    await seedCareUpdate(catId, "adopted", adoptedAt);
    await seedCareUpdate(catId, "sighting", new Date(2023, 7, 1)); // ignored kind

    await migrateUp(c, migrations, { throughIdx: BACKFILL });

    const rows = await observations(catId);
    expect(rows).toHaveLength(2);

    const sterilised = rows.find((r) => r.kind === "sterilised");
    expect(sterilised).toMatchObject({
      value: { sterilised: true },
      device_id: null,
      account_id: "system:legacy-backfill",
      role_at_time: "staff",
      authority_scope: "none",
      provenance: "legacy",
      suggestion_source: "backfill:data-spine",
    });
    expect(sterilised!.observed_at.getTime()).toBe(desexedAt.getTime());

    const homed = rows.find((r) => r.kind === "life_status");
    expect(homed).toMatchObject({
      value: { status: "homed" },
      device_id: null,
      account_id: "system:legacy-backfill",
      role_at_time: "staff",
      provenance: "legacy",
      suggestion_source: "backfill:data-spine",
    });
    expect(homed!.observed_at.getTime()).toBe(adoptedAt.getTime());
  });

  it("running it twice inserts nothing the second time", async () => {
    // No ownerDeviceId here: this test is only about the care-update path,
    // so the claims path stays uninvolved and the row count is unambiguous.
    const catId = await seedCat({
      name: "Agatha",
      createdAt: new Date(2023, 0, 1),
    });
    await seedCareUpdate(catId, "desexed", new Date(2023, 5, 10));
    await seedCareUpdate(catId, "adopted", new Date(2023, 6, 20));

    await migrateUp(c, migrations, { throughIdx: BACKFILL });
    const firstRun = await observations(catId);
    expect(firstRun).toHaveLength(2);

    // Re-execute the migration's own forward statements directly (the
    // runner itself never re-applies an already-recorded migration; this
    // proves the SQL is idempotent on its own, as the plan's test requires).
    const migration = migrations.find((m) => m.idx === BACKFILL)!;
    for (const stmt of migration.statements) {
      await c.query(stmt);
    }

    const secondRun = await observations(catId);
    expect(secondRun).toHaveLength(2);
    expect(secondRun.map((r) => r.id)).toEqual(firstRun.map((r) => r.id));
  });

  it("a cat claimed after PR 2 (already has a go-forward homed) gets no duplicate", async () => {
    const catId = await seedCat({
      name: "Freshly claimed",
      ownerDeviceId: "device-fresh",
      createdAt: new Date(2026, 8, 1),
    });
    // Simulate PR 2's go-forward write: a homed observation from the real
    // claim moment, with no suggestion_source (exactly what
    // routes/cats.ts's claim handler writes through writeObservation).
    const claimedAt = new Date(2026, 9, 2, 10, 15, 0);
    await c.query(
      `insert into observations
         (cat_id, kind, value, device_id, role_at_time, authority_scope, provenance, observed_at)
       values ($1, 'life_status', $2, 'device-fresh', 'public', 'owner_of_this_cat', 'volunteered', $3)`,
      [catId, JSON.stringify({ status: "homed" }), claimedAt],
    );

    await migrateUp(c, migrations, { throughIdx: BACKFILL });

    const rows = await observations(catId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.observed_at.getTime()).toBe(claimedAt.getTime());
    expect(rows[0]!.suggestion_source).toBeNull();
  });

  it("a care update already recorded by PR 2's admin route gets no duplicate", async () => {
    const catId = await seedCat({ name: "Already recorded", createdAt: new Date(2026, 8, 1) });
    const updateAt = new Date(2026, 8, 5, 12, 0, 0);
    await seedCareUpdate(catId, "desexed", updateAt);
    // PR 2's go-forward write for the same cat_updates row (observed_at set
    // to the update's created_at, per routes/notifications.ts).
    await c.query(
      `insert into observations
         (cat_id, kind, value, account_id, role_at_time, authority_scope, provenance, observed_at)
       values ($1, 'sterilised', $2, 'system:admin-route', 'staff', 'none', 'volunteered', $3)`,
      [catId, JSON.stringify({ sterilised: true }), updateAt],
    );

    await migrateUp(c, migrations, { throughIdx: BACKFILL });

    const rows = await observations(catId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.account_id).toBe("system:admin-route");
    expect(rows[0]!.suggestion_source).toBeNull();
  });

  it("up-down-up leaves the same rows", async () => {
    const catId = await seedCat({
      name: "Cycled",
      ownerDeviceId: "device-cycle",
      createdAt: new Date(2024, 2, 2),
    });
    await seedCareUpdate(catId, "desexed", new Date(2024, 3, 3));

    await migrateUp(c, migrations, { throughIdx: BACKFILL });
    const before = await observations(catId);
    expect(before).toHaveLength(2);

    await rollbackLast(c, migrations);
    expect(await observations(catId)).toHaveLength(0);

    await migrateUp(c, migrations, { throughIdx: BACKFILL });
    const after = await observations(catId);
    expect(after.map((r) => ({ kind: r.kind, value: r.value, observed_at: r.observed_at.getTime() }))).toEqual(
      before.map((r) => ({ kind: r.kind, value: r.value, observed_at: r.observed_at.getTime() })),
    );
  });

  it("the rollback removes only rows marked backfill:data-spine", async () => {
    const catId = await seedCat({
      name: "Mixed",
      ownerDeviceId: "device-mixed",
      createdAt: new Date(2024, 0, 1),
    });
    await migrateUp(c, migrations, { throughIdx: BACKFILL });
    // A go-forward row (no suggestion_source) written after the backfill.
    await c.query(
      `insert into observations (cat_id, kind, value, device_id, role_at_time, authority_scope, provenance, observed_at)
       values ($1, 'ear_tip', $2, 'device-mixed', 'public', 'none', 'volunteered', now())`,
      [catId, JSON.stringify({ clipped: false })],
    );
    expect(await observations(catId)).toHaveLength(2);

    await rollbackLast(c, migrations);

    const left = await observations(catId);
    expect(left).toHaveLength(1);
    expect(left[0]!.kind).toBe("ear_tip");
  });

  it("every seeded cat's resolved status matches what its old flags said", async () => {
    // hasHome (today) <-> owner_device_id is not null; the Desexed badge
    // <-> a desexed cat_updates row. After the backfill, the matching
    // observation's presence/value must agree with each.
    const homed = await seedCat({
      name: "Has owner",
      ownerDeviceId: "device-x",
      createdAt: new Date(2024, 0, 1),
    });
    const street = await seedCat({ name: "No owner", createdAt: new Date(2024, 0, 1) });
    const desexedCat = await seedCat({ name: "Fixed", createdAt: new Date(2024, 0, 1) });
    await seedCareUpdate(desexedCat, "desexed", new Date(2024, 1, 1));

    await migrateUp(c, migrations, { throughIdx: BACKFILL });

    expect(await observations(homed)).toHaveLength(1);
    expect(await observations(street)).toHaveLength(0);
    const fixedRows = await observations(desexedCat);
    expect(fixedRows).toHaveLength(1);
    expect(fixedRows[0]!.value).toEqual({ sterilised: true });
  });

  it("self-check raises, and the whole migration rolls back, if the written rows don't match the source", async () => {
    await seedCat({ name: "Irrelevant", createdAt: new Date(2024, 0, 1) });
    await migrateUp(c, migrations, { throughIdx: BEFORE_BACKFILL });
    // Plant a sterilised observation tagged as the backfill's own, with no
    // matching "desexed" cat_updates row behind it. The self-check compares
    // counts, so this makes expected (0 desexed rows) disagree with actual
    // (1 tagged sterilised observation) before the migration's own inserts
    // even run, proving the guard fires rather than only ever passing.
    await c.query(
      `insert into observations (cat_id, kind, value, account_id, role_at_time, authority_scope, provenance, observed_at, suggestion_source)
       values (999999, 'sterilised', '{"sterilised": true}', 'system:legacy-backfill', 'staff', 'none', 'legacy', now(), 'backfill:data-spine')`,
    );

    await expect(
      migrateUp(c, migrations, { throughIdx: BACKFILL }),
    ).rejects.toThrow(/expected 0 sterilised observations .* 1 written by this backfill/);

    // Rolled back whole: the migration is not recorded as applied.
    const applied = await c.query(
      `select 1 from drizzle.__drizzle_migrations where created_at = $1`,
      [migrations.find((m) => m.idx === BACKFILL)!.when],
    );
    expect(applied.rowCount).toBe(0);
  });

  it("the adopted-care self-check raises if an adopted cat_updates row has no matching homed observation (review of PR #67, finding M9)", async () => {
    // Runs only the self-check statement (skipping the inserts that would
    // otherwise satisfy it) -- the same technique the claims self-check
    // test above uses -- proving covered_homed_from_care actually
    // disagreeing with expected_homed_from_care makes this raise, rather
    // than only ever passing by construction.
    const catId = await seedCat({ name: "NeverRecordedAdopted", createdAt: new Date(2024, 0, 1) });
    await seedCareUpdate(catId, "adopted", new Date(2024, 1, 1));
    await migrateUp(c, migrations, { throughIdx: BEFORE_BACKFILL });
    const migration = migrations.find((m) => m.idx === BACKFILL)!;
    const selfCheck = migration.statements[migration.statements.length - 1]!;

    await expect(c.query(selfCheck)).rejects.toThrow(
      /expected 1 homed observations from adopted care updates, found 0 covered/,
    );
  });

  // ---- Review of PR #67 (SYC-52) ----

  it("a care update's microsecond-precision created_at still matches a millisecond-precision go-forward observation (finding B1)", async () => {
    // cat_updates.created_at is the column's own now() -- microsecond
    // precision. The observation routes/notifications.ts writes for the
    // same event is built from a JS Date, which only carries milliseconds.
    // A plain `=` match key never hits this; the BETWEEN form must.
    const catId = await seedCat({ name: "Micro", createdAt: new Date(2026, 0, 1) });
    const inserted = await c.query<{ created_at: Date }>(
      `insert into cat_updates (cat_id, update_type, message, created_at)
       values ($1, 'desexed', '', '2026-10-03 07:00:00.123456+00') returning created_at`,
      [catId],
    );
    const msTruncated: Date = inserted.rows[0]!.created_at;
    await c.query(
      `insert into observations (cat_id, kind, value, account_id, role_at_time, authority_scope, provenance, observed_at)
       values ($1, 'sterilised', '{"sterilised": true}', 'system:admin-route', 'staff', 'none', 'volunteered', $2)`,
      [catId, msTruncated],
    );

    await migrateUp(c, migrations, { throughIdx: BACKFILL });

    const rows = await observations(catId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.account_id).toBe("system:admin-route");
    expect(rows[0]!.suggestion_source).toBeNull();
  });

  it("two desexed updates on the same cat each get their own sterilised observation", async () => {
    // A single INSERT ... SELECT's NOT EXISTS sees only the table as it was
    // before the statement started, so running both rows through in one go
    // can't actually distinguish "match key forgot observed_at" from
    // "match key is correct" (neither row sees the other's new insert
    // either way). The real risk is across two runs: a desexed update added
    // AFTER this migration already ran once and covered an earlier one. So
    // this seeds and runs the first, then adds the second and re-executes
    // the migration's own forward statements directly (same idempotency
    // path "running it twice" above exercises) -- a match key that forgot
    // observed_at would see the first backfilled observation as already
    // covering the second update too, and never write it.
    const catId = await seedCat({ name: "Relapsed", createdAt: new Date(2023, 0, 1) });
    await seedCareUpdate(catId, "desexed", new Date(2023, 1, 1));
    await migrateUp(c, migrations, { throughIdx: BACKFILL });
    expect(await observations(catId)).toHaveLength(1);

    await seedCareUpdate(catId, "desexed", new Date(2023, 2, 1));
    const migration = migrations.find((m) => m.idx === BACKFILL)!;
    for (const statement of migration.statements) await c.query(statement);

    const rows = await observations(catId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "sterilised")).toBe(true);
    expect(new Set(rows.map((r) => r.observed_at.getTime())).size).toBe(2);
  });

  it("two adopted updates on the same cat each get their own life_status observation", async () => {
    // Same two-run shape as the desexed case above, for the adopted key.
    const catId = await seedCat({ name: "RehomedTwice", createdAt: new Date(2023, 0, 1) });
    await seedCareUpdate(catId, "adopted", new Date(2023, 1, 1));
    await migrateUp(c, migrations, { throughIdx: BACKFILL });
    expect(await observations(catId)).toHaveLength(1);

    await seedCareUpdate(catId, "adopted", new Date(2023, 2, 1));
    const migration = migrations.find((m) => m.idx === BACKFILL)!;
    for (const statement of migration.statements) await c.query(statement);

    const rows = await observations(catId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "life_status")).toBe(true);
    expect(new Set(rows.map((r) => r.observed_at.getTime())).size).toBe(2);
  });

  it("a go-forward homed observation from a DIFFERENT device doesn't stop the claim being backfilled", async () => {
    // The claims match key requires the observation's device_id to be the
    // cat's CURRENT owner_device_id, not just any owner_of_this_cat/homed
    // row for that cat (an owner who moved devices, or a stray row from
    // someone else, must not be mistaken for coverage).
    const catId = await seedCat({
      name: "Moved",
      ownerDeviceId: "device-new",
      createdAt: new Date(2024, 0, 1),
    });
    await c.query(
      `insert into observations (cat_id, kind, value, device_id, role_at_time, authority_scope, provenance, observed_at)
       values ($1, 'life_status', '{"status":"homed"}', 'device-old', 'public', 'owner_of_this_cat', 'volunteered', now())`,
      [catId],
    );

    await migrateUp(c, migrations, { throughIdx: BACKFILL });

    const rows = await observations(catId);
    expect(rows).toHaveLength(2);
    const backfilled = rows.find((r) => r.suggestion_source === "backfill:data-spine");
    expect(backfilled).toBeDefined();
    expect(backfilled!.device_id).toBe("device-new");
  });

  it("an existing life_status observation that isn't 'homed' doesn't stop a claimed cat being backfilled", async () => {
    // The claims match key checks the value (status: "homed"), not just
    // the kind -- an observation recording that the owner's cat went back
    // to the street must not be mistaken for coverage of the claim.
    const catId = await seedCat({
      name: "WentMissing",
      ownerDeviceId: "device-x",
      createdAt: new Date(2024, 0, 1),
    });
    await c.query(
      `insert into observations (cat_id, kind, value, device_id, role_at_time, authority_scope, provenance, observed_at)
       values ($1, 'life_status', '{"status":"street"}', 'device-x', 'public', 'owner_of_this_cat', 'volunteered', now())`,
      [catId],
    );

    await migrateUp(c, migrations, { throughIdx: BACKFILL });

    const rows = await observations(catId);
    expect(rows).toHaveLength(2);
    const backfilled = rows.find((r) => r.suggestion_source === "backfill:data-spine");
    expect(backfilled).toMatchObject({ value: { status: "homed" } });
  });

  it("an existing homed observation with the wrong authority_scope doesn't stop a claimed cat being backfilled", async () => {
    // The claims match key checks authority_scope = 'owner_of_this_cat',
    // not just kind + value + device -- a "homed" fact recorded under a
    // different authority (e.g. a future guardian_of_this_cat write) isn't
    // the owner's own claim and must not be mistaken for coverage of it.
    const catId = await seedCat({
      name: "WrongScope",
      ownerDeviceId: "device-y",
      createdAt: new Date(2024, 0, 1),
    });
    await c.query(
      `insert into observations (cat_id, kind, value, device_id, role_at_time, authority_scope, provenance, observed_at)
       values ($1, 'life_status', '{"status":"homed"}', 'device-y', 'public', 'none', 'volunteered', now())`,
      [catId],
    );

    await migrateUp(c, migrations, { throughIdx: BACKFILL });

    const rows = await observations(catId);
    expect(rows).toHaveLength(2);
    const backfilled = rows.find((r) => r.suggestion_source === "backfill:data-spine");
    expect(backfilled).toMatchObject({ authority_scope: "owner_of_this_cat" });
  });

  it("a homed observation left on a cat whose owner_device_id has since been cleared doesn't make the claims self-check raise (finding S1)", async () => {
    const claimed = await seedCat({
      name: "Claimed",
      ownerDeviceId: "device-a",
      createdAt: new Date(2024, 0, 1),
    });
    const cleared = await seedCat({ name: "OwnerCleared", createdAt: new Date(2024, 0, 1) });
    await c.query(
      `insert into observations (cat_id, kind, value, device_id, role_at_time, authority_scope, provenance, observed_at)
       values ($1, 'life_status', '{"status":"homed"}', 'device-b', 'public', 'owner_of_this_cat', 'volunteered', now())`,
      [cleared],
    );

    await expect(
      migrateUp(c, migrations, { throughIdx: BACKFILL }),
    ).resolves.not.toThrow();
    expect(await observations(claimed)).toHaveLength(1);
  });

  it("the claims self-check raises if an owned cat has no matching homed observation (finding S1)", async () => {
    // Runs only the self-check statement (skipping the inserts that would
    // otherwise satisfy it), proving the guard fires for a real gap rather
    // than only ever passing by construction.
    await seedCat({ name: "NeverBackfilled", ownerDeviceId: "device-z", createdAt: new Date(2024, 0, 1) });
    await migrateUp(c, migrations, { throughIdx: BEFORE_BACKFILL });
    const migration = migrations.find((m) => m.idx === BACKFILL)!;
    const selfCheck = migration.statements[migration.statements.length - 1]!;

    await expect(c.query(selfCheck)).rejects.toThrow(
      /expected every one of 1 claimed\/owner-registered cats/,
    );
  });
});
