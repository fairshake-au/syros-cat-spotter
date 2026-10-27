/**
 * SYC-117 part 2 (docs/specs/add-details-later.md, approved 5 Oct 2026):
 * changing your own ear-tip answer from the cat's page (Decision 3 → B), and
 * GET /profiles/{deviceId}/cats/{catId}/open-sightings, which feeds the cat page's card.
 *
 * Runs on SYC-111's throwaway database; observations are append-only, so
 * every test uses its own devices and cats.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  observationsTable,
  photosTable,
  profilesTable,
  sightingsTable,
} from "@workspace/db";
import { and, eq, like } from "drizzle-orm";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";
import { loadCatRecords } from "../lib/observations";
import { moveSightings } from "../lib/moveSightings";
import { resolveCat } from "../lib/resolve";

const DEVICE = "vitest-addlater";
const SECRET = "vitest-addlater-secret-0123456789abcd";
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let seq = 0;
const uid = () => `${Date.now()}-${++seq}`;

async function insertPhoto(): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  return p!.id;
}

async function seedCat(): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `VitestAddLater-${uid()}`,
      description: "",
      primaryPhotoId: await insertPhoto(),
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: `${DEVICE}-seed`,
    })
    .returning();
  return c!.id;
}

/** A resolved sighting of `catId` by `device`, taken `daysAgo` days ago. */
async function sightingOf(catId: number, device: string, daysAgo = 1) {
  const [s] = await db
    .insert(sightingsTable)
    .values({
      deviceId: device,
      photoId: await insertPhoto(),
      lat: 37.44,
      lng: 24.9,
      status: "pending",
      createdAt: new Date(Date.now() - daysAgo * 86_400_000),
    })
    .returning();
  const res = await request(app)
    .post(`/api/sightings/${s!.id}/resolve`)
    .set("X-Device-Secret", SECRET)
    .send({ deviceId: device, catId });
  expect(res.status).toBe(200);
  return s!;
}

function answer(sightingId: number, deviceId: string, body: object) {
  return request(app)
    .post(`/api/sightings/${sightingId}/answers`)
    .set("X-Device-Secret", SECRET)
    .send({ deviceId, ...body });
}

function openSightings(catId: number, deviceId: string, secret = SECRET) {
  return request(app)
    .get(`/api/profiles/${deviceId}/cats/${catId}/open-sightings`)
    .set("X-Device-Secret", secret);
}

async function earTips(catId: number, device?: string) {
  const rows = await db
    .select()
    .from(observationsTable)
    .where(
      and(
        eq(observationsTable.catId, catId),
        eq(observationsTable.kind, "ear_tip"),
        ...(device ? [eq(observationsTable.deviceId, device)] : []),
      ),
    );
  return rows.sort((a, b) => a.id - b.id);
}

/** A team "that's not a clip" on `target`, written as PR 8's supersede does. */
async function teamCorrects(target: { id: number; catId: number }) {
  await db.insert(observationsTable).values({
    catId: target.catId,
    kind: "ear_tip",
    value: { clipped: false },
    accountId: "vitest-staff",
    roleAtTime: "staff",
    observedAt: new Date(),
    supersedesId: target.id,
    supersedeReason: "torn ear, not a clip",
  });
}

async function sterilisedNow(catId: number) {
  const rec = (await loadCatRecords([catId])).get(catId)!;
  return resolveCat(rec.observations, rec.evidenceOfLife, new Date()).sterilised;
}

afterAll(async () => {
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${DEVICE}%`));
  await pool.end();
});

describe("changing your own ear-tip answer (Decision 3 → B)", () => {
  it("replaces the spotter's answer, keeps the old one in the history, and the cat follows", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const first = await sightingOf(catId, device, 3);
    await answer(first.id, device, { earTip: "looks_whole" });
    expect((await sterilisedNow(catId)).confidence).toBe("unknown");

    const res = await answer(first.id, device, { earTip: "clipped_left", changeEarTip: true });
    expect(res.status).toBe(200);
    expect(res.body.recorded).toEqual(["ear_tip"]);

    const rows = await earTips(catId, device);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.supersedesId).toBe(rows[0]!.id);
    expect(rows[1]!.supersedeReason).toBe("changed by the spotter");
    expect(rows[1]!.value).toEqual({ clipped: true, side: "left" });
    expect(rows[1]!.photoId).toBe(first.photoId);
    expect(rows[1]!.observedAt.getTime()).toBe(first.createdAt.getTime());
    expect((await sterilisedNow(catId)).confidence).toBe("likely");
  });

  it("can be made from a later sighting, which then carries the new answer", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const first = await sightingOf(catId, device, 10);
    await answer(first.id, device, { earTip: "cant_tell" });
    const second = await sightingOf(catId, device, 2);
    const res = await answer(second.id, device, { earTip: "clipped_right", changeEarTip: true });
    expect(res.status).toBe(200);
    const rows = await earTips(catId, device);
    expect(rows[1]!.sightingId).toBe(second.id);
    expect(rows[1]!.supersedesId).toBe(rows[0]!.id);
  });

  it("changing to the same answer writes nothing", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const s = await sightingOf(catId, device);
    await answer(s.id, device, { earTip: "looks_whole" });
    const res = await answer(s.id, device, { earTip: "looks_whole", changeEarTip: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_ANSWERED");
    expect(await earTips(catId, device)).toHaveLength(1);
  });

  it("with no answer yet, a 'change' is just a first answer", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const s = await sightingOf(catId, device);
    const res = await answer(s.id, device, { earTip: "clipped_left", changeEarTip: true });
    expect(res.status).toBe(200);
    const rows = await earTips(catId, device);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.supersedesId).toBeNull();
  });

  it("only ever replaces the spotter's own answer, never someone else's", async () => {
    const catId = await seedCat();
    const alice = `${DEVICE}-alice-${uid()}`;
    const bob = `${DEVICE}-bob-${uid()}`;
    const a = await sightingOf(catId, alice);
    await answer(a.id, alice, { earTip: "clipped_left" });
    const b = await sightingOf(catId, bob);
    // Bob has no answer of his own: his "change" is a first answer, and
    // Alice's answer is untouched.
    expect((await answer(b.id, bob, { earTip: "looks_whole", changeEarTip: true })).status).toBe(200);
    const all = await earTips(catId);
    expect(all.every((r) => r.supersedesId == null)).toBe(true);
    expect((await sterilisedNow(catId)).confidence).toBe("likely");
  });

  it("without changeEarTip, a second ear-tip answer is still dropped (the reward screen never changes an answer)", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const s = await sightingOf(catId, device);
    await answer(s.id, device, { earTip: "looks_whole" });
    const res = await answer(s.id, device, { earTip: "clipped_left" });
    expect(res.status).toBe(409);
    expect(await earTips(catId, device)).toHaveLength(1);
  });

  it("the reward screen still never asks again after a change", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const s = await sightingOf(catId, device);
    await answer(s.id, device, { earTip: "looks_whole" });
    await answer(s.id, device, { earTip: "clipped_left", changeEarTip: true });
    const [next] = await db
      .insert(sightingsTable)
      .values({ deviceId: device, photoId: await insertPhoto(), lat: 37.44, lng: 24.9, status: "pending" })
      .returning();
    const res = await request(app)
      .post(`/api/sightings/${next!.id}/resolve`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: device, catId });
    expect(res.body.askEarTip).toBe(false);
  });

  it("is refused once Syros Cats have corrected the spotter's answer, and the cat stays Not known yet", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const s = await sightingOf(catId, device);
    await answer(s.id, device, { earTip: "clipped_left" });
    const [mine] = await earTips(catId, device);
    await teamCorrects(mine!);
    expect((await sterilisedNow(catId)).confidence).toBe("unknown");

    const res = await answer(s.id, device, { earTip: "clipped_left", changeEarTip: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EAR_TIP_CHECKED");
    expect(await earTips(catId, device)).toHaveLength(1);
    expect((await sterilisedNow(catId)).confidence).toBe("unknown");
  });

  it("is refused once the team has said whether the cat is sterilised", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const s = await sightingOf(catId, device);
    await answer(s.id, device, { earTip: "looks_whole" });
    await db.insert(observationsTable).values({
      catId,
      kind: "sterilised",
      value: { sterilised: true },
      accountId: "vitest-staff",
      roleAtTime: "staff",
      observedAt: new Date(),
    });
    const res = await answer(s.id, device, { earTip: "clipped_left", changeEarTip: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EAR_TIP_CHECKED");
  });

  it("a spotter's first ear-tip answer is still recorded after the team has spoken about sterilisation (review of the build)", async () => {
    // "Checked" stops a CHANGE. A new spotter's first answer, on the reward
    // screen or the cat's page, is ordinary data and must never be dropped.
    const catId = await seedCat();
    await db.insert(observationsTable).values({
      catId,
      kind: "sterilised",
      value: { sterilised: true },
      accountId: "vitest-staff",
      roleAtTime: "staff",
      observedAt: new Date(),
    });
    const device = `${DEVICE}-${uid()}`;
    const s = await sightingOf(catId, device);
    const res = await answer(s.id, device, { earTip: "clipped_left" });
    expect(res.status).toBe(200);
    expect(res.body.recorded).toEqual(["ear_tip"]);
    expect(await earTips(catId, device)).toHaveLength(1);
    // ...and only now is a change refused.
    const change = await answer(s.id, device, { earTip: "looks_whole", changeEarTip: true });
    expect(change.body.code).toBe("EAR_TIP_CHECKED");
  });

  it("a change racing a team correction of the same answer never lets both land", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const s = await sightingOf(catId, device);
    await answer(s.id, device, { earTip: "clipped_left" });
    const [mine] = await earTips(catId, device);

    // Hold the answer row exactly as PR 8's supersede endpoint does, write
    // the team's (backdated) correction, and only commit once the spotter's
    // change has been sent and is waiting.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from observations where id = $1 for update", [mine!.id]);
      await client.query(
        `insert into observations (cat_id, kind, value, account_id, role_at_time, observed_at, supersedes_id, supersede_reason)
         values ($1, 'ear_tip', '{"clipped": false}', 'vitest-staff', 'staff', $2, $3, 'torn ear')`,
        [catId, new Date(Date.now() - 30 * 86_400_000), mine!.id],
      );
      const change = answer(s.id, device, { earTip: "clipped_right", changeEarTip: true }).then((r) => r);
      await new Promise((r) => setTimeout(r, 300));
      await client.query("commit");
      const res = await change;
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("EAR_TIP_CHECKED");
    } finally {
      client.release();
    }
    const pointing = (await earTips(catId)).filter((r) => r.supersedesId === mine!.id);
    expect(pointing).toHaveLength(1);
    expect(pointing[0]!.accountId).toBe("vitest-staff");
    expect((await sterilisedNow(catId)).confidence).toBe("unknown");
  });

  it("two changes sent at once leave exactly one current answer", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const s = await sightingOf(catId, device);
    await answer(s.id, device, { earTip: "cant_tell" });
    await Promise.all([
      answer(s.id, device, { earTip: "clipped_left", changeEarTip: true }),
      answer(s.id, device, { earTip: "looks_whole", changeEarTip: true }),
    ]);
    const rows = await earTips(catId, device);
    const current = rows.filter((r) => !rows.some((o) => o.supersedesId === r.id));
    expect(current).toHaveLength(1);
    // No two rows replace the same answer.
    const targets = rows.map((r) => r.supersedesId).filter((id) => id != null);
    expect(new Set(targets).size).toBe(targets.length);
  });
});

describe("GET /api/profiles/:deviceId/cats/:catId/open-sightings", () => {
  it("lists the spotter's own recent sightings with what's still open", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const s = await sightingOf(catId, device, 3);
    await answer(s.id, device, { foodAndWater: "yes" });

    const res = await openSightings(catId, device);
    expect(res.status).toBe(200);
    expect(res.body.earTip).toEqual({ state: "open" });
    expect(res.body.sightings).toHaveLength(1);
    const item = res.body.sightings[0];
    expect(item.sightingId).toBe(s.id);
    expect(item.takenAt).toBe(s.createdAt.toISOString());
    expect(item.open).toEqual({ foodAndWater: false, note: true });
    expect(item.photoUrl).toMatch(/^\/api\/photos\//);
    // takenAt is an ISO timestamp, so a time like 17:18:24.912 would match the
    // coordinate digits by chance (SYC-699): leave it out, it is checked above.
    const text = JSON.stringify(res.body, (key, value) => (key === "takenAt" ? undefined : value));
    expect(text).not.toMatch(/"lat"|"lng"|37\.44|24\.9/);
  });

  it("reports the ear tip as answered, with the current answer, then as checked after a team correction", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const s = await sightingOf(catId, device);
    await answer(s.id, device, { earTip: "looks_whole" });
    await answer(s.id, device, { earTip: "clipped_left", changeEarTip: true });
    let res = await openSightings(catId, device);
    expect(res.body.earTip).toEqual({ state: "answered", current: "clipped_left" });
    // Still listed: its ear-tip answer can be changed.
    expect(res.body.sightings.map((x: { sightingId: number }) => x.sightingId)).toEqual([s.id]);

    const rows = await earTips(catId, device);
    await teamCorrects(rows[rows.length - 1]!);
    res = await openSightings(catId, device);
    expect(res.body.earTip).toEqual({ state: "checked" });
  });

  it("leaves out sightings over 30 days old, other people's, and ones with nothing left", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const other = `${DEVICE}-other-${uid()}`;
    await sightingOf(catId, device, 31);
    await sightingOf(catId, other, 1);
    const done = await sightingOf(catId, device, 2);
    await answer(done.id, device, { foodAndWater: "no", note: "all done", earTip: "looks_whole" });
    // The ear tip is still open, so a sighting with only that left stays.
    let res = await openSightings(catId, device);
    expect(res.body.sightings.map((x: { sightingId: number }) => x.sightingId)).toEqual([done.id]);

    // Once Syros Cats have checked the cat, this spotter's answer can't be
    // changed, so nothing is left on it.
    await db.insert(observationsTable).values({
      catId,
      kind: "sterilised",
      value: { sterilised: true },
      accountId: "vitest-staff",
      roleAtTime: "staff",
      observedAt: new Date(),
    });
    res = await openSightings(catId, device);
    expect(res.body.earTip).toEqual({ state: "checked" });
    expect(res.body.sightings).toEqual([]);
  });

  it("never includes note text", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    const s = await sightingOf(catId, device);
    await answer(s.id, device, { note: "NOTE-CANARY-addlater" });
    const res = await openSightings(catId, device);
    expect(JSON.stringify(res.body)).not.toContain("NOTE-CANARY-addlater");
  });

  it("refuses a wrong secret", async () => {
    const catId = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    await sightingOf(catId, device);
    const res = await openSightings(catId, device, "vitest-addlater-WRONG-secret-012345");
    expect(res.status).toBe(403);
  });
});

describe("open-sightings: a spot the team filed under this cat (SYC-150 PR 3.3, D4)", () => {
  const mover = { id: "vitest-addlater-mover", scopes: [{ role: "staff", colonyId: null }] } as never;
  const moveTo = (from: number, to: number, sightingId: number) =>
    moveSightings(mover, { sightingIds: [sightingId], expectedCatId: from, toCatId: to, reason: "wrong_pick", source: "cat_page" });
  type Item = { sightingId: number; filedByTeam?: boolean };

  /** Mimi with another sighting (so a move leaves her something), the spotter's spot of her, and Agatha. */
  async function setUp() {
    const mimi = await seedCat();
    const agatha = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    await sightingOf(mimi, `${DEVICE}-${uid()}`, 9);
    const spot = await sightingOf(mimi, device, 3);
    return { mimi, agatha, device, spot };
  }

  it("says the team filed it there, on the cat it was filed under, and not on a spot taken there directly", async () => {
    const { mimi, agatha, device, spot } = await setUp();
    const own = await sightingOf(agatha, device, 2);
    expect((await moveTo(mimi, agatha, spot.id)).ok).toBe(true);

    const res = await openSightings(agatha, device);
    expect(res.status).toBe(200);
    const byId = new Map<number, Item>((res.body.sightings as Item[]).map((x) => [x.sightingId, x]));
    expect(byId.get(spot.id)?.filedByTeam).toBe(true);
    // Absent, not false: the payload of a spot nobody moved is what it always was.
    expect(byId.get(own.id)).not.toHaveProperty("filedByTeam");
    // Who moved it and why never leave the server.
    expect(JSON.stringify(res.body)).not.toMatch(/vitest-addlater-mover|wrong_pick|movedBy|reason/);
  });

  it("says it on a spot whose questions are all answered, too", async () => {
    const { mimi, agatha, device, spot } = await setUp();
    await answer(spot.id, device, { foodAndWater: "yes", note: "Fine" });
    expect((await moveTo(mimi, agatha, spot.id)).ok).toBe(true);
    const res = await openSightings(agatha, device);
    const item = (res.body.sightings as Item[]).find((x) => x.sightingId === spot.id);
    expect(item?.filedByTeam).toBe(true);
  });

  it("outlives the 30 days: listed with the line, nothing to add; an old spot nobody moved stays out", async () => {
    const mimi = await seedCat();
    const agatha = await seedCat();
    const device = `${DEVICE}-${uid()}`;
    await sightingOf(mimi, `${DEVICE}-${uid()}`, 60);
    const old = await sightingOf(mimi, device, 45);
    const plain = await sightingOf(agatha, device, 50);
    expect((await moveTo(mimi, agatha, old.id)).ok).toBe(true);
    const items = (await openSightings(agatha, device)).body.sightings as (Item & { windowOver?: boolean; open: { foodAndWater: boolean; note: boolean } })[];
    const item = items.find((x) => x.sightingId === old.id);
    expect(item).toMatchObject({ filedByTeam: true, windowOver: true, open: { foodAndWater: false, note: false } });
    expect(items.some((x) => x.sightingId === plain.id)).toBe(false);
  });

  it("says nothing once the spot is back on the cat the spotter first filed it under", async () => {
    const { mimi, agatha, device, spot } = await setUp();
    await sightingOf(agatha, `${DEVICE}-${uid()}`, 8);
    expect((await moveTo(mimi, agatha, spot.id)).ok).toBe(true);
    expect((await moveTo(agatha, mimi, spot.id)).ok).toBe(true);
    const onMimi = (await openSightings(mimi, device)).body.sightings as Item[];
    const item = onMimi.find((x) => x.sightingId === spot.id);
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty("filedByTeam");
  });

  it("is off once it has moved on again, and the old cat's page doesn't carry it", async () => {
    const { mimi, agatha, device, spot } = await setUp();
    const third = await seedCat();
    await sightingOf(agatha, `${DEVICE}-${uid()}`, 8);
    expect((await moveTo(mimi, agatha, spot.id)).ok).toBe(true);
    expect((await moveTo(agatha, third, spot.id)).ok).toBe(true);
    const onAgatha = (await openSightings(agatha, device)).body.sightings as Item[];
    expect(onAgatha.some((x) => x.sightingId === spot.id)).toBe(false);
    const onThird = (await openSightings(third, device)).body.sightings as Item[];
    expect(onThird.find((x) => x.sightingId === spot.id)?.filedByTeam).toBe(true);
    const onMimi = (await openSightings(mimi, device)).body.sightings as Item[];
    expect(onMimi.some((x) => x.sightingId === spot.id)).toBe(false);
  });
});
