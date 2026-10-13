import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, pool, catsTable, observationsTable, sightingsTable } from "@workspace/db";
import { eq, like, sql } from "drizzle-orm";
import {
  writeObservation,
  loadCatRecords,
  ObservationRefused,
  SYSTEM_AUTHORS,
  MARKS,
  normaliseColours,
} from "./observations";
import { resolveLifeStatus } from "./resolve";

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

  it("refuses any suggestionSource starting backfill: (review of PR #67, SYC-52, finding S2)", async () => {
    // Migration 0006's rollback finds exactly the rows it wrote by
    // suggestion_source = 'backfill:data-spine' and deletes only those.
    // The migration's header already claimed writeObservation refuses that
    // value from any other caller; before this fix nothing enforced it, so
    // a go-forward write using the same prefix would have been silently
    // deletable by a future rollback.
    const cat = await insertCat();
    await expect(
      writeObservation(db, {
        catId: cat.id,
        kind: "life_status",
        value: { status: "homed" },
        accountId: "system:legacy-backfill",
        roleAtTime: "staff",
        observedAt: new Date(),
        suggestionSource: "backfill:data-spine",
      }),
    ).rejects.toMatchObject({ code: "RESERVED_SUGGESTION_SOURCE" });
    await expect(
      writeObservation(db, {
        catId: cat.id,
        kind: "life_status",
        value: { status: "homed" },
        accountId: "system:legacy-backfill",
        roleAtTime: "staff",
        observedAt: new Date(),
        suggestionSource: "backfill:some-future-migration",
      }),
    ).rejects.toMatchObject({ code: "RESERVED_SUGGESTION_SOURCE" });
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

  it("an ear-tip answer tied to a sighting adds no evidence of life beyond that sighting, even if its date was moved forward", async () => {
    // Review of the SYC-117 part 2 spec, 4 Oct 2026: a spotter's answer is
    // dated to their sighting's capture time, but writeObservation moves a
    // public date older than 30 days forward to the 30-day limit. On a
    // sighting synced late and answered later still, that made the answer
    // look newer than the sighting, and pulled the cat's "last seen alive"
    // forward. The sighting already counts, at its true date, so an answer
    // that belongs to it must not count separately.
    const cat = await insertCat();
    const fortyDaysAgo = new Date(Date.now() - 40 * 86_400_000);
    const [sighting] = await db
      .insert(sightingsTable)
      .values({
        catId: cat.id,
        deviceId: "device-late-answer",
        photoId: 1,
        lat: 37.44,
        lng: 24.9,
        status: "resolved",
        createdAt: fortyDaysAgo,
      })
      .returning();
    const answer = await writeObservation(db, {
      catId: cat.id,
      kind: "ear_tip",
      value: { clipped: true, side: "left" },
      deviceId: "device-late-answer",
      roleAtTime: "public",
      photoId: 1,
      sightingId: sighting!.id,
      observedAt: fortyDaysAgo,
    });
    // The clamp moved it forward: this is the situation being guarded.
    expect(answer.observedAt.getTime()).toBeGreaterThan(fortyDaysAgo.getTime());

    const rec = (await loadCatRecords([cat.id])).get(cat.id)!;
    expect(rec.evidenceOfLife!.source).toBe("sighting");
    expect(rec.evidenceOfLife!.at.toISOString()).toBe(fortyDaysAgo.toISOString());
  });

  it("lastSightingAt comes from the newest RESOLVED sighting, ignoring a newer pending one", async () => {
    // Test gap found in review of PR #66: the test above this one is named
    // for exactly this rule but inserts no sighting rows at all, so it would
    // pass even with the `status = 'resolved'` filter removed from
    // loadCatRecords's sighting query. This test actually seeds both
    // statuses and proves the newer, unresolved sighting is ignored.
    const cat = await insertCat();
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000);
    await db.insert(sightingsTable).values({
      catId: cat.id,
      deviceId: "device-sighting-resolved",
      photoId: 1,
      lat: 37.44,
      lng: 24.9,
      status: "resolved",
      createdAt: tenDaysAgo,
    });
    // Newer, but still pending — must not win.
    await db.insert(sightingsTable).values({
      catId: cat.id,
      deviceId: "device-sighting-pending",
      photoId: 1,
      lat: 37.44,
      lng: 24.9,
      status: "pending",
      createdAt: fiveDaysAgo,
    });

    const records = await loadCatRecords([cat.id]);
    const rec = records.get(cat.id)!;
    expect(rec.evidenceOfLife!.lastSightingAt?.toISOString()).toBe(
      tenDaysAgo.toISOString(),
    );
    expect(rec.evidenceOfLife!.source).toBe("sighting");
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

  it("T-life: the four new kinds are never evidence of life (an old cat stays presumed deceased)", async () => {
    const fourYearsAgo = new Date(Date.now() - 4 * 365 * 86_400_000);
    const cat = await insertCat({ createdAt: fourYearsAgo });
    const recent = new Date(Date.now() - 2 * 86_400_000);
    const staff = { accountId: "staff-life", roleAtTime: "staff" as const, observedAt: recent };
    await writeObservation(db, { ...staff, catId: cat.id, kind: "coat", value: { colours: ["ginger"] } });
    await writeObservation(db, { ...staff, catId: cat.id, kind: "markings", value: { marks: ["white_paws"] } });
    await writeObservation(db, { ...staff, catId: cat.id, kind: "vaccinated", value: { vaccines: ["rabies"] } });
    await writeObservation(db, { ...staff, catId: cat.id, kind: "team_note", value: { text: "limping" } });
    const rec = (await loadCatRecords([cat.id])).get(cat.id)!;
    expect(rec.evidenceOfLife!.source).toBe("created");
    expect(rec.evidenceOfLife!.at.toISOString()).toBe(fourYearsAgo.toISOString());
    const life = resolveLifeStatus(rec.observations, rec.evidenceOfLife, new Date());
    expect(life.presumedDeceased).toBe(true);
    expect(life.value).toBe("street");
  });
});

// ---------------------------------------------------------------------------
// SYC-2 PR 1.1: coat, markings, vaccinated, team_note
// ---------------------------------------------------------------------------

type Kind = "coat" | "markings" | "vaccinated" | "team_note" | "sterilised";

async function writeAs(
  catId: number,
  kind: Kind,
  value: unknown,
  who: "public" | "staff" | "guardian" | "system" | "vet" = "staff",
  extra: Record<string, unknown> = {},
) {
  const author =
    who === "public"
      ? { deviceId: "dev-default" }
      : { accountId: who === "system" ? "system:vision" : "staff-pr11" };
  return writeObservation(db, {
    catId,
    kind,
    value,
    roleAtTime: who,
    observedAt: new Date(),
    ...author,
    ...extra,
  });
}

const refused = (code: string) => ({ code });

describe("normaliseColours", () => {
  it("turns black + white into black_and_white, in either order", () => {
    expect(normaliseColours(["black", "white"])).toEqual(["black_and_white"]);
    expect(normaliseColours(["white", "black"])).toEqual(["black_and_white"]);
  });
  it("de-duplicates, and leaves everything else in its original order", () => {
    expect(normaliseColours(["ginger", "ginger"])).toEqual(["ginger"]);
    expect(normaliseColours(["black", "black", "white"])).toEqual(["black_and_white"]);
    expect(normaliseColours(["tabby", "ginger"])).toEqual(["tabby", "ginger"]);
    expect(normaliseColours(["black", "ginger"])).toEqual(["black", "ginger"]);
  });
});

describe("coat validator", () => {
  it("accepts a person's coat pair from public", async () => {
    const cat = await insertCat();
    const row = await writeAs(cat.id, "coat", { colours: ["ginger", "tabby"] }, "public");
    expect(row.kind).toBe("coat");
  });
  it("accepts black_and_white and not_sure alone, and tolerates extra keys", async () => {
    const cat = await insertCat();
    await writeAs(cat.id, "coat", { colours: ["black_and_white"] }, "staff");
    await writeAs(cat.id, "coat", { colours: ["not_sure"], agreesWith: 1, reason: "x" }, "staff");
  });
  it("refuses a person's coat carrying modelVersion", async () => {
    const cat = await insertCat();
    await expect(
      writeAs(cat.id, "coat", { colours: ["ginger"], modelVersion: "v1" }, "public"),
    ).rejects.toMatchObject(refused("MALFORMED_VALUE"));
  });
  it("refuses a machine coat without modelVersion, or with an empty one", async () => {
    const cat = await insertCat();
    for (const value of [{ colours: ["ginger"] }, { colours: ["ginger"], modelVersion: "" }]) {
      await expect(
        writeAs(cat.id, "coat", value, "system", { provenance: "machine" }),
      ).rejects.toMatchObject(refused("MALFORMED_VALUE"));
    }
  });
  it("refuses the raw black + white pair, duplicates, not_sure combined, empty, three, unknown", async () => {
    const cat = await insertCat();
    for (const colours of [
      ["black", "white"],
      ["white", "black"],
      ["ginger", "ginger"],
      ["not_sure", "ginger"],
      [],
      ["ginger", "tabby", "grey"],
      ["purple"],
    ]) {
      await expect(writeAs(cat.id, "coat", { colours }, "staff")).rejects.toMatchObject(
        refused("MALFORMED_VALUE"),
      );
    }
    await expect(writeAs(cat.id, "coat", { colours: "ginger" }, "staff")).rejects.toMatchObject(
      refused("MALFORMED_VALUE"),
    );
  });
});

describe("markings validator", () => {
  it("has the eleven codes in spec order", () => {
    expect(MARKS).toHaveLength(11);
    expect(MARKS[0]).toBe("white_paws");
    expect(MARKS[10]).toBe("odd_eyes");
  });
  it("accepts [] and { cantTell: true }", async () => {
    const cat = await insertCat();
    await writeAs(cat.id, "markings", { marks: [] }, "public");
    await writeAs(cat.id, "markings", { cantTell: true }, "public");
  });
  it("refuses five marks from public, accepts five from staff", async () => {
    const cat = await insertCat();
    const five = MARKS.slice(0, 5);
    await expect(writeAs(cat.id, "markings", { marks: five }, "public")).rejects.toMatchObject(
      refused("MALFORMED_VALUE"),
    );
    await writeAs(cat.id, "markings", { marks: MARKS.slice(0, 4) }, "public");
    await writeAs(cat.id, "markings", { marks: five }, "staff");
  });
  it("refuses an unknown mark, duplicates, cantTell with marks, cantTell false, and a non-array", async () => {
    const cat = await insertCat();
    for (const value of [
      { marks: ["not_a_mark"] },
      { marks: ["torn_ear", "torn_ear"] },
      { cantTell: true, marks: [] },
      { cantTell: false },
      { marks: "torn_ear" },
      {},
    ]) {
      await expect(writeAs(cat.id, "markings", value, "staff")).rejects.toMatchObject(
        refused("MALFORMED_VALUE"),
      );
    }
  });
});

describe("vaccinated validator", () => {
  it("accepts codes, an other vaccine, and a clinic, from staff", async () => {
    const cat = await insertCat();
    await writeAs(cat.id, "vaccinated", {
      vaccines: ["rabies", "cat_flu_enteritis", { other: "FeLV" }],
      clinic: "Ermoupoli Vets",
    });
  });
  it("refuses public, guardian and system with ROLE_NOT_ALLOWED_FOR_KIND", async () => {
    const cat = await insertCat();
    for (const who of ["public", "guardian", "system"] as const) {
      await expect(
        writeAs(cat.id, "vaccinated", { vaccines: ["rabies"] }, who),
      ).rejects.toMatchObject(refused("ROLE_NOT_ALLOWED_FOR_KIND"));
    }
  });
  it("refuses a bad other name (1 char, 61 chars, none, blank)", async () => {
    const cat = await insertCat();
    for (const other of ["a", "x".repeat(61), " a "]) {
      await expect(
        writeAs(cat.id, "vaccinated", { vaccines: [{ other }] }),
      ).rejects.toMatchObject(refused("MALFORMED_VALUE"));
    }
    await expect(writeAs(cat.id, "vaccinated", { vaccines: [{}] })).rejects.toMatchObject(
      refused("MALFORMED_VALUE"),
    );
    await writeAs(cat.id, "vaccinated", { vaccines: [{ other: "x".repeat(60) }] });
  });
  it("refuses 0 or 4 vaccines, unknown codes, duplicates and a non-string clinic", async () => {
    const cat = await insertCat();
    for (const value of [
      { vaccines: [] },
      { vaccines: ["rabies", "cat_flu_enteritis", { other: "aa" }, { other: "bb" }] },
      { vaccines: ["measles"] },
      { vaccines: ["rabies", "rabies"] },
      { vaccines: [{ other: "FeLV" }, { other: " felv " }] },
      { vaccines: ["rabies"], clinic: 5 },
      { retracted: true },
    ]) {
      await expect(writeAs(cat.id, "vaccinated", value)).rejects.toMatchObject(
        refused("MALFORMED_VALUE"),
      );
    }
  });
});

describe("team_note validator", () => {
  it("accepts staff, refuses public and system", async () => {
    const cat = await insertCat();
    await writeAs(cat.id, "team_note", { text: "limping on the left" });
    for (const who of ["public", "system"] as const) {
      await expect(writeAs(cat.id, "team_note", { text: "x" }, who)).rejects.toMatchObject(
        refused("ROLE_NOT_ALLOWED_FOR_KIND"),
      );
    }
  });
  it("refuses empty, blank and 2001-character text; accepts 2000", async () => {
    const cat = await insertCat();
    for (const text of ["", "   ", "x".repeat(2001)]) {
      await expect(writeAs(cat.id, "team_note", { text })).rejects.toMatchObject(
        refused("MALFORMED_VALUE"),
      );
    }
    await writeAs(cat.id, "team_note", { text: "x".repeat(2000) });
  });
});

describe("per-kind role rules", () => {
  it("refuses vet for coat and markings", async () => {
    const cat = await insertCat();
    for (const [kind, value] of [
      ["coat", { colours: ["ginger"] }],
      ["markings", { marks: [] }],
    ] as const) {
      await expect(writeAs(cat.id, kind, value, "vet")).rejects.toMatchObject(
        refused("ROLE_NOT_ALLOWED_FOR_KIND"),
      );
    }
  });
});

describe("retraction", () => {
  it("refuses { retracted: true } from public", async () => {
    const cat = await insertCat();
    const base = await writeAs(cat.id, "coat", { colours: ["ginger"] }, "public");
    await expect(
      writeAs(cat.id, "coat", { retracted: true }, "public", { supersedesId: base.id }),
    ).rejects.toMatchObject(refused("INVALID_RETRACTION"));
  });
  it("refuses a retraction with no supersedesId, or a missing target", async () => {
    const cat = await insertCat();
    await expect(writeAs(cat.id, "coat", { retracted: true })).rejects.toMatchObject(
      refused("INVALID_RETRACTION"),
    );
    await expect(
      writeAs(cat.id, "markings", { retracted: true }, "staff", { supersedesId: 2_000_000_000 }),
    ).rejects.toMatchObject(refused("INVALID_RETRACTION"));
  });
  it("accepts staff retracting a staff coat row, tolerating a reason key", async () => {
    const cat = await insertCat();
    const base = await writeAs(cat.id, "coat", { colours: ["ginger"] });
    const row = await writeAs(cat.id, "coat", { retracted: true, reason: "wrong cat" }, "staff", {
      supersedesId: base.id,
    });
    expect(row.supersedesId).toBe(base.id);
  });
  it("refuses a malformed retraction (retracted not exactly true, or mixed with statement keys)", async () => {
    const cat = await insertCat();
    const base = await writeAs(cat.id, "coat", { colours: ["ginger"] });
    for (const value of [
      { retracted: false },
      { retracted: "yes" },
      { retracted: true, colours: ["ginger"] },
      { retracted: true, modelVersion: "v1" },
    ]) {
      await expect(
        writeAs(cat.id, "coat", value, "staff", { supersedesId: base.id }),
      ).rejects.toMatchObject(refused("MALFORMED_VALUE"));
    }
    const m = await writeAs(cat.id, "markings", { marks: [] });
    await expect(
      writeAs(cat.id, "markings", { retracted: true, cantTell: true }, "staff", {
        supersedesId: m.id,
      }),
    ).rejects.toMatchObject(refused("MALFORMED_VALUE"));
  });
  it("other kinds do not accept a retraction value", async () => {
    const cat = await insertCat();
    await expect(writeAs(cat.id, "sterilised", { retracted: true })).rejects.toMatchObject(
      refused("MALFORMED_VALUE"),
    );
  });
  it("T-retract-kind: a retraction can only supersede a row of its own kind (coat or markings)", async () => {
    const cat = await insertCat();
    const sterilised = await writeAs(cat.id, "sterilised", { sterilised: true });
    const vaccinated = await writeAs(cat.id, "vaccinated", { vaccines: ["rabies"] });
    const note = await writeAs(cat.id, "team_note", { text: "n" });
    const coat = await writeAs(cat.id, "coat", { colours: ["ginger"] });
    for (const kind of ["coat", "markings"] as const) {
      for (const target of [sterilised, vaccinated, note]) {
        await expect(
          writeAs(cat.id, kind, { retracted: true }, "staff", { supersedesId: target.id }),
        ).rejects.toMatchObject(refused("INVALID_RETRACTION"));
      }
    }
    await expect(
      writeAs(cat.id, "markings", { retracted: true }, "staff", { supersedesId: coat.id }),
    ).rejects.toMatchObject(refused("INVALID_RETRACTION"));
  });
});

describe("own-row rule (C2)", () => {
  it("T-own-row: a device cannot supersede another device's row, but can supersede its own", async () => {
    const cat = await insertCat();
    const a = await writeAs(cat.id, "coat", { colours: ["ginger"] }, "public", {
      deviceId: "dev-A",
    });
    await expect(
      writeAs(cat.id, "coat", { colours: ["grey"] }, "public", {
        deviceId: "dev-B",
        supersedesId: a.id,
      }),
    ).rejects.toMatchObject(refused("NOT_YOUR_ROW"));
    const own = await writeAs(cat.id, "coat", { colours: ["grey"] }, "public", {
      deviceId: "dev-A",
      supersedesId: a.id,
    });
    expect(own.supersedesId).toBe(a.id);
  });
  it("T-own-row: a public markings write cannot supersede the device's own coat row", async () => {
    const cat = await insertCat();
    const a = await writeAs(cat.id, "coat", { colours: ["ginger"] }, "public", {
      deviceId: "dev-A",
    });
    await expect(
      writeAs(cat.id, "markings", { marks: [] }, "public", {
        deviceId: "dev-A",
        supersedesId: a.id,
      }),
    ).rejects.toMatchObject(refused("NOT_YOUR_ROW"));
  });
  it("T-own-row: a public write cannot supersede a team row or a missing row", async () => {
    const cat = await insertCat();
    const team = await writeAs(cat.id, "coat", { colours: ["ginger"] });
    await expect(
      writeAs(cat.id, "coat", { colours: ["grey"] }, "public", { supersedesId: team.id }),
    ).rejects.toMatchObject(refused("NOT_YOUR_ROW"));
    await expect(
      writeAs(cat.id, "coat", { colours: ["grey"] }, "public", { supersedesId: 2_000_000_000 }),
    ).rejects.toMatchObject(refused("NOT_YOUR_ROW"));
  });
  it("leaves team supersession of a device's row unchanged", async () => {
    const cat = await insertCat();
    const a = await writeAs(cat.id, "coat", { colours: ["ginger"] }, "public", {
      deviceId: "dev-A",
    });
    const row = await writeAs(cat.id, "coat", { colours: ["grey"] }, "staff", {
      supersedesId: a.id,
    });
    expect(row.supersedesId).toBe(a.id);
  });
});

describe("same-kind supersession (review fix 1)", () => {
  it("refuses a staff team_note superseding a sterilised row", async () => {
    const cat = await insertCat();
    const st = await writeAs(cat.id, "sterilised", { sterilised: true });
    await expect(
      writeAs(cat.id, "team_note", { text: "x" }, "staff", { supersedesId: st.id }),
    ).rejects.toMatchObject(refused("INVALID_SUPERSESSION"));
    await expect(
      writeAs(cat.id, "team_note", { text: "x" }, "staff", { supersedesId: 2_000_000_000 }),
    ).rejects.toMatchObject(refused("INVALID_SUPERSESSION"));
  });
});

describe("same-cat supersession for coat and markings (review fix 2)", () => {
  it("refuses a staff retraction on cat Y pointing at cat X's coat row", async () => {
    const x = await insertCat();
    const y = await insertCat();
    const row = await writeAs(x.id, "coat", { colours: ["ginger"] });
    await expect(
      writeAs(y.id, "coat", { retracted: true }, "staff", { supersedesId: row.id }),
    ).rejects.toMatchObject(refused("INVALID_RETRACTION"));
  });
  it("refuses device A's coat on cat Y superseding A's own row on cat X", async () => {
    const x = await insertCat();
    const y = await insertCat();
    const row = await writeAs(x.id, "coat", { colours: ["ginger"] }, "public", { deviceId: "dev-A" });
    await expect(
      writeAs(y.id, "coat", { colours: ["grey"] }, "public", { deviceId: "dev-A", supersedesId: row.id }),
    ).rejects.toMatchObject(refused("NOT_YOUR_ROW"));
  });
  it("refuses a staff coat correction across cats", async () => {
    const x = await insertCat();
    const y = await insertCat();
    const row = await writeAs(x.id, "coat", { colours: ["ginger"] });
    await expect(
      writeAs(y.id, "coat", { colours: ["grey"] }, "staff", { supersedesId: row.id }),
    ).rejects.toMatchObject(refused("INVALID_SUPERSESSION"));
  });
});

describe("retraction roles and system own-row (review fix 3)", () => {
  const machine = { provenance: "machine" };
  it("refuses system:vision retracting a staff coat row", async () => {
    const cat = await insertCat();
    const base = await writeAs(cat.id, "coat", { colours: ["ginger"] });
    await expect(
      writeAs(cat.id, "coat", { retracted: true }, "system", { ...machine, supersedesId: base.id }),
    ).rejects.toMatchObject(refused("INVALID_RETRACTION"));
  });
  it("refuses system:vision superseding a device's coat row", async () => {
    const cat = await insertCat();
    const base = await writeAs(cat.id, "coat", { colours: ["ginger"] }, "public");
    await expect(
      writeAs(cat.id, "coat", { colours: ["grey"], modelVersion: "v1" }, "system", {
        ...machine,
        supersedesId: base.id,
      }),
    ).rejects.toMatchObject(refused("NOT_YOUR_ROW"));
  });
  it("accepts system:vision superseding its own earlier machine coat row", async () => {
    const cat = await insertCat();
    const first = await writeAs(cat.id, "coat", { colours: ["ginger"], modelVersion: "v1" }, "system", machine);
    const second = await writeAs(cat.id, "coat", { colours: ["grey"], modelVersion: "v2" }, "system", {
      ...machine,
      supersedesId: first.id,
    });
    expect(second.supersedesId).toBe(first.id);
  });
});

describe("system is narrowed for appearance (review fix 4)", () => {
  it("refuses system:vision markings", async () => {
    const cat = await insertCat();
    await expect(
      writeAs(cat.id, "markings", { marks: [] }, "system", { provenance: "machine" }),
    ).rejects.toMatchObject(refused("ROLE_NOT_ALLOWED_FOR_KIND"));
  });
  it("refuses a volunteered coat from system:admin-route", async () => {
    const cat = await insertCat();
    await expect(
      writeAs(cat.id, "coat", { colours: ["ginger"] }, "system", { accountId: "system:admin-route", deviceId: undefined }),
    ).rejects.toMatchObject(refused("ROLE_NOT_ALLOWED_FOR_KIND"));
  });
});

describe("public appearance needs a device (review fix 5)", () => {
  it("refuses a public coat or markings write with an accountId and no deviceId", async () => {
    const cat = await insertCat();
    for (const [kind, value] of [
      ["coat", { colours: ["ginger"] }],
      ["markings", { marks: [] }],
    ] as const) {
      await expect(
        writeObservation(db, {
          catId: cat.id,
          kind,
          value,
          accountId: "someone",
          roleAtTime: "public",
          observedAt: new Date(),
        }),
      ).rejects.toMatchObject(refused("INVALID_AUTHOR"));
    }
  });
});

describe("no stray retracted key (review fix 6)", () => {
  it("refuses retracted on vaccinated and team_note", async () => {
    const cat = await insertCat();
    await expect(
      writeAs(cat.id, "vaccinated", { vaccines: ["rabies"], retracted: true }),
    ).rejects.toMatchObject(refused("MALFORMED_VALUE"));
    await expect(
      writeAs(cat.id, "team_note", { text: "a", retracted: true }),
    ).rejects.toMatchObject(refused("MALFORMED_VALUE"));
  });
});

describe("raw sizes (review fix 7)", () => {
  it("team_note: raw length at most 2000 and not blank", async () => {
    const cat = await insertCat();
    await expect(
      writeAs(cat.id, "team_note", { text: "a" + " ".repeat(2000) }),
    ).rejects.toMatchObject(refused("MALFORMED_VALUE"));
    await writeAs(cat.id, "team_note", { text: "a" + " ".repeat(1999) });
  });
  it("other vaccine name must already be trimmed", async () => {
    const cat = await insertCat();
    for (const other of [" FeLV", "FeLV ", "\tFeLV"]) {
      await expect(
        writeAs(cat.id, "vaccinated", { vaccines: [{ other }] }),
      ).rejects.toMatchObject(refused("MALFORMED_VALUE"));
    }
    await writeAs(cat.id, "vaccinated", { vaccines: [{ other: "FeLV" }] });
  });
  it("clinic: a non-blank string of at most 120 characters", async () => {
    const cat = await insertCat();
    for (const clinic of ["", "   ", "x".repeat(121)]) {
      await expect(
        writeAs(cat.id, "vaccinated", { vaccines: ["rabies"], clinic }),
      ).rejects.toMatchObject(refused("MALFORMED_VALUE"));
    }
    await writeAs(cat.id, "vaccinated", { vaccines: ["rabies"], clinic: "x".repeat(120) });
  });
});

describe("order of checks (review fix 8)", () => {
  it("a public team_note with empty text is refused for its role first", async () => {
    const cat = await insertCat();
    await expect(writeAs(cat.id, "team_note", { text: "" }, "public")).rejects.toMatchObject(
      refused("ROLE_NOT_ALLOWED_FOR_KIND"),
    );
  });
  it("an unknown provenance is INVALID_PROVENANCE even with a malformed value", async () => {
    const cat = await insertCat();
    await expect(
      writeAs(cat.id, "coat", { colours: [] }, "staff", { provenance: "bogus" }),
    ).rejects.toMatchObject(refused("INVALID_PROVENANCE"));
  });
  it("the per-kind role rule runs before reachability", async () => {
    const cat = await insertCat();
    await expect(
      writeAs(cat.id, "vaccinated", { vaccines: ["rabies"] }, "guardian"),
    ).rejects.toMatchObject(refused("ROLE_NOT_ALLOWED_FOR_KIND"));
    await expect(
      writeAs(cat.id, "sterilised", { sterilised: true }, "guardian"),
    ).rejects.toMatchObject(refused("UNREACHABLE_ROLE"));
  });
});
