import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import { db, deviceCredentialsTable, pool, profilesTable, sightingMatchesTable, sightingsTable } from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));
// The new-cat check blows up: the spotter's resolve must still succeed.
vi.mock("../lib/newCatCheck", () => ({ writeNewCatChecks: vi.fn().mockRejectedValue(new Error("vitest: check down")) }));

import app from "../app";
import { moveKit, tag } from "../test/moveKit";
import { libMerge } from "../test/merges";
import { decidePair } from "../lib/duplicateDecide";

// SYC-59 PR 5.1 (found in review): a failing new-cat check never fails the spotter's save, and the team's answers on merged-away cats.
const kit = moveKit("VitestNewCatFail");
const SECRET = "vitest-newcatcheck-secret-0123456789abcd";

beforeAll(kit.cleanup);
afterAll(async () => {
  await kit.cleanup();
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${kit.devicePrefix}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${kit.devicePrefix}%`));
  await pool.end();
});

describe("the new-cat check never blocks the resolve", () => {
  it("a throwing new-cat check still gives the spotter their new cat", async () => {
    const other = await kit.cat();
    const device = kit.device();
    const photoId = await kit.photo();
    const [s] = await db.insert(sightingsTable).values({ deviceId: device, photoId, lat: 37.4441, lng: 24.9412, status: "pending" }).returning();
    await db.insert(sightingMatchesTable).values({ sightingId: s!.id, suggested: [{ catId: other, rank: 1, score: 0.9 }], matcherFailed: false, comparedCatIds: [other], matchedAt: new Date() });
    const res = await request(app).post(`/api/sightings/${s!.id}/resolve`).set("X-Device-Secret", SECRET).send({ deviceId: device, newCatName: `VitestNewCatFail${tag()}x` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [after] = await db.select().from(sightingsTable).where(eq(sightingsTable.id, s!.id));
    expect(after!.status).toBe("resolved");
  });
});

describe("the decide answer", () => {
  it("documents: a pair that was never reported can be decided 'different'", async () => {
    const [a, b] = [await kit.cat(), await kit.cat()];
    const r = await decidePair({ id: "vitest-review" }, { a, b, decision: "different" });
    expect(r.ok).toBe(true);
  });

  it("documents: deciding about a merged-away cat lands on the cat it is part of now; the merged pair itself is refused", async () => {
    const [mimi, agatha, dora] = [await kit.cat(), await kit.cat(), await kit.cat()];
    await kit.sighting(mimi, kit.device());
    await libMerge(mimi, agatha);
    const r = await decidePair({ id: "vitest-review" }, { a: mimi, b: dora, decision: "different" });
    expect(r).toMatchObject({ ok: true, low: Math.min(agatha, dora), high: Math.max(agatha, dora) });
    const mimiAgatha = await decidePair({ id: "vitest-review" }, { a: mimi, b: agatha, decision: "different" });
    expect(mimiAgatha.ok).toBe(false);
  });
});
