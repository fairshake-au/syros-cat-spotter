import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, catsTable, observationsTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { writeObservation, type WriteObservationInput } from "./observations";

// SYC-396 PR 3.0, Task 3.0.1 (team-dashboard-redesign.md §8.2, §8.3; plan
// Decisions 4–7): the `vet_visit` kind, the visit link on `sterilised` and
// `vaccinated`, and the one way a retraction of these kinds is written (a
// vet-visit undo, `fromVisitUndo`). observations is append-only: this file
// never deletes a row from it, and every assertion is on its own fresh cats.

const NAME_PREFIX = "VitestVetVisitObs";
let catIdCounter = 0;

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function insertCat() {
  catIdCounter += 1;
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${catIdCounter}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: "vitest-vetvisit-discoverer",
    })
    .returning();
  return cat!;
}

type Who = "staff" | "management" | "guardian" | "public" | "system";

function authorOf(who: Who): Partial<WriteObservationInput> {
  switch (who) {
    case "public":
      return { deviceId: "vitest-vetvisit-device" };
    case "system":
      return { accountId: "system:admin-route" };
    case "guardian":
      return { accountId: "vitest-vetvisit-guardian", authorityScope: "colony:1" };
    default:
      return { accountId: `vitest-vetvisit-${who}` };
  }
}

function write(
  catId: number,
  kind: WriteObservationInput["kind"],
  value: unknown,
  who: Who = "staff",
  extra: Partial<WriteObservationInput> = {},
) {
  return writeObservation(db, {
    catId,
    kind,
    value,
    roleAtTime: who,
    observedAt: new Date(),
    ...authorOf(who),
    ...extra,
  });
}

async function rowsFor(catId: number) {
  return db.select().from(observationsTable).where(eq(observationsTable.catId, catId));
}

/** What logVetVisit (PR 3.1) passes when it writes a statement linked to its visit. */
const FROM_VISIT = { fromVisit: true } as const;

const VISIT = {
  did: ["sterilised"],
  clinicId: "symviosis",
  costEur: 55,
  paidBy: "syros_cats",
} as const;

describe("vet_visit: accepted shapes", () => {
  it.each([
    ["sterilised only", VISIT],
    ["checked only, no cost", { did: ["checked"], clinicId: "dermitzaki", costEur: null, paidBy: "owner" }],
    [
      "all three procedures, with a note",
      {
        did: ["sterilised", "vaccinated", "treated"],
        vaccines: ["rabies", { other: "FeLV" }],
        treatedNote: "ear mites",
        clinicId: "cyclades-vets",
        costEur: 120.5,
        paidBy: "donation",
        note: "trapped at the harbour",
      },
    ],
    ["the cost at 0", { ...VISIT, costEur: 0 }],
    ["the cost at exactly 2000", { ...VISIT, costEur: 2000 }],
    ["two decimals", { ...VISIT, costEur: 55.99 }],
    ["an empty note", { ...VISIT, note: "" }],
    // Samuel, 21 Oct 2026 (SYC-396): an optional reason for a sterilisation's non-standard cost.
    ["a reason for the cost", { ...VISIT, costEur: 75, costReason: "pregnant, longer surgery" }],
  ])("accepts %s", async (_label, value) => {
    const cat = await insertCat();
    const row = await write(cat.id, "vet_visit", value);
    expect(row.kind).toBe("vet_visit");
  });
});

describe("vet_visit: refusals", () => {
  it.each([
    ["no did", { ...VISIT, did: [] }],
    ["did not a list", { ...VISIT, did: "sterilised" }],
    ["an unknown procedure", { ...VISIT, did: ["neutered"] }],
    ["a repeated procedure", { ...VISIT, did: ["sterilised", "sterilised"] }],
    ["checked together with sterilised", { ...VISIT, did: ["checked", "sterilised"] }],
    ["vaccinated without vaccines", { ...VISIT, did: ["vaccinated"] }],
    ["vaccines without vaccinated", { ...VISIT, vaccines: ["rabies"] }],
    ["an empty vaccine list", { ...VISIT, did: ["vaccinated"], vaccines: [] }],
    ["an unknown vaccine", { ...VISIT, did: ["vaccinated"], vaccines: ["distemper"] }],
    ["a listed vaccine typed as other", { ...VISIT, did: ["vaccinated"], vaccines: [{ other: "Rabies" }] }],
    ["a repeated vaccine", { ...VISIT, did: ["vaccinated"], vaccines: ["rabies", "rabies"] }],
    ["treated without a note", { ...VISIT, did: ["treated"] }],
    ["a cost reason without a sterilisation", { ...VISIT, did: ["checked"], costEur: 20, costReason: "late" }],
    ["a cost reason with no cost", { ...VISIT, costEur: null, costReason: "unknown" }],
    ["a blank cost reason", { ...VISIT, costReason: "" }],
    ["an untrimmed cost reason", { ...VISIT, costReason: " pregnant" }],
    ["a cost reason over 200 characters", { ...VISIT, costReason: "x".repeat(201) }],
    ["a blank treated note", { ...VISIT, did: ["treated"], treatedNote: "  " }],
    ["a treated note of 201 characters", { ...VISIT, did: ["treated"], treatedNote: "x".repeat(201) }],
    ["a treated note without treated", { ...VISIT, treatedNote: "ear mites" }],
    ["an unknown clinic id", { ...VISIT, clinicId: "the-vet-down-the-road" }],
    ["a clinic name instead of its id", { ...VISIT, clinicId: "Cyclades Vets (George Maragkos)" }],
    ["no clinic", { did: ["sterilised"], costEur: 55, paidBy: "syros_cats" }],
    ["a cost of -1", { ...VISIT, costEur: -1 }],
    ["a cost of 2000.001", { ...VISIT, costEur: 2000.001 }],
    ["a cost with three decimals", { ...VISIT, costEur: 55.555 }],
    ["a cost as text", { ...VISIT, costEur: "55" }],
    ["no cost key at all", { did: ["sterilised"], clinicId: "symviosis", paidBy: "syros_cats" }],
    ["an unknown payer", { ...VISIT, paidBy: "the_mayor" }],
    ["no payer", { did: ["sterilised"], clinicId: "symviosis", costEur: 55 }],
    ["a note of 501 characters", { ...VISIT, note: "x".repeat(501) }],
    ["an unknown key", { ...VISIT, date: "2026-08-13" }],
    ["a stray retracted key", { ...VISIT, retracted: true }],
    ["not an object", "sterilised"],
  ])("refuses %s", async (_label, value) => {
    const cat = await insertCat();
    await expect(write(cat.id, "vet_visit", value)).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
    expect(await rowsFor(cat.id)).toHaveLength(0);
  });

  it.each(["guardian", "public", "system"] as const)("refuses a %s writer", async (who) => {
    const cat = await insertCat();
    await expect(write(cat.id, "vet_visit", VISIT, who)).rejects.toMatchObject({
      code: "ROLE_NOT_ALLOWED_FOR_KIND",
    });
    expect(await rowsFor(cat.id)).toHaveLength(0);
  });
});

describe("sterilised and vaccinated: every existing shape is still accepted", () => {
  // The shapes observations.test.ts and the team's routes write today.
  it.each([
    ["sterilised", { sterilised: true }],
    ["sterilised", { sterilised: false }],
    ["sterilised", { sterilised: true, reason: "seen at the clinic" }],
    ["sterilised", { sterilised: true, clinic: "Symviosis", reason: "op on 3 Aug" }],
    ["vaccinated", { vaccines: ["rabies"] }],
    ["vaccinated", { vaccines: ["rabies", "cat_flu_enteritis", { other: "FeLV" }], clinic: "x".repeat(120) }],
  ] as const)("accepts %s %j", async (kind, value) => {
    const cat = await insertCat();
    const row = await write(cat.id, kind, value);
    expect(row.kind).toBe(kind);
  });
});

describe("the visit link (vetVisitId)", () => {
  it.each(["sterilised", "vaccinated"] as const)(
    "accepts a %s row linked to a standing visit on the same cat",
    async (kind) => {
      const cat = await insertCat();
      const visit = await write(cat.id, "vet_visit", VISIT);
      const value =
        kind === "sterilised"
          ? { sterilised: true, clinic: "Symviosis", vetVisitId: visit.id, reason: "vet visit" }
          : { vaccines: ["rabies"], clinic: "Symviosis", vetVisitId: visit.id };
      const row = await write(cat.id, kind, value, "staff", FROM_VISIT);
      expect((row.value as { vetVisitId: number }).vetVisitId).toBe(visit.id);
    },
  );

  it.each(["sterilised", "vaccinated"] as const)("refuses a %s link to another cat's visit", async (kind) => {
    const cat = await insertCat();
    const other = await insertCat();
    const visit = await write(other.id, "vet_visit", VISIT);
    const value =
      kind === "sterilised" ? { sterilised: true, vetVisitId: visit.id } : { vaccines: ["rabies"], vetVisitId: visit.id };
    await expect(write(cat.id, kind, value, "staff", FROM_VISIT)).rejects.toMatchObject({ code: "INVALID_VISIT_LINK" });
    expect(await rowsFor(cat.id)).toHaveLength(0);
  });

  it("only a visit's own save may link a statement to it (review F1)", async () => {
    // Undoing a visit retracts every row carrying its id, so a row written
    // any other way must never carry one.
    const cat = await insertCat();
    const visit = await write(cat.id, "vet_visit", VISIT);
    for (const kind of ["sterilised", "vaccinated"] as const) {
      const value = kind === "sterilised" ? { sterilised: true, vetVisitId: visit.id } : { vaccines: ["rabies"], vetVisitId: visit.id };
      await expect(write(cat.id, kind, value)).rejects.toMatchObject({ code: "INVALID_VISIT_LINK" });
    }
    // A cat guardian's own statement, even with the flag.
    await expect(
      write(cat.id, "sterilised", { sterilised: false, vetVisitId: visit.id }, "guardian", FROM_VISIT),
    ).rejects.toMatchObject({ code: "INVALID_VISIT_LINK" });
    expect((await rowsFor(cat.id)).map((o) => o.kind)).toEqual(["vet_visit"]);
  });

  it("refuses a link to a row that isn't a visit, or to no row at all", async () => {
    const cat = await insertCat();
    const note = await write(cat.id, "team_note", { text: "not a visit" });
    for (const vetVisitId of [note.id, 2_000_000_000]) {
      await expect(write(cat.id, "sterilised", { sterilised: true, vetVisitId }, "staff", FROM_VISIT)).rejects.toMatchObject({
        code: "INVALID_VISIT_LINK",
      });
    }
  });

  it("refuses a link to a visit that has been undone", async () => {
    const cat = await insertCat();
    const visit = await write(cat.id, "vet_visit", VISIT);
    await write(cat.id, "vet_visit", { retracted: true, reason: "wrong cat" }, "staff", {
      supersedesId: visit.id,
      fromVisitUndo: true,
    });
    await expect(
      write(cat.id, "sterilised", { sterilised: true, vetVisitId: visit.id }, "staff", FROM_VISIT),
    ).rejects.toMatchObject({ code: "INVALID_VISIT_LINK" });
  });

  it.each([
    ["a string", "12"],
    ["zero", 0],
    ["a fraction", 1.5],
    ["null", null],
  ])("refuses a vetVisitId that is %s", async (_label, vetVisitId) => {
    const cat = await insertCat();
    await expect(write(cat.id, "sterilised", { sterilised: true, vetVisitId })).rejects.toMatchObject({
      code: "MALFORMED_VALUE",
    });
  });
});

describe("retractions of sterilised, vaccinated and vet_visit", () => {
  /** A cat with one row of each kind, written by the team. */
  async function seeded() {
    const cat = await insertCat();
    const visit = await write(cat.id, "vet_visit", { ...VISIT, did: ["sterilised", "vaccinated"], vaccines: ["rabies"] });
    const sterilised = await write(cat.id, "sterilised", { sterilised: true, vetVisitId: visit.id }, "staff", FROM_VISIT);
    const vaccinated = await write(cat.id, "vaccinated", { vaccines: ["rabies"], vetVisitId: visit.id }, "staff", FROM_VISIT);
    return { cat, rows: { vet_visit: visit, sterilised, vaccinated } };
  }

  it.each(["sterilised", "vaccinated", "vet_visit"] as const)(
    "a vet-visit undo may retract %s",
    async (kind) => {
      const { cat, rows } = await seeded();
      const row = await write(cat.id, kind, { retracted: true, reason: "wrong cat" }, "staff", {
        supersedesId: rows[kind].id,
        fromVisitUndo: true,
      });
      expect(row.supersedesId).toBe(rows[kind].id);
    },
  );

  it.each(["sterilised", "vaccinated", "vet_visit"] as const)(
    "without fromVisitUndo, a %s retraction is refused and nothing is written",
    async (kind) => {
      const { cat, rows } = await seeded();
      const before = (await rowsFor(cat.id)).length;
      await expect(
        write(cat.id, kind, { retracted: true, reason: "wrong" }, "staff", { supersedesId: rows[kind].id }),
      ).rejects.toMatchObject({ code: "RETRACTION_NOT_ALLOWED" });
      // Not even as a fresh statement with no target.
      await expect(write(cat.id, kind, { retracted: true, reason: "wrong" })).rejects.toMatchObject({
        code: "RETRACTION_NOT_ALLOWED",
      });
      expect(await rowsFor(cat.id)).toHaveLength(before);
    },
  );

  it("refuses a retraction whose target is another cat's row", async () => {
    const { rows } = await seeded();
    const other = await insertCat();
    await expect(
      write(other.id, "sterilised", { retracted: true, reason: "x" }, "staff", {
        supersedesId: rows.sterilised.id,
        fromVisitUndo: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RETRACTION" });
    expect(await rowsFor(other.id)).toHaveLength(0);
  });

  it("refuses a retraction whose target is another kind", async () => {
    const { cat, rows } = await seeded();
    for (const [kind, target] of [
      ["sterilised", rows.vaccinated],
      ["vaccinated", rows.vet_visit],
      ["vet_visit", rows.sterilised],
    ] as const) {
      await expect(
        write(cat.id, kind, { retracted: true, reason: "x" }, "staff", {
          supersedesId: target.id,
          fromVisitUndo: true,
        }),
      ).rejects.toMatchObject({ code: "INVALID_RETRACTION" });
    }
  });

  it("refuses a retraction with no target, or a missing one", async () => {
    const cat = await insertCat();
    await expect(
      write(cat.id, "sterilised", { retracted: true, reason: "x" }, "staff", { fromVisitUndo: true }),
    ).rejects.toMatchObject({ code: "INVALID_RETRACTION" });
    await expect(
      write(cat.id, "sterilised", { retracted: true, reason: "x" }, "staff", {
        supersedesId: 2_000_000_000,
        fromVisitUndo: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RETRACTION" });
  });

  it("refuses a retraction of a retraction (the re-do path is not built)", async () => {
    const { cat, rows } = await seeded();
    const r = await write(cat.id, "sterilised", { retracted: true, reason: "x" }, "staff", {
      supersedesId: rows.sterilised.id,
      fromVisitUndo: true,
    });
    await expect(
      write(cat.id, "sterilised", { retracted: true, reason: "y" }, "staff", {
        supersedesId: r.id,
        fromVisitUndo: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RETRACTION" });
  });

  it("refuses a retraction of a row a correction already replaced (review F2)", async () => {
    // Her "no" G, overruled by the visit's yes Y, which the team then
    // corrected (Z). Retracting Y now would stand G up next to Z.
    const cat = await insertCat();
    const no = await write(cat.id, "sterilised", { sterilised: false }, "guardian");
    const visit = await write(cat.id, "vet_visit", VISIT);
    const yes = await write(cat.id, "sterilised", { sterilised: true, vetVisitId: visit.id }, "staff", {
      ...FROM_VISIT,
      supersedesId: no.id,
    });
    await write(cat.id, "sterilised", { sterilised: true, reason: "clinic record" }, "staff", { supersedesId: yes.id });
    const before = (await rowsFor(cat.id)).length;
    await expect(
      write(cat.id, "sterilised", { retracted: true, reason: "undo" }, "staff", {
        supersedesId: yes.id,
        fromVisitUndo: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RETRACTION" });
    expect(await rowsFor(cat.id)).toHaveLength(before);
  });

  it("refuses a new value written over a retraction", async () => {
    const { cat, rows } = await seeded();
    const r = await write(cat.id, "sterilised", { retracted: true, reason: "x" }, "staff", {
      supersedesId: rows.sterilised.id,
      fromVisitUndo: true,
    });
    await expect(
      write(cat.id, "sterilised", { sterilised: true }, "staff", { supersedesId: r.id }),
    ).rejects.toMatchObject({ code: "INVALID_SUPERSESSION" });
  });

  it("only the team may retract these kinds, even with fromVisitUndo", async () => {
    const cat = await insertCat();
    const hers = await write(cat.id, "sterilised", { sterilised: false }, "guardian");
    await expect(
      write(cat.id, "sterilised", { retracted: true, reason: "x" }, "guardian", {
        supersedesId: hers.id,
        fromVisitUndo: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RETRACTION" });
  });

  it.each([
    ["no reason", { retracted: true }],
    ["a blank reason", { retracted: true, reason: "  " }],
    ["a reason of 501 characters", { retracted: true, reason: "x".repeat(501) }],
    ["a value beside it", { retracted: true, reason: "x", sterilised: true }],
    ["retracted not exactly true", { retracted: "yes", reason: "x" }],
  ])("refuses a malformed retraction: %s", async (_label, value) => {
    const { cat, rows } = await seeded();
    await expect(
      write(cat.id, "sterilised", value, "staff", { supersedesId: rows.sterilised.id, fromVisitUndo: true }),
    ).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
  });
});
