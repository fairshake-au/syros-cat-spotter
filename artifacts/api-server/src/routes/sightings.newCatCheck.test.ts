import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import { catsTable, db, deviceCredentialsTable, duplicateReportsTable, pool, profilesTable, sightingMatchesTable, sightingsTable } from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { moveKit, tag } from "../test/moveKit";
import { libMerge } from "../test/merges";
import { listDuplicates } from "../lib/duplicateList";
import { writeNewCatChecks } from "../lib/newCatCheck";

// SYC-59 PR 5.1 (which-cat-is-which.md §3.1 item 2, §9.6): resolving a spot
// as "New cat" writes one `new_cat_check` report for each suggestion at or
// above 0.4 that the spotter passed over. It never blocks the spotter, and
// it is never the spotter saying "same cat". Cat names are letters only.

const kit = moveKit("VitestNewCatCheck");
const SECRET = "vitest-newcatcheck-secret-0123456789abcd";

beforeAll(kit.cleanup);
afterAll(async () => {
  await kit.cleanup();
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${kit.devicePrefix}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${kit.devicePrefix}%`));
  await pool.end();
});

/** A pending spot with the suggestions the photo check stored for it. */
async function pendingSpot(suggested: { catId: number; rank: number; score: number }[] | null, matcherFailed = false) {
  const device = kit.device();
  const photoId = await kit.photo();
  const [s] = await db.insert(sightingsTable).values({ deviceId: device, photoId, lat: 37.4441, lng: 24.9412, status: "pending" }).returning();
  await db.insert(sightingMatchesTable).values({ sightingId: s!.id, suggested, matcherFailed, comparedCatIds: suggested?.map((x) => x.catId) ?? [], matchedAt: new Date() });
  return { sightingId: s!.id, device };
}

const resolveAsNew = (sightingId: number, device: string, name = `VitestNewCatCheck${tag()}x`) =>
  request(app).post(`/api/sightings/${sightingId}/resolve`).set("X-Device-Secret", SECRET).send({ deviceId: device, newCatName: name });
const reportsFor = (sightingId: number) => db.select().from(duplicateReportsTable).where(eq(duplicateReportsTable.sightingId, sightingId));

describe("resolve with 'New cat' (spec §9.6, new cat check)", () => {
  it("writes a report for each suggestion at or above 0.4, and none below", async () => {
    const [near, alike, weak] = [await kit.cat(), await kit.cat(), await kit.cat()];
    const { sightingId, device } = await pendingSpot([
      { catId: near, rank: 1, score: 0.82 },
      { catId: alike, rank: 2, score: 0.4 },
      { catId: weak, rank: 3, score: 0.39 },
    ]);
    const res = await resolveAsNew(sightingId, device);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const newCat = res.body.cat?.id ?? res.body.catId;
    const rows = await reportsFor(sightingId);
    expect(rows.map((r) => [r.catLow === newCat ? r.catHigh : r.catLow, r.score]).sort((x, y) => x[0]! - y[0]!)).toEqual(
      [
        [near, 0.82],
        [alike, 0.4],
      ].sort((x, y) => x[0]! - y[0]!),
    );
    for (const r of rows) {
      expect(r).toMatchObject({ source: "new_cat_check", says: "not_sure", deviceId: device, sightingId });
      expect(r.catLow).toBeLessThan(r.catHigh);
      expect([r.catLow, r.catHigh]).toContain(newCat);
    }
    // Possible, never Likely, and on the list: the new cat and a suggestion.
    const listed = (await listDuplicates()).filter((p) => rows.some((r) => r.catLow === p.low && r.catHigh === p.high));
    expect(listed).toHaveLength(2);
    expect(listed.every((p) => p.level === "possible")).toBe(true);
  });

  it("writes nothing when nothing was suggested, when the check failed, or when the spotter chose a suggested cat", async () => {
    const none = await pendingSpot([]);
    expect((await resolveAsNew(none.sightingId, none.device)).status).toBe(200);
    expect(await reportsFor(none.sightingId)).toEqual([]);

    const failed = await pendingSpot(null, true);
    expect((await resolveAsNew(failed.sightingId, failed.device)).status).toBe(200);
    expect(await reportsFor(failed.sightingId)).toEqual([]);

    const cat = await kit.cat();
    const chosen = await pendingSpot([{ catId: cat, rank: 1, score: 0.9 }]);
    const res = await request(app).post(`/api/sightings/${chosen.sightingId}/resolve`).set("X-Device-Secret", SECRET).send({ deviceId: chosen.device, catId: cat });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await reportsFor(chosen.sightingId)).toEqual([]);
  });

  it("a suggestion for a cat since merged away is reported against the cat it is part of now", async () => {
    const [mimi, agatha] = [await kit.cat(), await kit.cat()];
    await kit.sighting(mimi, kit.device());
    await libMerge(mimi, agatha);
    const { sightingId, device } = await pendingSpot([{ catId: mimi, rank: 1, score: 0.7 }]);
    expect((await resolveAsNew(sightingId, device)).status).toBe(200);
    const rows = await reportsFor(sightingId);
    expect(rows).toHaveLength(1);
    expect([rows[0]!.catLow, rows[0]!.catHigh]).toContain(agatha);
    expect([rows[0]!.catLow, rows[0]!.catHigh]).not.toContain(mimi);
  });

  it("writeNewCatChecks keeps the best score per cat and skips the new cat itself", async () => {
    const [a, fresh] = [await kit.cat(), await kit.cat()];
    const s = await kit.sighting(fresh, kit.device());
    const n = await writeNewCatChecks({
      sightingId: s.id,
      deviceId: s.deviceId,
      newCatId: fresh,
      suggested: [
        { catId: a, rank: 1, score: 0.5 },
        { catId: a, rank: 2, score: 0.6 },
        { catId: fresh, rank: 3, score: 0.9 },
      ],
    });
    expect(n).toBe(1);
    const rows = await reportsFor(s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBeCloseTo(0.6);
    expect((await db.select().from(catsTable).where(eq(catsTable.id, fresh))).length).toBe(1);
  });
});
