import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, observationsTable, pool, sightingMatchesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import { daysAgo, moveKit } from "../test/moveKit";
import { moveSighting } from "../test/moves";
import { mergeKeepingSightings } from "../test/merges";
import { earTipStateFor, hasAnsweredEarTip } from "../routes/sightings";
import { catsOfPhoto } from "./capabilityTargets";
import { handPickedAmong } from "./handPick";
import { listLikelyForReview } from "./likelyReview";
import { newCatsAfterFailedCheck } from "./matcherHealth";
import { loadCatRecords, writeObservation } from "./observations";
import { resolveCat } from "./resolve";
import { agreeWithClip } from "./teamCorrections";

// SYC-150 PR 3.1 (which-cat-is-which.md §9.5's readers table): the readers
// that load statements or sightings without loadCatRecords, after a move.
// Spec test 4 (the agreement) and test 5 (ear-tip state on both cats).

const kit = moveKit("VitestMoveReaders");
beforeAll(kit.cleanup);
afterAll(async () => {
  await kit.cleanup();
  await pool.end();
});

const STAFF = { id: "vitest-move-readers-staff", scopes: [{ role: "staff", colonyId: null }] };

/** Mimi, seen earlier by someone else, and Agatha; a spotter's clipped answer on a sighting filed under Mimi. */
async function scene(opts: { handPick?: boolean } = {}) {
  const mimi = await kit.cat();
  const agatha = await kit.cat();
  const earlier = await kit.sighting(mimi, kit.device(), daysAgo(10));
  const spotter = kit.device();
  const s = await kit.sighting(mimi, spotter, daysAgo(3));
  if (opts.handPick) {
    await db.insert(sightingMatchesTable).values({ sightingId: s.id, choice: "hand_pick", chosenCatId: mimi, chosenAt: s.createdAt });
  }
  const ear = await kit.answer(s, "ear_tip", { clipped: true, side: "left" });
  return { mimi, agatha, earlier, spotter, s, ear };
}

describe("spec test 5: ear-tip state after a move is right on both cats", () => {
  it("the old cat is open again for the spotter; the new cat holds their answer", async () => {
    const c = await scene();
    expect(await earTipStateFor(db, c.spotter, c.mimi)).toMatchObject({ state: "answered", current: { id: c.ear.id, answer: "clipped_left" } });
    expect(await hasAnsweredEarTip(db, c.spotter, c.agatha)).toBe(false);

    const moved = await moveSighting(c.s.id, c.agatha);
    const copy = moved.copied.find((o) => o.kind === "ear_tip")!;

    expect(await earTipStateFor(db, c.spotter, c.mimi)).toEqual({ state: "open" });
    expect(await hasAnsweredEarTip(db, c.spotter, c.mimi)).toBe(false);
    expect(await earTipStateFor(db, c.spotter, c.agatha)).toEqual({ state: "answered", current: { id: copy.id, answer: "clipped_left" } });
    expect(await hasAnsweredEarTip(db, c.spotter, c.agatha)).toBe(true);
  });

  it("reads through the cat a merged-away id now is", async () => {
    const c = await scene();
    const dora = await kit.cat();
    await mergeKeepingSightings({ catId: c.mimi, canonicalCatId: dora, reason: "vitest move readers" });
    expect(await earTipStateFor(db, c.spotter, dora)).toMatchObject({ state: "answered", current: { id: c.ear.id } });
    expect(await hasAnsweredEarTip(db, c.spotter, dora)).toBe(true);
  });
});

describe("spec test 4: a team agreement on the moved photo is withdrawn, and is no evidence of life", () => {
  it("Mimi's last seen goes back to her own sighting; the agreement is refused on the moved answer and works on the copy", async () => {
    const c = await scene();
    const agreed = await agreeWithClip(STAFF, c.ear.id);
    if (agreed === "already") throw new Error("expected an agreement");

    const moved = await moveSighting(c.s.id, c.agatha);
    const mimi = (await loadCatRecords([c.mimi])).get(c.mimi)!;
    expect(mimi.evidenceOfLife).toMatchObject({ source: "sighting", at: c.earlier.createdAt, lastSightingAt: c.earlier.createdAt });
    // Neither the withdrawn agreement nor the spotter's moved answer counts for Mimi.
    expect(resolveCat(mimi.observations, mimi.evidenceOfLife, new Date()).sterilised.confidence).toBe("unknown");

    await expect(agreeWithClip(STAFF, c.ear.id)).rejects.toMatchObject({ code: "MOVED" });
    const copy = moved.copied.find((o) => o.kind === "ear_tip")!;
    const again = await agreeWithClip(STAFF, copy.id);
    expect(again).not.toBe("already");
    expect(again).toMatchObject({ catId: c.agatha, value: { agreesWith: copy.id } });
  });

  it("agreeing with a merged-away cat's answer writes on the cat it is now", async () => {
    const c = await scene();
    const dora = await kit.cat();
    await mergeKeepingSightings({ catId: c.mimi, canonicalCatId: dora, reason: "vitest move readers" });
    const agreed = await agreeWithClip(STAFF, c.ear.id);
    expect(agreed).toMatchObject({ catId: dora, value: { agreesWith: c.ear.id } });
  });
});

describe("catsOfPhoto: a photo belongs to the cat its sighting is filed under now", () => {
  it("names only the new cat after a move", async () => {
    const c = await scene();
    const [photo] = (await db.execute<{ public_id: string }>(sql`select public_id from photos where id = ${c.s.photoId}`)).rows;
    expect(new Set(await catsOfPhoto(photo!.public_id))).toEqual(new Set([c.mimi]));
    await moveSighting(c.s.id, c.agatha);
    expect(new Set(await catsOfPhoto(photo!.public_id))).toEqual(new Set([c.agatha]));
  });
});

describe("hand-picked only for the cat the spotter picked (likelyReview, handPick)", () => {
  it("the Likely list: Mimi's evidence was matched by hand; the same answer on Agatha after a move isn't", async () => {
    const c = await scene({ handPick: true });
    const before = (await listLikelyForReview()).find((l) => l.catId === c.mimi);
    expect(before?.evidence.find((e) => e.observationId === c.ear.id)?.matchedByHand).toBe(true);

    const moved = await moveSighting(c.s.id, c.agatha);
    const copy = moved.copied.find((o) => o.kind === "ear_tip")!;
    const after = await listLikelyForReview();
    expect(after.find((l) => l.catId === c.mimi)).toBeUndefined();
    expect(after.find((l) => l.catId === c.agatha)?.evidence.find((e) => e.observationId === copy.id)?.matchedByHand).toBe(false);
  });

  it("the colour hand-pick: the spotter's colour answer counts as hand-picked on Mimi, not when copied to Agatha", async () => {
    const c = await scene({ handPick: true });
    const coat = await writeObservation(db, {
      catId: c.mimi,
      kind: "coat",
      value: { colours: ["ginger"], pattern: "stripes" },
      deviceId: c.spotter,
      roleAtTime: "public",
      sightingId: c.s.id,
      photoId: c.s.photoId,
      observedAt: c.s.createdAt,
    });
    expect(await handPickedAmong([coat])).toEqual(new Set([coat.id]));
    const moved = await moveSighting(c.s.id, c.agatha);
    const copy = moved.copied.find((o) => o.kind === "coat")!;
    expect(await handPickedAmong([coat, copy])).toEqual(new Set([coat.id]));
  });
});

describe("matcherHealth: a new cat to check is the cat the spotter made", () => {
  it("still lists the new cat after its first sighting moves elsewhere, and never the cat it moved to", async () => {
    const made = await kit.cat();
    const other = await kit.cat();
    const s = await kit.sighting(made, kit.device(), daysAgo(1));
    await db.insert(sightingMatchesTable).values({ sightingId: s.id, matcherFailed: true, matchedAt: daysAgo(1), choice: "new_cat", chosenCatId: made, chosenAt: daysAgo(1) });
    await kit.sighting(made, kit.device(), daysAgo(1));
    await moveSighting(s.id, other);
    const listed = (await newCatsAfterFailedCheck()).map((n) => n.catId);
    expect(listed).toContain(made);
    expect(listed).not.toContain(other);
  });
});

describe("writeObservation's same-cat checks compare canonical cats", () => {
  it("the team may mark a merged-in cat's ranked row wrong from the cat it is part of; never another cat's", async () => {
    const mimi = await kit.cat();
    const agatha = await kit.cat();
    const stranger = await kit.cat();
    const [row] = await db
      .insert(observationsTable)
      .values({ catId: mimi, kind: "sterilised", value: { sterilised: false }, accountId: "vitest-a", roleAtTime: "staff", observedAt: daysAgo(5) })
      .returning();
    await mergeKeepingSightings({ catId: mimi, canonicalCatId: agatha, reason: "vitest move readers" });
    const write = (catId: number) =>
      writeObservation(db, { catId, kind: "sterilised", value: { sterilised: true }, accountId: "vitest-b", roleAtTime: "staff", observedAt: daysAgo(1), supersedesId: row!.id });
    await expect(write(stranger)).rejects.toMatchObject({ code: "INVALID_SUPERSESSION" });
    await expect(write(agatha)).resolves.toMatchObject({ catId: agatha, supersedesId: row!.id });
  });
});

// Folded in from the independent review of #380 (R1, R2, R6).

const sterilisedOf = async (catId: number) => {
  const r = (await loadCatRecords([catId])).get(catId)!;
  return resolveCat(r.observations, r.evidenceOfLife, new Date()).sterilised;
};

describe("a spotter who changed their answer, then the sighting moved (review R1; spec tests 2, 5)", () => {
  it("the old cat is as if it never had the sighting: open, never answered", async () => {
    const c = await scene();
    // The spotter changes their mind, as the answers route writes it.
    await writeObservation(db, {
      catId: c.mimi,
      kind: "ear_tip",
      value: { clipped: false },
      deviceId: c.spotter,
      roleAtTime: "public",
      authorityScope: "none",
      provenance: "volunteered",
      sightingId: c.s.id,
      photoId: c.s.photoId,
      observedAt: c.s.createdAt,
      supersedesId: c.ear.id,
      supersedeReason: "changed by the spotter",
    });
    await moveSighting(c.s.id, c.agatha);
    expect(await earTipStateFor(db, c.spotter, c.mimi)).toEqual({ state: "open" });
    expect(await hasAnsweredEarTip(db, c.spotter, c.mimi)).toBe(false);
    expect(await earTipStateFor(db, c.spotter, c.agatha)).toMatchObject({ state: "answered", current: { answer: "looks_whole" } });
  });
});

describe("move, then move back (review R2)", () => {
  it("each cat is as it was before; the spotter's answer is current on Mimi again", async () => {
    const c = await scene();
    const mimiBefore = await sterilisedOf(c.mimi);
    const agathaBefore = await sterilisedOf(c.agatha);
    await moveSighting(c.s.id, c.agatha);
    const back = await moveSighting(c.s.id, c.mimi);
    const copy = back.copied.find((o) => o.kind === "ear_tip")!;
    expect(await sterilisedOf(c.mimi)).toEqual(mimiBefore);
    expect(await sterilisedOf(c.agatha)).toEqual(agathaBefore);
    expect(await earTipStateFor(db, c.spotter, c.mimi)).toMatchObject({ state: "answered", current: { id: copy.id } });
    expect(await earTipStateFor(db, c.spotter, c.agatha)).toEqual({ state: "open" });
    const likely = await listLikelyForReview();
    expect(likely.find((l) => l.catId === c.agatha)).toBeUndefined();
    expect(likely.find((l) => l.catId === c.mimi)?.evidence.map((e) => e.observationId)).toEqual([copy.id]);
  });
});

describe("an agreement, then the photo moves back (review R6)", () => {
  it("the agreement on Agatha's copy doesn't carry over: Mimi is back on the Likely list", async () => {
    const c = await scene();
    const there = await moveSighting(c.s.id, c.agatha);
    const copy = there.copied.find((o) => o.kind === "ear_tip")!;
    expect(await agreeWithClip(STAFF, copy.id)).not.toBe("already");
    expect((await listLikelyForReview()).find((l) => l.catId === c.agatha)).toBeUndefined();
    const back = await moveSighting(c.s.id, c.mimi);
    const again = back.copied.find((o) => o.kind === "ear_tip")!;
    expect((await sterilisedOf(c.mimi)).confidence).toBe("likely");
    expect((await sterilisedOf(c.agatha)).confidence).toBe("unknown");
    const likely = await listLikelyForReview();
    expect(likely.find((l) => l.catId === c.mimi)?.evidence.map((e) => e.observationId)).toEqual([again.id]);
    expect(likely.find((l) => l.catId === c.agatha)).toBeUndefined();
  });
});
