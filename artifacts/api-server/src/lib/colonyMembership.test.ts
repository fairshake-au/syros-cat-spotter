import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { catsTable, db, observationsTable, photosTable, pool } from "@workspace/db";
import { catsByColony, catsInColony, currentColonyOf } from "./colonyMembership";

// SYC-209 PR 2.1, "Counts": the one rule for which colony a cat is in
// (plan Slice 2; spec §2.8). The newest active `colony` statement stands:
// newest by observedAt, ties to the higher id, ignoring statements marked
// wrong (superseded) and redacted ones; `colonyId: null` means none.

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-cm-${RUN}-`;
const at = (iso: string) => new Date(iso);
// Plain numbers: a `colony` statement holds a colony's id, nothing links to it.
const A = 9_001;
const B = 9_002;

let photoId: number;
let n = 0;

beforeAll(async () => {
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}photo`, data: "ZmFrZQ==", mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  photoId = p!.id;
});

afterAll(async () => {
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
  await pool.end();
});

async function newCat(): Promise<number> {
  n += 1;
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}cat-${n}`,
      primaryPhotoId: photoId,
      lat: 37.445,
      lng: 24.942,
      discovererDeviceId: `${PREFIX}device`,
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

async function said(
  catId: number,
  colonyId: number | null,
  observedAt: string,
  extra: Partial<typeof observationsTable.$inferInsert> = {},
): Promise<number> {
  const [row] = await db
    .insert(observationsTable)
    .values({
      catId,
      kind: "colony",
      value: { colonyId },
      accountId: `${PREFIX}person`,
      roleAtTime: "staff",
      observedAt: at(observedAt),
      ...extra,
    })
    .returning({ id: observationsTable.id });
  return row!.id;
}

describe("currentColonyOf", () => {
  it("a cat with no colony statement is in no colony", async () => {
    const cat = await newCat();
    expect((await currentColonyOf([cat])).has(cat)).toBe(false);
  });

  it("A then B: the newest statement stands", async () => {
    const cat = await newCat();
    await said(cat, A, "2026-09-01T10:00:00Z");
    await said(cat, B, "2026-09-02T10:00:00Z");
    expect((await currentColonyOf([cat])).get(cat)).toBe(B);
  });

  it("is decided by when it was true, not by the order it was written", async () => {
    const cat = await newCat();
    await said(cat, B, "2026-09-02T10:00:00Z");
    await said(cat, A, "2026-09-01T10:00:00Z"); // written later, true earlier
    expect((await currentColonyOf([cat])).get(cat)).toBe(B);
  });

  it("two statements at the same moment: the higher id stands", async () => {
    const cat = await newCat();
    await said(cat, A, "2026-09-02T10:00:00Z");
    await said(cat, B, "2026-09-02T10:00:00Z");
    expect((await currentColonyOf([cat])).get(cat)).toBe(B);
  });

  it("a statement marked wrong stops counting, and the next newest stands", async () => {
    const cat = await newCat();
    await said(cat, A, "2026-09-01T10:00:00Z");
    const wrong = await said(cat, B, "2026-09-03T10:00:00Z");
    // The correction, dated before the statement it replaces (the form lets
    // the team date a correction), so the superseded one is still the
    // newest by date and only supersession puts the cat back in A.
    await said(cat, A, "2026-09-02T10:00:00Z", {
      supersedesId: wrong,
      supersedeReason: "that was another cat",
    });
    expect((await currentColonyOf([cat])).get(cat)).toBe(A);
  });

  it("a statement marked wrong with nothing before it leaves the cat in no colony", async () => {
    const cat = await newCat();
    const wrong = await said(cat, B, "2026-09-03T10:00:00Z");
    await said(cat, null, "2026-09-02T10:00:00Z", {
      supersedesId: wrong,
      supersedeReason: "never true",
    });
    expect((await currentColonyOf([cat])).has(cat)).toBe(false);
  });

  it("'in no colony' stands when it is the newest, and the earlier one stays in the record", async () => {
    const cat = await newCat();
    await said(cat, A, "2026-09-01T10:00:00Z");
    await said(cat, null, "2026-09-02T10:00:00Z");
    expect((await currentColonyOf([cat])).has(cat)).toBe(false);
    // …and a later move puts it back in a colony.
    await said(cat, B, "2026-09-03T10:00:00Z");
    expect((await currentColonyOf([cat])).get(cat)).toBe(B);
  });

  it("a redacted statement does not count", async () => {
    const cat = await newCat();
    await said(cat, A, "2026-09-01T10:00:00Z");
    const redacted = await said(cat, B, "2026-09-02T10:00:00Z");
    await db
      .update(observationsTable)
      .set({ redactedAt: new Date(), redactionReason: "test", accountId: null, deviceId: null })
      .where(eq(observationsTable.id, redacted));
    expect((await currentColonyOf([cat])).get(cat)).toBe(A);
  });

  it("other kinds of statement are ignored, and an empty list asks about nobody", async () => {
    const cat = await newCat();
    await db.insert(observationsTable).values({
      catId: cat,
      kind: "note",
      value: { text: "hello" },
      accountId: `${PREFIX}person`,
      roleAtTime: "staff",
      observedAt: at("2026-09-05T10:00:00Z"),
    });
    expect((await currentColonyOf([cat])).has(cat)).toBe(false);
    expect((await currentColonyOf([])).size).toBe(0);
  });

  it("asks about the cats it is given, and catsByColony groups every cat", async () => {
    const one = await newCat();
    const two = await newCat();
    await said(one, A, "2026-09-01T10:00:00Z");
    await said(two, B, "2026-09-01T10:00:00Z");
    const only = await currentColonyOf([one]);
    expect([...only.keys()]).toEqual([one]);
    const grouped = await catsByColony();
    expect(grouped.get(A)).toContain(one);
    expect(grouped.get(B)).toContain(two);
    expect(grouped.get(A)).not.toContain(two);
  });
});

// SYC-307: the one-colony page reads only its own colony's cats. It must give
// exactly the cats the whole-island grouping gives for that colony.
describe("catsInColony agrees with catsByColony", () => {
  const C = 9_003;
  const D = 9_004;

  it("moved, marked-wrong, redacted and 'in no colony' cats come out the same", async () => {
    const stays = await newCat();
    const moved = await newCat();
    const movedBack = await newCat();
    const wrong = await newCat();
    const redacted = await newCat();
    const none = await newCat();
    await said(stays, C, "2026-09-01T10:00:00Z");
    await said(moved, C, "2026-09-01T10:00:00Z");
    await said(moved, D, "2026-09-02T10:00:00Z");
    await said(movedBack, D, "2026-09-01T10:00:00Z");
    await said(movedBack, C, "2026-09-02T10:00:00Z");
    const mistake = await said(wrong, C, "2026-09-01T10:00:00Z");
    await said(wrong, D, "2026-09-02T10:00:00Z", { supersedesId: mistake });
    const gone = await said(redacted, C, "2026-09-01T10:00:00Z");
    await db
      .update(observationsTable)
      .set({ redactedAt: new Date(), redactionReason: "test", accountId: null, deviceId: null })
      .where(eq(observationsTable.id, gone));
    await said(none, C, "2026-09-01T10:00:00Z");
    await said(none, null, "2026-09-02T10:00:00Z");

    const all = await catsByColony();
    for (const colony of [C, D]) {
      expect((await catsInColony(colony)).sort()).toEqual([...(all.get(colony) ?? [])].sort());
    }
    expect((await catsInColony(C)).sort()).toEqual([stays, movedBack].sort());
    expect((await catsInColony(D)).sort()).toEqual([moved, wrong].sort());
  });
});

// SYC-199: "at most one correction per statement" is a database rule.
describe("observations.supersedes_id is unique", () => {
  it("refuses a second correction of the same statement", async () => {
    const cat = await newCat();
    const first = await said(cat, A, "2026-09-01T10:00:00Z");
    await said(cat, B, "2026-09-02T10:00:00Z", { supersedesId: first });
    await expect(said(cat, A, "2026-09-03T10:00:00Z", { supersedesId: first })).rejects.toMatchObject({
      cause: { code: "23505" },
    });
  });
});
