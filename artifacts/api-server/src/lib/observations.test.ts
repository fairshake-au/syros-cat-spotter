import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, pool, catsTable, observationsTable } from "@workspace/db";
import { eq, like, sql } from "drizzle-orm";
import {
  writeObservation,
  loadCatRecords,
  ObservationRefused,
  SYSTEM_AUTHORS,
} from "./observations";

// observations is append-only (cat-record-data-spine.md §10.1) — nothing in
// this file ever deletes a row from it. Cleanup removes only the cat rows
// this file creates (observations.catId has no FK, so orphaned rows from a
// dropped cat are harmless, and the whole database is thrown away at the
// end of the run — see src/test/globalSetup.ts).
const NAME_PREFIX = "VitestObservations";
let catIdCounter = 0;

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function insertCat(overrides: Partial<typeof catsTable.$inferInsert> = {}) {
  catIdCounter += 1;
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${catIdCounter}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: "vitest-obs-discoverer",
      ...overrides,
    })
    .returning();
  return cat!;
}

const BASE = {
  roleAtTime: "public" as const,
  observedAt: new Date(),
};

describe("writeObservation — refusals", () => {
  it("refuses an unknown kind", async () => {
    const cat = await insertCat();
    await expect(
      writeObservation(db, {
        ...BASE,
        catId: cat.id,
        kind: "not_a_kind" as never,
        value: {},
        deviceId: "device-1",
      }),
    ).rejects.toMatchObject({ code: "UNKNOWN_KIND" });
  });

  it("refuses a malformed value", async () => {
    const cat = await insertCat();
    await expect(
      writeObservation(db, {
        ...BASE,
        catId: cat.id,
        kind: "life_status",
        value: { status: "flying" },
        deviceId: "device-1",
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
  });

  it("refuses a future observedAt", async () => {
    const cat = await insertCat();
    await expect(
      writeObservation(db, {
        catId: cat.id,
        kind: "life_status",
        value: { status: "homed" },
        deviceId: "device-1",
        roleAtTime: "public",
        observedAt: new Date(Date.now() + 60 * 60_000),
      }),
    ).rejects.toMatchObject({ code: "FUTURE_OBSERVED_AT" });
  });

  it("clamps a public observedAt more than 30 days old, rather than refusing it", async () => {
    // §10.1's last line: "Public writes are clamped by the existing
    // capture-time rule (30 days back)" — the same rule
    // captureTime.ts's clampCaptureTime applies to a sighting's capture
    // time. Review of PR #66: an earlier version of this code refused
    // (PUBLIC_DATE_TOO_OLD) instead, which broke resolving an
    // offline-synced sighting more than 30 days after its own capture time.
    const cat = await insertCat();
    const now = new Date("2026-06-15T12:00:00Z");
    const row = await writeObservation(
      db,
      {
        catId: cat.id,
        kind: "life_status",
        value: { status: "homed" },
        deviceId: "device-1",
        roleAtTime: "public",
        observedAt: new Date(now.getTime() - 31 * 86_400_000),
      },
      now,
    );
    expect(row.observedAt.toISOString()).toBe(
      new Date(now.getTime() - 30 * 86_400_000).toISOString(),
    );
  });

  it("accepts the same date from staff (any past date for team/vet/import/legacy)", async () => {
    const cat = await insertCat();
    const row = await writeObservation(db, {
      catId: cat.id,
      kind: "sterilised",
      value: { sterilised: true },
      accountId: "some-staff-account-id",
      roleAtTime: "staff",
      observedAt: new Date("2019-03-03T00:00:00Z"),
    });
    expect(row.kind).toBe("sterilised");
  });

  it("refuses an unreachable role", async () => {
    const cat = await insertCat();
    for (const role of ["vet", "guardian", "volunteer"]) {
      await expect(
        writeObservation(db, {
          catId: cat.id,
          kind: "life_status",
          value: { status: "in_care" },
          accountId: "someone",
          roleAtTime: role,
          observedAt: new Date(),
        }),
      ).rejects.toMatchObject({ code: "UNREACHABLE_ROLE" });
    }
  });

  it("refuses a borrowed system: author", async () => {
    const cat = await insertCat();
    await expect(
      writeObservation(db, {
        catId: cat.id,
        kind: "name",
        value: { name: "Agatha", normalised: "agatha" },
        accountId: "system:something-made-up",
        roleAtTime: "system",
        observedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "BORROWED_SYSTEM_AUTHOR" });
  });

  it("refuses when neither or both of deviceId/accountId are set", async () => {
    const cat = await insertCat();
    await expect(
      writeObservation(db, {
        catId: cat.id,
        kind: "name",
        value: { name: "Agatha", normalised: "agatha" },
        roleAtTime: "public",
        observedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_AUTHOR" });
    await expect(
      writeObservation(db, {
        catId: cat.id,
        kind: "name",
        value: { name: "Agatha", normalised: "agatha" },
        deviceId: "device-1",
        accountId: "system:vision",
        roleAtTime: "public",
        observedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_AUTHOR" });
  });

  it("refuses provenance: machine from anyone but system:vision", async () => {
    const cat = await insertCat();
    await expect(
      writeObservation(db, {
        catId: cat.id,
        kind: "coat",
        value: { colours: ["ginger"], modelVersion: "v1" },
        accountId: "system:admin-route",
        roleAtTime: "system",
        provenance: "machine",
        observedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROVENANCE" });
  });
});

describe("writeObservation — go-forward acceptances", () => {
  it("accepts a well-formed coat observation from system:vision", async () => {
    const cat = await insertCat();
    expect(SYSTEM_AUTHORS).toContain("system:vision");
    const row = await writeObservation(db, {
      catId: cat.id,
      kind: "coat",
      value: { colours: ["ginger", "tabby"], modelVersion: "v1" },
      accountId: "system:vision",
      roleAtTime: "system",
      provenance: "machine",
      observedAt: new Date(),
    });
    expect(row.kind).toBe("coat");
    expect(row.accountId).toBe("system:vision");
    expect(row.provenance).toBe("machine");
  });

  it("accepts a well-formed welfare_report from system:welfare-report", async () => {
    const cat = await insertCat();
    const row = await writeObservation(db, {
      catId: cat.id,
      kind: "welfare_report",
      value: { severity: "attention", isLitter: false, reportId: 412 },
      accountId: "system:welfare-report",
      roleAtTime: "public",
      observedAt: new Date(),
    });
    expect(row.kind).toBe("welfare_report");
  });
});

describe("writeObservation — append-only trigger", () => {
  it("refuses an update or delete through this service's own insert path", async () => {
    const cat = await insertCat();
    const row = await writeObservation(db, {
      catId: cat.id,
      kind: "life_status",
      value: { status: "homed" },
      deviceId: "device-trigger",
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: new Date(),
    });

    // writeObservation itself exposes no update/delete path at all — this
    // proves the database-level guard underneath it also refuses one
    // directly (SYC-111's throwaway database applies every checked-in
    // migration, triggers included), so nothing — a future bug, a
    // migration, a raw script — can bypass §10.1's append-only guarantee by
    // going around the service.
    const updateErr: Error = await db
      .update(observationsTable)
      .set({ value: { status: "street" } })
      .where(eq(observationsTable.id, row.id))
      .catch((e) => e);
    expect(String(updateErr.cause ?? updateErr)).toMatch(/append-only/);

    const deleteErr: Error = await db
      .delete(observationsTable)
      .where(eq(observationsTable.id, row.id))
      .catch((e) => e);
    expect(String(deleteErr.cause ?? deleteErr)).toMatch(/append-only/);
  });
});

describe("loadCatRecords", () => {
  it("issues a fixed number of queries whatever the number of cats", async () => {
    const few = await Promise.all([insertCat(), insertCat(), insertCat()]);
    const many = await Promise.all(
      Array.from({ length: 50 }, () => insertCat()),
    );

    const spy = vi.spyOn(pool, "query");
    spy.mockClear();
    await loadCatRecords(few.map((c) => c.id));
    const fewCount = spy.mock.calls.length;

    spy.mockClear();
    await loadCatRecords(many.map((c) => c.id));
    const manyCount = spy.mock.calls.length;

    spy.mockRestore();

    expect(fewCount).toBeGreaterThan(0);
    expect(manyCount).toBe(fewCount);
  });

  it("no observations resolves to street and unknown (nothing to derive from but created_at)", async () => {
    const cat = await insertCat();
    const records = await loadCatRecords([cat.id]);
    const rec = records.get(cat.id)!;
    expect(rec.observations).toEqual([]);
    expect(rec.evidenceOfLife).not.toBeNull();
    expect(rec.evidenceOfLife!.source).toBe("created");
    expect(rec.evidenceOfLife!.lastSightingAt).toBeNull();
  });

  it("computes lastSightingAt from the newest resolved sighting, and at/source from the newest life-implying observation", async () => {
    const cat = await insertCat();
    const twentyDaysAgo = new Date(Date.now() - 20 * 86_400_000);
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    // Staff/vet/admin/import/legacy may carry any past date; a public date
    // is limited to 30 days, so these use dates comfortably inside that —
    // this test is about evidence-of-life computation, not date validation.
    await writeObservation(db, {
      catId: cat.id,
      kind: "sterilised",
      value: { sterilised: true },
      accountId: "staff-1",
      roleAtTime: "staff",
      observedAt: twentyDaysAgo,
    });
    await writeObservation(db, {
      catId: cat.id,
      kind: "ear_tip",
      value: { clipped: true, side: "left" },
      deviceId: "device-eartip",
      roleAtTime: "public",
      photoId: 1,
      observedAt: tenDaysAgo,
    });
    const records = await loadCatRecords([cat.id]);
    const rec = records.get(cat.id)!;
    expect(rec.evidenceOfLife!.source).toBe("ear_tip");
    expect(rec.evidenceOfLife!.at.toISOString()).toBe(tenDaysAgo.toISOString());
  });

  it("a redacted observation with its value intact still counts", async () => {
    const cat = await insertCat();
    const row = await writeObservation(db, {
      catId: cat.id,
      kind: "sterilised",
      value: { sterilised: true },
      deviceId: "device-redact",
      roleAtTime: "public",
      observedAt: new Date(Date.now() - 10 * 86_400_000),
    });
    // Simulate §8.5 redaction: identifying columns cleared, value intact.
    // (Deletion itself is SYC-63's; this proves loadCatRecords doesn't
    // treat redactedAt as "ignore this row" the way resolve.ts's isActive
    // deliberately doesn't either.)
    // The trigger requires BOTH author columns to end up null on redaction
    // (observations_attribution_ck's "exactly one, until redaction clears
    // both") — accountId was already null here, so only deviceId changes.
    await db.execute(sql`
      update observations
      set redacted_at = now(),
          redaction_reason = 'test',
          device_id = null
      where id = ${row.id}
    `);
    const records = await loadCatRecords([cat.id]);
    const rec = records.get(cat.id)!;
    const found = rec.observations.find((o) => o.id === row.id);
    expect(found).toBeDefined();
    expect(found!.redactedAt).not.toBeNull();
    expect((found!.value as { sterilised: boolean }).sterilised).toBe(true);
  });
});
