import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  pool,
  catsTable,
  sightingsTable,
  sightingMatchesTable,
  catIdentityTable,
  observationsTable,
} from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { haversineKm } from "@workspace/geo";
import {
  claimEligibility,
  pinWithinReach,
  CLAIM_PIN_REACH_M,
  newestActiveOwnerHomed,
  letGoWithinDays,
  clearOwner,
} from "./claiming";
import { blurPosition } from "./blur";
import { deriveCatStatuses } from "./catHelpers";
import { writeObservation, WITHDRAWN, type DbOrTx } from "./observations";

// claiming-a-cat.md §3 (who may claim), D1, D3, D11; review 2 HIGH-1.
//
// sightings and observations are append-only: nothing here deletes them.
// Cleanup removes only this file's cats (neither table has an FK to cats),
// and the whole throwaway database goes at the end of the run.
const NAME_PREFIX = "VitestClaiming";
let counter = 0;

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

const dev = () => `dev-claim-${Math.random().toString(36).slice(2, 10)}`;
// Relative dates, so nothing rots and the public 30-day clamp never bites.
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function streetCat(
  pos: { lat: number; lng: number } = { lat: 37.4441, lng: 24.9412 },
) {
  counter += 1;
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${counter}-${Math.random().toString(36).slice(2, 7)}`,
      primaryPhotoId: 0,
      lat: pos.lat,
      lng: pos.lng,
      discovererDeviceId: "dev-someone",
    })
    .returning();
  return c!;
}

/** A sighting from `deviceId`, on `catId`, with a match record whose choice
 * is `choice` (no record at all when `choice` is "none"; a record with no
 * label when it is null). `chosenCatId` defaults to `catId`. */
async function sighting(
  catId: number | null,
  deviceId: string,
  choice: "suggested" | "hand_pick" | "new_cat" | "unlabelled" | null | "none",
  opts: { status?: string; chosenCatId?: number | null } = {},
) {
  const [s] = await db
    .insert(sightingsTable)
    .values({
      catId,
      deviceId,
      photoId: 0,
      lat: 37.44,
      lng: 24.94,
      status: opts.status ?? "resolved",
      // Before teamStatus's statements (a day ago), so a later sighting never
      // clears a "deceased" (data spine §3.2) behind a test's back.
      createdAt: daysAgo(5),
    })
    .returning();
  if (choice !== "none") {
    await db.insert(sightingMatchesTable).values({
      sightingId: s!.id,
      choice,
      chosenCatId: opts.chosenCatId === undefined ? catId : opts.chosenCatId,
      chosenAt: choice == null ? null : daysAgo(2),
      suggestedRank: choice === "suggested" ? 1 : null,
    });
  }
  return s!;
}

async function teamStatus(exec: DbOrTx, catId: number, status: string) {
  return writeObservation(exec, {
    catId,
    kind: "life_status",
    value: { status },
    accountId: "system:legacy-backfill",
    roleAtTime: "staff",
    observedAt: daysAgo(1),
  });
}

async function ownerHomed(catId: number, deviceId: string, at = daysAgo(3)) {
  return writeObservation(db, {
    catId,
    kind: "life_status",
    value: { status: "homed" },
    deviceId,
    roleAtTime: "public",
    authorityScope: "owner_of_this_cat",
    observedAt: at,
  });
}

async function withdraw(catId: number, deviceId: string, supersedesId: number) {
  return writeObservation(db, {
    catId,
    kind: "life_status",
    value: WITHDRAWN,
    allowWithdrawal: true,
    deviceId,
    roleAtTime: "public",
    authorityScope: "owner_of_this_cat",
    observedAt: daysAgo(1),
    supersedesId,
    supersedeReason: "owner let go",
  });
}

const eligible = (catId: number, deviceId: string) =>
  claimEligibility(db, { catId, deviceId });
const OK = { ok: true };
const NOT_MET = { ok: false, code: "NOT_MET" };
const ALREADY_HOMED = { ok: false, code: "ALREADY_HOMED" };
const NOT_ON_STREET = { ok: false, code: "NOT_ON_STREET" };

describe("claimEligibility: rule 2, this phone has met the cat", () => {
  it.each(["suggested", "hand_pick", "new_cat", "unlabelled"] as const)(
    "a resolved %s sighting from this phone qualifies",
    async (choice) => {
      const c = await streetCat();
      const d = dev();
      await sighting(c.id, d, choice);
      expect(await eligible(c.id, d)).toEqual(OK);
    },
  );

  it("a resolved sighting from before match records were kept (no record) qualifies, as unlabelled", async () => {
    const c = await streetCat();
    const d = dev();
    await sighting(c.id, d, "none");
    expect(await eligible(c.id, d)).toEqual(OK);
  });

  // Samuel, 14 Oct 2026: the label is written after the resolve, best
  // effort. A spot whose choice wasn't recorded counts like `unlabelled`.
  it("a match record whose choice wasn't recorded qualifies, like unlabelled", async () => {
    const c = await streetCat();
    const d = dev();
    await sighting(c.id, d, null, { chosenCatId: null });
    expect(await eligible(c.id, d)).toEqual(OK);
  });

  it("an unrecorded choice naming the sighting's own cat qualifies too", async () => {
    const c = await streetCat();
    const d = dev();
    await sighting(c.id, d, null);
    expect(await eligible(c.id, d)).toEqual(OK);
  });

  it("an unrecorded choice naming a different cat from the sighting's doesn't count (moved)", async () => {
    const chosen = await streetCat();
    const movedTo = await streetCat();
    const d = dev();
    await sighting(movedTo.id, d, null, { chosenCatId: chosen.id });
    expect(await eligible(movedTo.id, d)).toEqual(NOT_MET);
    expect(await eligible(chosen.id, d)).toEqual(NOT_MET);
  });

  it("no sighting at all: NOT_MET", async () => {
    const c = await streetCat();
    expect(await eligible(c.id, dev())).toEqual(NOT_MET);
  });

  it("an unknown cat: NOT_MET", async () => {
    expect(await eligible(2_000_000_000, dev())).toEqual(NOT_MET);
  });

  it("another phone's sighting doesn't count for this phone", async () => {
    const c = await streetCat();
    await sighting(c.id, dev(), "suggested");
    expect(await eligible(c.id, dev())).toEqual(NOT_MET);
  });

  it.each(["pending", "awaiting_team"])(
    "an unresolved (%s) sighting doesn't count, even pointing at the cat",
    async (status) => {
      const c = await streetCat();
      const d = dev();
      await sighting(c.id, d, "suggested", { status });
      expect(await eligible(c.id, d)).toEqual(NOT_MET);
    },
  );

  it("a sighting whose match record now names another cat doesn't count", async () => {
    const c = await streetCat();
    const other = await streetCat();
    const d = dev();
    const s = await sighting(c.id, d, "suggested");
    await db
      .update(sightingMatchesTable)
      .set({ chosenCatId: other.id })
      .where(eq(sightingMatchesTable.sightingId, s.id));
    expect(await eligible(c.id, d)).toEqual(NOT_MET);
    expect(await eligible(other.id, d)).toEqual(NOT_MET);
  });

  it("a sighting the team moved to a new cat doesn't count for the new cat, nor the old one", async () => {
    // Moving a sighting isn't built yet (choose-a-different-cat.md §8.2); its
    // shape is the sighting on the new cat while the match record still names
    // the cat chosen at match time.
    const chosen = await streetCat();
    const movedTo = await streetCat();
    const d = dev();
    await sighting(movedTo.id, d, "hand_pick", { chosenCatId: chosen.id });
    expect(await eligible(movedTo.id, d)).toEqual(NOT_MET);
    expect(await eligible(chosen.id, d)).toEqual(NOT_MET);
  });

  it("a sighting of a cat merged into this one counts", async () => {
    const c = await streetCat();
    const merged = await streetCat();
    const d = dev();
    await sighting(merged.id, d, "suggested");
    await db
      .insert(catIdentityTable)
      .values({ catId: merged.id, canonicalCatId: c.id, reason: "test" });
    expect(await eligible(c.id, d)).toEqual(OK);
  });

  it("a merge that has since been undone no longer counts", async () => {
    const c = await streetCat();
    const merged = await streetCat();
    const d = dev();
    await sighting(merged.id, d, "suggested");
    const [m] = await db
      .insert(catIdentityTable)
      .values({ catId: merged.id, canonicalCatId: c.id, reason: "test" })
      .returning();
    await db.insert(catIdentityTable).values({
      catId: merged.id,
      canonicalCatId: merged.id,
      reason: "unmerge",
      supersedesId: m!.id,
    });
    expect(await eligible(c.id, d)).toEqual(NOT_MET);
  });

  it("a sighting of a cat merged into a DIFFERENT cat doesn't count for this one", async () => {
    const c = await streetCat();
    const elsewhere = await streetCat();
    const merged = await streetCat();
    const d = dev();
    await sighting(merged.id, d, "suggested");
    await db
      .insert(catIdentityTable)
      .values({ catId: merged.id, canonicalCatId: elsewhere.id, reason: "test" });
    expect(await eligible(c.id, d)).toEqual(NOT_MET);
  });
});

describe("claimEligibility: rule 1, the cat lives on the street with no owner", () => {
  it("a cat the team says has a home, with no owner linked: ALREADY_HOMED", async () => {
    const d = dev();
    const c = await streetCat();
    await sighting(c.id, d, "suggested");
    await teamStatus(db, c.id, "homed");
    expect(await eligible(c.id, d)).toEqual(ALREADY_HOMED);
  });

  it.each(["in_care", "deceased"])("a cat %s: NOT_ON_STREET", async (status) => {
    const d = dev();
    const c = await streetCat();
    await sighting(c.id, d, "suggested");
    await teamStatus(db, c.id, status);
    expect(await eligible(c.id, d)).toEqual(NOT_ON_STREET);
  });

  // Critic M1 (Task 4 review): the code depends only on what the public
  // sees (the derived status), never on a hidden owner link. The public
  // shows this cat as living on the street with no home, so "already has a
  // home" would reveal the link; it can't be claimed, so NOT_ON_STREET.
  it("a cat with another phone as owner but a street status: NOT_ON_STREET, not ALREADY_HOMED", async () => {
    const d = dev();
    const c = await streetCat();
    await sighting(c.id, d, "suggested");
    await db.update(catsTable).set({ ownerDeviceId: dev() }).where(eq(catsTable.id, c.id));
    expect((await deriveCatStatuses([{ id: c.id, ownerDeviceId: null }])).get(c.id)!.lifeStatus).toBe("street");
    expect(await eligible(c.id, d)).toEqual(NOT_ON_STREET);
  });

  it("a cat with another phone as owner and its homed: ALREADY_HOMED", async () => {
    const d = dev();
    const owner = dev();
    const c = await streetCat();
    await sighting(c.id, d, "suggested");
    await ownerHomed(c.id, owner);
    await db.update(catsTable).set({ ownerDeviceId: owner }).where(eq(catsTable.id, c.id));
    expect(await eligible(c.id, d)).toEqual(ALREADY_HOMED);
  });

  it.each(["in_care", "deceased"])(
    "critic M1: an owned %s cat gives the same code as an ownerless one, met or not",
    async (status) => {
      for (const meets of [true, false]) {
        const d = dev();
        const owned = await streetCat();
        const ownerless = await streetCat();
        if (meets) {
          await sighting(owned.id, d, "suggested");
          await sighting(ownerless.id, d, "suggested");
        }
        await ownerHomed(owned.id, dev(), daysAgo(3));
        await teamStatus(db, owned.id, status);
        await teamStatus(db, ownerless.id, status);
        await db.update(catsTable).set({ ownerDeviceId: dev() }).where(eq(catsTable.id, owned.id));
        const a = await eligible(owned.id, d);
        const b = await eligible(ownerless.id, d);
        expect(a).toEqual(b);
        expect(a).toEqual(NOT_ON_STREET);
      }
    },
  );

  it("critic M1: the owned cat's status is read through the caller's executor", async () => {
    const d = dev();
    const c = await streetCat();
    await sighting(c.id, d, "suggested");
    await db.update(catsTable).set({ ownerDeviceId: dev() }).where(eq(catsTable.id, c.id));
    // A team "homed" written only inside this transaction: visible to tx, not to the pool.
    let inTx: unknown;
    await db
      .transaction(async (tx) => {
        await teamStatus(tx, c.id, "homed");
        inTx = await claimEligibility(tx, { catId: c.id, deviceId: d });
        throw new Error("rollback");
      })
      .catch(() => undefined);
    expect(inTx).toEqual(ALREADY_HOMED);
  });

  it("a cat with another phone as owner and in care: still refused", async () => {
    const d = dev();
    const c = await streetCat();
    await sighting(c.id, d, "suggested");
    await teamStatus(db, c.id, "in_care");
    await db.update(catsTable).set({ ownerDeviceId: dev() }).where(eq(catsTable.id, c.id));
    expect((await eligible(c.id, d)).ok).toBe(false);
  });

  it("this phone is already the owner: owner (rule 4's quiet retry)", async () => {
    const d = dev();
    const c = await streetCat();
    await db.update(catsTable).set({ ownerDeviceId: d }).where(eq(catsTable.id, c.id));
    expect(await eligible(c.id, d)).toEqual({ ok: "owner" });
  });

  it("an owner who let go, with the claim withdrawn, can be eligible again from the street", async () => {
    const d = dev();
    const c = await streetCat();
    await sighting(c.id, d, "suggested");
    const h = await ownerHomed(c.id, d);
    await withdraw(c.id, d, h.id);
    expect(await eligible(c.id, d)).toEqual(OK);
  });

  it("reads the status through the caller's transaction (it sees an uncommitted in_care)", async () => {
    const d = dev();
    const c = await streetCat();
    await sighting(c.id, d, "suggested");
    const ROLLBACK = new Error("rollback");
    let inside: unknown;
    let derived: string | undefined;
    await db
      .transaction(async (tx) => {
        await teamStatus(tx, c.id, "in_care");
        inside = await claimEligibility(tx, { catId: c.id, deviceId: d });
        derived = (await deriveCatStatuses([{ id: c.id, ownerDeviceId: null }], tx)).get(c.id)!.lifeStatus;
        throw ROLLBACK;
      })
      .catch((err) => {
        if (err !== ROLLBACK) throw err;
      });
    expect(inside).toEqual(NOT_ON_STREET);
    expect(derived).toBe("in_care");
    // Rolled back: outside the transaction the cat is on the street again.
    expect(await eligible(c.id, d)).toEqual(OK);
  });
});

describe("claimEligibility: a cat merged into another (critic HIGH-1)", () => {
  it("a cat merged away into another can't be claimed, even by a phone that met it", async () => {
    const canonical = await streetCat();
    const mergedAway = await streetCat();
    const d = dev();
    await sighting(mergedAway.id, d, "suggested");
    await db
      .insert(catIdentityTable)
      .values({ catId: mergedAway.id, canonicalCatId: canonical.id, reason: "test" });
    expect(await eligible(mergedAway.id, d)).toEqual(NOT_ON_STREET);
    // The cat it was merged into is the one to claim.
    expect(await eligible(canonical.id, d)).toEqual(OK);
  });

  it("once the merge is undone, the cat can be claimed again", async () => {
    const canonical = await streetCat();
    const mergedAway = await streetCat();
    const d = dev();
    await sighting(mergedAway.id, d, "suggested");
    const [m] = await db
      .insert(catIdentityTable)
      .values({ catId: mergedAway.id, canonicalCatId: canonical.id, reason: "test" })
      .returning();
    await db.insert(catIdentityTable).values({
      catId: mergedAway.id,
      canonicalCatId: mergedAway.id,
      reason: "unmerge",
      supersedesId: m!.id,
    });
    expect(await eligible(mergedAway.id, d)).toEqual(OK);
  });
});

describe("deriveCatStatuses reads every record through the caller's transaction (critic LOW-2)", () => {
  const ROLLBACK = new Error("rollback");
  /** Runs `fn` in a transaction that is always rolled back, returning its result. */
  async function inRolledBackTx<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    let out: T | undefined;
    await db
      .transaction(async (tx) => {
        out = await fn(tx);
        throw ROLLBACK;
      })
      .catch((err) => {
        if (err !== ROLLBACK) throw err;
      });
    return out as T;
  }
  const lifeStatus = async (tx: DbOrTx, id: number) =>
    (await deriveCatStatuses([{ id, ownerDeviceId: null }], tx)).get(id)!;

  it("an uncommitted merge: the merged cat's in_care folds in", async () => {
    const canonical = await streetCat();
    const merged = await streetCat();
    await teamStatus(db, merged.id, "in_care");
    const seen = await inRolledBackTx(async (tx) => {
      await tx
        .insert(catIdentityTable)
        .values({ catId: merged.id, canonicalCatId: canonical.id, reason: "test" });
      return (await lifeStatus(tx, canonical.id)).lifeStatus;
    });
    expect(seen).toBe("in_care");
    expect((await lifeStatus(db, canonical.id)).lifeStatus).toBe("street");
  });

  it("an uncommitted later sighting clears a deceased", async () => {
    const c = await streetCat();
    await teamStatus(db, c.id, "deceased");
    const seen = await inRolledBackTx(async (tx) => {
      await tx.insert(sightingsTable).values({
        catId: c.id,
        deviceId: dev(),
        photoId: 0,
        lat: 37.44,
        lng: 24.94,
        status: "resolved",
      });
      return (await lifeStatus(tx, c.id)).lifeStatus;
    });
    expect(seen).toBe("street");
    expect((await lifeStatus(db, c.id)).lifeStatus).toBe("deceased");
  });

  it("an uncommitted cat's creation date is its last resort evidence of life", async () => {
    const seen = await inRolledBackTx(async (tx) => {
      counter += 1;
      const [c] = await tx
        .insert(catsTable)
        .values({
          name: `${NAME_PREFIX}${counter}-tx`,
          primaryPhotoId: 0,
          lat: 37.44,
          lng: 24.94,
          discovererDeviceId: "dev-someone",
          createdAt: daysAgo(365 * 10),
        })
        .returning();
      return (await lifeStatus(tx, c!.id)).notSeenSince;
    });
    expect(seen).not.toBeNull();
  });

  it("an uncommitted replacement of a welfare report stops it counting as evidence of life", async () => {
    counter += 1;
    const [c] = await db
      .insert(catsTable)
      .values({
        name: `${NAME_PREFIX}${counter}-welfare`,
        primaryPhotoId: 0,
        lat: 37.44,
        lng: 24.94,
        discovererDeviceId: "dev-someone",
        createdAt: daysAgo(365 * 10),
      })
      .returning();
    const elsewhere = await streetCat();
    const [report] = await db
      .insert(observationsTable)
      .values({
        catId: c!.id,
        kind: "welfare_report",
        value: {},
        deviceId: dev(),
        observedAt: daysAgo(10),
      })
      .returning();
    expect((await lifeStatus(db, c!.id)).notSeenSince).toBeNull();
    const seen = await inRolledBackTx(async (tx) => {
      await tx.insert(observationsTable).values({
        catId: elsewhere.id,
        kind: "welfare_report",
        value: {},
        accountId: "system:legacy-backfill",
        roleAtTime: "staff",
        observedAt: daysAgo(10),
        supersedesId: report!.id,
      });
      return (await lifeStatus(tx, c!.id)).notSeenSince;
    });
    expect(seen).not.toBeNull();
  });
});

describe("pinWithinReach: measured from the public cell centre (D11, review 2 HIGH-1)", () => {
  // Metres along a meridian on haversineKm's sphere, so the distances below
  // are exact rather than an approximation of the conversion.
  const M_PER_DEG = (6371_000 * Math.PI) / 180;
  const north = (p: { lat: number; lng: number }, m: number) => ({
    lat: p.lat + m / M_PER_DEG,
    lng: p.lng,
  });
  const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    haversineKm(a, b) * 1000;

  // A cat whose exact spot sits 100 m north of its cell centre (inside the
  // 250 m cell, whose half side is 125 m), so the exact and public positions
  // differ enough to tell which one a check used.
  const centre = blurPosition(37.4441, 24.9412);
  const cat = north(centre, 100);

  it("the fixture's exact spot really is in that cell, 100 m from its centre", () => {
    expect(blurPosition(cat.lat, cat.lng)).toEqual(centre);
    expect(metres(centre, cat)).toBeCloseTo(100, 3);
  });

  it("~999 m from the centre is within; ~1001 m is not", () => {
    const inside = north(centre, CLAIM_PIN_REACH_M - 1);
    const outside = north(centre, CLAIM_PIN_REACH_M + 1);
    expect(metres(centre, inside)).toBeCloseTo(999, 3);
    expect(metres(centre, outside)).toBeCloseTo(1001, 3);
    expect(pinWithinReach(cat, inside)).toBe(true);
    expect(pinWithinReach(cat, outside)).toBe(false);
    // The same either side to the south.
    expect(pinWithinReach(cat, north(centre, -(CLAIM_PIN_REACH_M - 1)))).toBe(true);
    expect(pinWithinReach(cat, north(centre, -(CLAIM_PIN_REACH_M + 1)))).toBe(false);
  });

  it("a pin within 1 km of the exact spot but over 1 km from the centre is refused", () => {
    const pin = north(centre, 1050);
    expect(metres(cat, pin)).toBeLessThan(CLAIM_PIN_REACH_M);
    expect(metres(centre, pin)).toBeGreaterThan(CLAIM_PIN_REACH_M);
    expect(pinWithinReach(cat, pin)).toBe(false);
  });

  it("a pin over 1 km from the exact spot but within 1 km of the centre is accepted", () => {
    const pin = north(centre, -950);
    expect(metres(cat, pin)).toBeGreaterThan(CLAIM_PIN_REACH_M);
    expect(metres(centre, pin)).toBeLessThan(CLAIM_PIN_REACH_M);
    expect(pinWithinReach(cat, pin)).toBe(true);
  });

  it("every exact spot in one cell gets the same answer for a pin (nothing finer than the cell leaks)", () => {
    const pin = north(centre, 1000.5);
    for (const dm of [-120, -60, 0, 60, 120]) {
      expect(pinWithinReach(north(centre, dm), pin)).toBe(false);
    }
    const near = north(centre, 999.5);
    for (const dm of [-120, -60, 0, 60, 120]) {
      expect(pinWithinReach(north(centre, dm), near)).toBe(true);
    }
  });

  it("a pin that isn't a real coordinate is never within reach (critic MEDIUM-2)", () => {
    const near = north(centre, 10);
    expect(pinWithinReach(cat, near)).toBe(true);
    // haversine is periodic: the same point one turn round the globe would
    // otherwise pass.
    expect(pinWithinReach(cat, { lat: near.lat, lng: near.lng + 360 })).toBe(false);
    expect(pinWithinReach(cat, { lat: near.lat, lng: near.lng - 360 })).toBe(false);
    expect(pinWithinReach(cat, { lat: near.lat + 360, lng: near.lng })).toBe(false);
    expect(pinWithinReach(cat, { lat: 90.0001, lng: 0 })).toBe(false);
    expect(pinWithinReach(cat, { lat: -90.0001, lng: 0 })).toBe(false);
    expect(pinWithinReach(cat, { lat: 0, lng: 180.0001 })).toBe(false);
    expect(pinWithinReach(cat, { lat: 0, lng: -180.0001 })).toBe(false);
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(pinWithinReach(cat, { lat: bad, lng: near.lng })).toBe(false);
      expect(pinWithinReach(cat, { lat: near.lat, lng: bad })).toBe(false);
    }
    expect(pinWithinReach(cat, { lat: String(near.lat), lng: near.lng } as never)).toBe(false);
  });

  it("the reach is 1 km", () => {
    expect(CLAIM_PIN_REACH_M).toBe(1000);
  });
});

describe("the owner helpers", () => {
  it("newestActiveOwnerHomed finds this phone's homed until it is withdrawn", async () => {
    const d = dev();
    const c = await streetCat();
    expect(await newestActiveOwnerHomed(db, c.id, d)).toBeNull();
    const older = await ownerHomed(c.id, d, daysAgo(5));
    const newer = await ownerHomed(c.id, d, daysAgo(2));
    expect(await newestActiveOwnerHomed(db, c.id, d)).toBe(newer.id);
    expect(await newestActiveOwnerHomed(db, c.id, dev())).toBeNull();
    // With no device given (the team removing an owner, or after deletion
    // unlinked them), any owner's active homed.
    expect(await newestActiveOwnerHomed(db, c.id, null)).toBe(newer.id);
    await withdraw(c.id, d, newer.id);
    expect(await newestActiveOwnerHomed(db, c.id, d)).toBe(older.id);
    await withdraw(c.id, d, older.id);
    expect(await newestActiveOwnerHomed(db, c.id, d)).toBeNull();
  });

  it("newestActiveOwnerHomed ignores a team's homed", async () => {
    const c = await streetCat();
    await teamStatus(db, c.id, "homed");
    expect(await newestActiveOwnerHomed(db, c.id, null)).toBeNull();
  });

  it("letGoWithinDays: this phone's own withdrawal on this cat, recently", async () => {
    const d = dev();
    const c = await streetCat();
    const other = await streetCat();
    expect(await letGoWithinDays(db, c.id, d, 7)).toBe(false);
    const h = await ownerHomed(c.id, d);
    await withdraw(c.id, d, h.id);
    expect(await letGoWithinDays(db, c.id, d, 7)).toBe(true);
    expect(await letGoWithinDays(db, c.id, dev(), 7)).toBe(false);
    expect(await letGoWithinDays(db, other.id, d, 7)).toBe(false);
  });

  it("letGoWithinDays counts by when the server wrote it, so an old one has expired", async () => {
    const d = dev();
    const c = await streetCat();
    const h = await ownerHomed(c.id, d);
    // Written straight to the table, eight days ago: writeObservation always
    // stamps the server's now.
    await db.insert(observationsTable).values({
      catId: c.id,
      kind: "life_status",
      value: WITHDRAWN,
      deviceId: d,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: daysAgo(8),
      createdAt: daysAgo(8),
      supersedesId: h.id,
    });
    expect(await letGoWithinDays(db, c.id, d, 7)).toBe(false);
    expect(await letGoWithinDays(db, c.id, d, 9)).toBe(true);
  });

  it("letGoWithinDays still sees a withdrawal if WITHDRAWN ever gains a field (critic LOW-5)", async () => {
    const d = dev();
    const c = await streetCat();
    const h = await ownerHomed(c.id, d);
    await db.insert(observationsTable).values({
      catId: c.id,
      kind: "life_status",
      value: { withdrawn: true, reason: "a future field" },
      deviceId: d,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: daysAgo(1),
      supersedesId: h.id,
    });
    expect(await letGoWithinDays(db, c.id, d, 7)).toBe(true);
  });

  it("clearOwner clears the owner link, name, home note and pin, and nothing else", async () => {
    const c = await streetCat();
    await db
      .update(catsTable)
      .set({
        ownerDeviceId: dev(),
        ownerName: "Maria",
        homeDescription: "the blue door",
        homeLat: 37.44001,
        homeLng: 24.94001,
      })
      .where(eq(catsTable.id, c.id));
    await clearOwner(db, c.id);
    const [after] = await db.select().from(catsTable).where(eq(catsTable.id, c.id));
    expect(after).toMatchObject({
      ownerDeviceId: null,
      ownerName: null,
      homeDescription: null,
      homeLat: null,
      homeLng: null,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      discovererDeviceId: c.discovererDeviceId,
    });
  });
});
