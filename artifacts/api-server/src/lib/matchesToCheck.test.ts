import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { catsTable, db, markLeft, photosTable, pool, sightingMatchesTable, sightingMovesTable, sightingsTable } from "@workspace/db";
import { moveKit } from "../test/moveKit";
import { libMerge, libUndo } from "../test/merges";
import { hidePhoto, signedPerson } from "../test/roleKit";
import { markLooksRight, matchesToCheck, matchesToCheckCount } from "./matchesToCheck";
import { MoveRefused } from "./moveSightings";
import { launchMeasuresReport } from "./reports/launchMeasures";
import { parseRange } from "./reports/range";

// SYC-795 Task 9 (launch measures spec §4.6): Samuel's Matches to check list
// and its "Looks right" step. Every sighting here is dated in 2040 and the
// launch date passed in is 2040-03-01, so rows other test files make (all
// earlier) can't appear. No wall clock: dates are fixed, `now` is passed.

const settings = vi.hoisted(() => ({ launchDate: null as string | null }));
vi.mock("./appSettings", async (importOriginal) => {
  const real = await importOriginal<typeof import("./appSettings")>();
  return { ...real, getAppSettings: async () => ({ ...(await real.getAppSettings()), launchDate: settings.launchDate }) };
});

const kit = moveKit("VitestMatchCheck");
const LAUNCH = "2040-03-01";
const at = (iso: string) => new Date(iso);
const staff = { id: "vitest-match-check-staff", scopes: [{ role: "staff", colonyId: null }] };
const guardian = { id: "vitest-match-check-guardian", scopes: [{ role: "guardian", colonyId: 1 }] };
const device = () => kit.device();
let removerEmail: string | null = null;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = "vitest-matchcheck-lib-key-0123456789abcdef-0123456789";
  await kit.cleanup();
});
afterAll(async () => {
  await kit.cleanup();
  if (removerEmail) await markLeft(removerEmail, "cli:vitest");
  await pool.end();
});

/** A sighting of `cat` with a match record. */
async function suggested(cat: number, createdAt: Date, m: Partial<typeof sightingMatchesTable.$inferInsert> = {}): Promise<number> {
  const s = await kit.sighting(cat, device(), createdAt);
  await db.insert(sightingMatchesTable).values({
    sightingId: s.id,
    comparedCatIds: [cat],
    suggested: [],
    matcherFailed: false,
    matchedAt: createdAt,
    choice: "suggested",
    chosenCatId: cat,
    suggestedRank: 2,
    chosenAt: createdAt,
    noCatInAnyPhoto: false,
    ...m,
  });
  return s.id;
}

async function move(sightingId: number, reason: string, source: string, mergeId: number | null = null) {
  await db.insert(sightingMovesTable).values({
    sightingId,
    fromCatId: 1,
    toCatId: 2,
    batchId: randomUUID(),
    reason,
    source,
    mergeId,
    movedByAccountId: "vitest-match-check-mover",
    roleAtTime: "staff",
  });
}

const matchRow = async (sightingId: number) => (await db.select().from(sightingMatchesTable).where(eq(sightingMatchesTable.sightingId, sightingId)))[0]!;
const ids = (xs: { sightingId: number }[]) => xs.map((x) => x.sightingId);

describe("what is on the list (§4.6)", () => {
  it("lists only unchecked, unmoved suggestions since launch, oldest first, with the cat and its rank", async () => {
    const cat = await kit.cat();
    const later = await suggested(cat, at("2040-03-04T10:00:00Z"), { suggestedRank: 3 });
    const earlier = await suggested(cat, at("2040-03-02T10:00:00Z"), { suggestedRank: 1 });
    await suggested(cat, at("2040-02-28T10:00:00Z")); // before launch (Athens midnight 1 Mar)
    await suggested(cat, at("2040-03-03T10:00:00Z"), { teamAction: "looks_right", teamAt: at("2040-03-03T11:00:00Z"), teamByAccountId: "vitest-x" });
    const rows = await matchesToCheck(LAUNCH);
    const mine = rows.filter((r) => r.catId === cat);
    expect(ids(mine)).toEqual([earlier, later]);
    expect(mine.map((r) => r.rank)).toEqual([1, 3]);
    expect(mine[0]!.catName).toMatch(/^VitestMatchCheck/);
    expect(mine[0]!.spottedAt).toEqual(at("2040-03-02T10:00:00Z"));
    expect(mine[0]!.sightingPhotoUrl).toMatch(/^\/api\/team\/photos\/[^/]+\/card$/);
    expect(mine[0]!.catPhotoUrl).toMatch(/^\/api\/team\/photos\/[^/]+\/card$/);
    expect(await matchesToCheckCount(LAUNCH)).toBe(rows.length);
  });

  it("is empty with no launch date", async () => {
    const cat = await kit.cat();
    await suggested(cat, at("2040-03-05T10:00:00Z"));
    expect(await matchesToCheck(null)).toEqual([]);
    expect(await matchesToCheckCount(null)).toBe(0);
  });

  it("leaves out a hand pick", async () => {
    const cat = await kit.cat();
    const hand = await suggested(cat, at("2040-03-06T10:00:00Z"), { choice: "hand_pick", suggestedRank: null, missKind: "matcher_miss" });
    expect(ids(await matchesToCheck(LAUNCH))).not.toContain(hand);
  });

  it("a merge-moved sighting is still listed; a correction-moved one isn't", async () => {
    const cat = await kit.cat();
    const merged = await suggested(cat, at("2040-03-07T10:00:00Z"));
    await move(merged, "merged", "merge", 990_101);
    const undone = await suggested(cat, at("2040-03-07T11:00:00Z"));
    await move(undone, "merge_undone", "undo", 990_102);
    const corrected = await suggested(cat, at("2040-03-07T12:00:00Z"));
    await move(corrected, "wrong_pick", "cat_page");
    const listed = ids(await matchesToCheck(LAUNCH));
    expect(listed).toContain(merged);
    expect(listed).toContain(undone);
    expect(listed).not.toContain(corrected);
  });
});

describe("edges of the list", () => {
  it("leaves out a redacted sighting", async () => {
    const cat = await kit.cat();
    const s = await suggested(cat, at("2040-03-11T10:00:00Z"));
    await db.transaction(async (tx) => {
      await tx.execute(sql`alter table sightings disable trigger sightings_append_only`);
      await tx.update(sightingsTable).set({ deviceId: null, redactedAt: at("2040-03-12T10:00:00Z"), redactionReason: "test" }).where(eq(sightingsTable.id, s));
      await tx.execute(sql`alter table sightings enable trigger sightings_append_only`);
    });
    expect(ids(await matchesToCheck(LAUNCH))).not.toContain(s);
  });

  it("shows no sighting photo when that photo was removed", async () => {
    const remover = await signedPerson("matchcheckremover", ["staff"]);
    removerEmail = remover.email;
    const cat = await kit.cat();
    const s = await suggested(cat, at("2040-03-11T11:00:00Z"));
    const [row] = await db.select({ photoId: sightingsTable.photoId }).from(sightingsTable).where(eq(sightingsTable.id, s));
    await db.update(photosTable).set({ removedAt: at("2040-03-12T10:00:00Z"), removedBy: remover.id, removedReason: "test", data: null }).where(eq(photosTable.id, row!.photoId));
    const found = (await matchesToCheck(LAUNCH)).find((r) => r.sightingId === s);
    expect(found).toBeDefined();
    expect(found!.sightingPhotoUrl).toBeNull();
    expect(found!.sightingPhotoFullUrl).toBeNull();
    expect(found!.catPhotoUrl).not.toBeNull();
  });

  it("keeps the Athens launch midnight: 22:30Z the day before is in, 21:30Z is out", async () => {
    const cat = await kit.cat();
    const inside = await suggested(cat, at("2040-02-29T22:30:00Z"));
    const outside = await suggested(cat, at("2040-02-29T21:30:00Z"));
    const listed = ids(await matchesToCheck(LAUNCH));
    expect(listed).toContain(inside);
    expect(listed).not.toContain(outside);
  });

  it("shows the cat's own main photo when it is hidden, never the sighting's photo", async () => {
    const cat = await kit.cat();
    const s = await suggested(cat, at("2040-03-11T12:00:00Z"));
    const [c] = await db.select({ p: catsTable.primaryPhotoId }).from(catsTable).where(eq(catsTable.id, cat));
    await hidePhoto(c!.p);
    const own = (await db.select({ id: photosTable.publicId }).from(photosTable).where(eq(photosTable.id, c!.p)))[0]!.id;
    const found = (await matchesToCheck(LAUNCH)).find((r) => r.sightingId === s)!;
    expect(found.catPhotoUrl).toBe(`/api/team/photos/${own}/card`);
    expect(found.catPhotoUrl).not.toBe(found.sightingPhotoUrl);
  });

  it("names the cat the sighting is filed under now, after a merge is undone with the sighting ticked", async () => {
    const a = await kit.cat();
    const b = await kit.cat();
    const s = await suggested(a, at("2040-03-11T13:00:00Z"));
    await kit.sighting(a, device(), at("2040-03-11T13:30:00Z"));
    await kit.sighting(b, device(), at("2040-03-11T13:40:00Z"));
    const merged = await libMerge(a, b);
    await libUndo(merged.mergeId, [s]);
    const [now] = await db.select({ catId: sightingsTable.catId }).from(sightingsTable).where(eq(sightingsTable.id, s));
    const found = (await matchesToCheck(LAUNCH)).find((r) => r.sightingId === s);
    expect(found).toBeDefined();
    expect(found!.catId).toBe(now!.catId);
  });
});

describe("Looks right (§4.6)", () => {
  it("writes the team step once: done, then already, with team_at unchanged", async () => {
    const cat = await kit.cat();
    const s = await suggested(cat, at("2040-03-09T10:00:00Z"));
    expect(await markLooksRight(staff, s)).toBe("done");
    const first = await matchRow(s);
    expect(first).toMatchObject({ teamAction: "looks_right", teamByAccountId: staff.id, teamCatId: null });
    expect(first.teamAt).not.toBeNull();
    expect(await markLooksRight(staff, s)).toBe("already");
    expect((await matchRow(s)).teamAt).toEqual(first.teamAt);
    expect(ids(await matchesToCheck(LAUNCH))).not.toContain(s);
  });

  it("after a move filled the team step, it says already and changes nothing", async () => {
    const cat = await kit.cat();
    const s = await suggested(cat, at("2040-03-09T11:00:00Z"), {
      teamAction: "different_cat",
      teamCatId: cat,
      teamAt: at("2040-03-10T10:00:00Z"),
      teamByAccountId: "vitest-mover",
    });
    expect(await markLooksRight(staff, s)).toBe("already");
    expect((await matchRow(s)).teamAction).toBe("different_cat");
  });

  it("does nothing to a hand pick", async () => {
    const cat = await kit.cat();
    const s = await suggested(cat, at("2040-03-09T12:00:00Z"), { choice: "hand_pick", suggestedRank: null, missKind: "matcher_miss" });
    expect(await markLooksRight(staff, s)).toBe("already");
    expect((await matchRow(s)).teamAction).toBeNull();
  });

  it("is refused without move_sighting, and writes nothing", async () => {
    const cat = await kit.cat();
    const s = await suggested(cat, at("2040-03-09T13:00:00Z"));
    const err = await markLooksRight(guardian, s).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MoveRefused);
    expect((err as MoveRefused).code).toBe("NOT_AUTHORISED");
    expect((await matchRow(s)).teamAction).toBeNull();
  });

  it("looks right and then moved counts as corrected in the launch report (§4.6)", async () => {
    settings.launchDate = LAUNCH;
    const cat = await kit.cat();
    const s = await suggested(cat, at("2040-03-13T10:00:00Z"));
    expect(await markLooksRight(staff, s)).toBe("done");
    await move(s, "wrong_pick", "match_check");
    const range = parseRange({ range: "custom", from: "2040-03-12", to: "2040-03-14" }, at("2040-03-20T10:00:00Z"));
    const w = (await launchMeasuresReport(range, at("2040-03-20T10:00:00Z"))).weeks[0]!;
    expect(w.corrected).toBe(1);
    expect(w.checked).toEqual({ right: 0, total: 1 });
  });
});
