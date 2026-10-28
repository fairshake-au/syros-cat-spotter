import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { catsTable, db, duplicateDecisionsTable, duplicateReportsTable, photosTable, pool } from "@workspace/db";
import { daysAgo, moveKit, tag } from "../test/moveKit";
import { libMerge, libUndo } from "../test/merges";
import { FADE_DAYS, ladder, listDuplicates, reopens, syrosDay, type ListedReport } from "./duplicateList";

// SYC-59 PR 5.1 (which-cat-is-which.md §3.2, §3.3, §9.6; spec tests 24 and
// 25): the ladder, the reopen rule and the 60-day fade, worked out on read
// from the add-only reports and decisions. Cat names are letters only
// (SYC-709). A "counting phone" is three resolved sightings on three
// different Syros days; a "new phone" is any other.

const kit = moveKit("VitestDupList");

beforeAll(kit.cleanup);
afterAll(async () => {
  await kit.cleanup();
  await pool.end();
});

/** Noon UTC, `back` days ago: 15:00 in Athens, so the same Syros day an hour later too. */
const noon = (back: number) => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return new Date(d.getTime() - back * 86_400_000);
};
const hourAfter = (d: Date) => new Date(d.getTime() + 3_600_000);

async function pair() {
  const [a, b] = [await kit.cat(), await kit.cat()];
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

/** A phone with three resolved spots on three different days: it counts as a person. */
async function countingPhone(): Promise<string> {
  const device = kit.device();
  const spare = await kit.cat();
  for (const n of [3, 4, 5]) await kit.sighting(spare, device, daysAgo(n));
  return device;
}
/** A phone with one resolved spot: it does not count yet. */
async function newPhone(): Promise<string> {
  const device = kit.device();
  await kit.sighting(await kit.cat(), device, daysAgo(2));
  return device;
}

type Over = Partial<typeof duplicateReportsTable.$inferInsert>;
const report = (p: { lo: number; hi: number }, over: Over) =>
  db.insert(duplicateReportsTable).values({ catLow: p.lo, catHigh: p.hi, source: "spotter_question", says: "same", ...over });
const decide = (p: { lo: number; hi: number }, decision: string, createdAt: Date, note: string | null = null) =>
  db.insert(duplicateDecisionsTable).values({ catLow: p.lo, catHigh: p.hi, decision, createdAt, note, byAccountId: "vitest-dupdecider", ...(decision === "merged" ? { mergeId: 1 } : {}) });
const find = async (p: { lo: number; hi: number }) => (await listDuplicates()).find((x) => x.low === p.lo && x.high === p.hi);
const said = (p: { lo: number; hi: number }, deviceId: string, createdAt: Date) => report(p, { deviceId, createdAt });

describe("the ladder (spec test 25)", () => {
  it("one 'Are these the same cat?' answer stays Possible, even from a counting phone", async () => {
    const p = await pair();
    await said(p, await countingPhone(), noon(2));
    expect((await find(p))?.level).toBe("possible");
  });

  it("two counting phones on different Syros days make it Likely; on the same day they do not", async () => {
    const likely = await pair();
    await said(likely, await countingPhone(), noon(3));
    await said(likely, await countingPhone(), noon(2));
    expect((await find(likely))?.level).toBe("likely");

    const sameDay = await pair();
    await said(sameDay, await countingPhone(), noon(2));
    await said(sameDay, await countingPhone(), hourAfter(noon(2)));
    expect((await find(sameDay))?.level).toBe("possible");

    const onePhone = await pair();
    const phone = await countingPhone();
    await said(onePhone, phone, noon(3));
    await said(onePhone, phone, noon(2));
    expect((await find(onePhone))?.level).toBe("possible");
  });

  it("new phones never make Likely, however many and however they agree", async () => {
    const p = await pair();
    for (const back of [4, 3, 2, 1]) await said(p, await newPhone(), noon(back));
    expect((await find(p))?.level).toBe("possible");
    // With a sweep report on top: still not Likely, since no counting phone said it.
    await report(p, { source: "sweep", says: "same", deviceId: null, score: 0.9, createdAt: noon(1) });
    expect((await find(p))?.level).toBe("possible");
    // One counting phone and one new phone: one person's word, so Possible.
    const mixed = await pair();
    await said(mixed, await countingPhone(), noon(3));
    await said(mixed, await newPhone(), noon(2));
    expect((await find(mixed))?.level).toBe("possible");
  });

  it("a new phone's report still shows on the row, marked as a new phone", async () => {
    const p = await pair();
    const phone = await newPhone();
    await said(p, phone, noon(2));
    const row = await find(p);
    expect(row?.newPhones.has(phone)).toBe(true);
    const counting = await pair();
    const person = await countingPhone();
    await said(counting, person, noon(2));
    expect((await find(counting))?.newPhones.has(person)).toBe(false);
  });

  it("one 'same' from a counting phone plus a sweep report is Likely; a game report is Likely on its own", async () => {
    const sweep = await pair();
    await said(sweep, await countingPhone(), noon(3));
    await report(sweep, { source: "sweep", says: "same", deviceId: null, score: 0.8, createdAt: noon(2) });
    expect((await find(sweep))?.level).toBe("likely");

    const sweepOnly = await pair();
    await report(sweepOnly, { source: "sweep", says: "same", deviceId: null, score: 0.8, createdAt: noon(2) });
    expect((await find(sweepOnly))?.level).toBe("possible");

    const game = await pair();
    await report(game, { source: "game", says: "same", deviceId: null, createdAt: noon(2) });
    expect((await find(game))?.level).toBe("likely");
  });

  it("a 'different' or 'not sure' answer alone puts nothing on the list, and never lowers a pair", async () => {
    const alone = await pair();
    await report(alone, { deviceId: await countingPhone(), says: "different", createdAt: noon(2) });
    await report(alone, { deviceId: await countingPhone(), says: "not_sure", createdAt: noon(2) });
    expect(await find(alone)).toBeUndefined();

    const p = await pair();
    await said(p, await countingPhone(), noon(4));
    await said(p, await countingPhone(), noon(3));
    await report(p, { deviceId: await countingPhone(), says: "different", createdAt: noon(2) });
    expect((await find(p))?.level).toBe("likely");
  });

  it("a new-cat check puts the pair on the list as Possible, and never counts towards Likely", async () => {
    const p = await pair();
    for (const back of [4, 3]) await report(p, { source: "new_cat_check", says: "not_sure", deviceId: await countingPhone(), score: 0.6, createdAt: noon(back) });
    expect((await find(p))?.level).toBe("possible");
  });

  it("ladder() on plain reports: the counting set decides, not the report", () => {
    const r = (id: number, deviceId: string, createdAt: Date): ListedReport => ({ id, source: "spotter_question", says: "same", deviceId, redacted: false, sightingId: null, score: null, createdAt });
    const two = [r(1, "a", noon(3)), r(2, "b", noon(2))];
    expect(ladder(two, new Set(["a", "b"]))).toBe("likely");
    expect(ladder(two, new Set(["a"]))).toBe("possible");
    expect(ladder(two, new Set())).toBe("possible");
    expect(syrosDay(noon(2))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("a deleted spotter's cleared reports still count as evidence, and together as one voice", async () => {
    const p = await pair();
    await report(p, { deviceId: null, redactedAt: noon(1), createdAt: noon(4) });
    await report(p, { deviceId: null, redactedAt: noon(1), createdAt: noon(3) });
    expect((await find(p))?.level).toBe("possible");
    await said(p, await countingPhone(), noon(2));
    expect((await find(p))?.level).toBe("likely");
  });
});

describe("the reopen rule (spec test 25, §9.6)", () => {
  it("a 'different' decision takes the pair off the list, and old evidence does not bring it back", async () => {
    const p = await pair();
    await said(p, await countingPhone(), noon(14));
    await said(p, await countingPhone(), noon(13));
    expect((await find(p))?.level).toBe("likely");
    await decide(p, "different", noon(10));
    expect(await find(p)).toBeUndefined();
    // Two more counting phones' words from BEFORE the decision change nothing.
    await said(p, await countingPhone(), noon(12));
    await said(p, await countingPhone(), noon(11));
    expect(await find(p)).toBeUndefined();
  });

  it("one new person, the same person twice, or new phones do not reopen it; two new counting people do", async () => {
    const p = await pair();
    await decide(p, "different", noon(10));
    const first = await countingPhone();
    await said(p, first, noon(5));
    expect(await find(p)).toBeUndefined();
    await said(p, first, noon(4));
    expect(await find(p)).toBeUndefined();
    await said(p, await newPhone(), noon(3));
    await said(p, await newPhone(), noon(2));
    expect(await find(p)).toBeUndefined();
    await said(p, await countingPhone(), noon(1));
    const row = await find(p);
    expect(row?.reopened).toBe(true);
    // It stands on the reports after the decision only.
    expect(row?.reports.every((r) => r.createdAt.getTime() > noon(10).getTime())).toBe(true);
  });

  it("a sweep report reopens it only after one of the cats' main photo changed since the decision", async () => {
    const p = await pair();
    await decide(p, "different", noon(10));
    await report(p, { source: "sweep", says: "same", deviceId: null, score: 0.9, createdAt: noon(5) });
    expect(await find(p)).toBeUndefined();
    const [photo] = await db
      .insert(photosTable)
      .values({ publicId: `VitestDupList${tag()}`, data: "x", mime: "image/jpeg", createdAt: noon(7) })
      .returning({ id: photosTable.id });
    await db.update(catsTable).set({ primaryPhotoId: photo!.id }).where(eq(catsTable.id, p.lo));
    expect((await find(p))?.reopened).toBe(true);
  });

  it("reopens() is the rule and nothing else", () => {
    const sweep: ListedReport = { id: 1, source: "sweep", says: "same", deviceId: null, redacted: false, sightingId: null, score: 1, createdAt: noon(1) };
    expect(reopens([sweep], new Set(), false)).toBe(false);
    expect(reopens([sweep], new Set(), true)).toBe(true);
    expect(reopens([], new Set(), true)).toBe(false);
  });

  it("'not sure yet' keeps the row, with the note, and it never fades", async () => {
    const p = await pair();
    await said(p, await countingPhone(), noon(70));
    expect(await find(p)).toBeUndefined();
    await decide(p, "not_sure", noon(65), "needs a clear face photo");
    const row = await find(p);
    expect(row?.notSure?.note).toBe("needs a clear face photo");
  });

  it("a merge takes the pair off; an undone merge starts again from reports made after the undo", async () => {
    const mimi = await kit.cat();
    const agatha = await kit.cat();
    await kit.sighting(mimi, kit.device(), daysAgo(9));
    await kit.sighting(agatha, kit.device(), daysAgo(8));
    const p = { lo: Math.min(mimi, agatha), hi: Math.max(mimi, agatha) };
    await said(p, await countingPhone(), noon(5));
    expect(await find(p)).toBeDefined();
    const merge = await libMerge(mimi, agatha);
    expect(await find(p)).toBeUndefined();
    await libUndo(merge.mergeId);
    // The old report is from before the undo: the team's change of mind is not re-argued.
    expect(await find(p)).toBeUndefined();
    await report(p, { source: "sweep", says: "same", deviceId: null, createdAt: new Date(Date.now() + 5000) });
    expect(await find(p)).toBeDefined();
  });

  it("a pair with a cat merged into a third is listed under the cat it is part of now", async () => {
    const mimi = await kit.cat();
    const agatha = await kit.cat();
    const dora = await kit.cat();
    await kit.sighting(mimi, kit.device(), daysAgo(9));
    await said({ lo: Math.min(mimi, dora), hi: Math.max(mimi, dora) }, await countingPhone(), noon(2));
    await libMerge(mimi, agatha);
    const now = { lo: Math.min(agatha, dora), hi: Math.max(agatha, dora) };
    expect(await find(now)).toBeDefined();
    expect(await find({ lo: Math.min(mimi, dora), hi: Math.max(mimi, dora) })).toBeUndefined();
  });
});

describe("rows fade from view after 60 days (§3.3)", () => {
  it("an undecided row older than 60 days is kept but not listed; a newer report brings it back", async () => {
    expect(FADE_DAYS).toBe(60);
    const p = await pair();
    await said(p, await countingPhone(), noon(61));
    expect(await find(p)).toBeUndefined();
    const stored = await db.select().from(duplicateReportsTable).where(eq(duplicateReportsTable.catLow, p.lo));
    expect(stored.length).toBe(1);
    const fresh = await pair();
    await said(fresh, await countingPhone(), noon(59));
    expect(await find(fresh)).toBeDefined();
    await said(p, await countingPhone(), noon(1));
    expect(await find(p)).toBeDefined();
  });

  it("the list is Likely first, then newest", async () => {
    const older = await pair();
    const newer = await pair();
    const likely = await pair();
    await said(older, await countingPhone(), noon(9));
    await said(newer, await countingPhone(), noon(2));
    await said(likely, await countingPhone(), noon(30));
    await said(likely, await countingPhone(), noon(29));
    const ids = (await listDuplicates()).filter((x) => [older, newer, likely].some((q) => q.lo === x.low && q.hi === x.high)).map((x) => x.low);
    expect(ids).toEqual([likely.lo, newer.lo, older.lo]);
  });
});
