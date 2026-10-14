import { catsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { haversineKm } from "@workspace/geo";
import { blurPosition } from "./blur";
import { deriveCatStatuses } from "./catHelpers";
import { pr3Recorded } from "./pr3Gate";
import type { DbOrTx } from "./observations";

/**
 * Who may say "This is my cat" (claiming-a-cat.md §3, D1, D3, D11).
 *
 * Nothing here returns, logs or throws a distance, a direction or a cat's
 * exact position: every answer is a code or a yes/no (§3 "Order of checks",
 * §11; review 2, HIGH-1).
 */

/** claiming-a-cat.md D11: the pin must be within this of the cat's public position. */
export const CLAIM_PIN_REACH_M = 1000;

/**
 * §3 rule 2 (D1): the ways a spotter can have matched a sighting that count
 * as having met the cat. Listed here rather than read from `MATCH_CHOICES`,
 * so a new kind of match never widens who may claim without a decision.
 */
export const MET_MATCH_CHOICES = ["suggested", "hand_pick", "new_cat", "unlabelled"] as const;

export type ClaimRefusal = "NOT_MET" | "ALREADY_HOMED" | "NOT_ON_STREET";
export type Eligibility = { ok: true } | { ok: "owner" } | { ok: false; code: ClaimRefusal };

/**
 * §3 rules 1 and 2, and rule 4's "already the owner". Pure reads; the caller
 * locks the cat row and passes its transaction, so the status is read
 * through it (§5).
 */
export async function claimEligibility(
  exec: DbOrTx,
  { catId, deviceId }: { catId: number; deviceId: string },
): Promise<Eligibility> {
  const [cat] = await exec
    .select({ id: catsTable.id, ownerDeviceId: catsTable.ownerDeviceId })
    .from(catsTable)
    .where(eq(catsTable.id, catId));
  if (!cat) return { ok: false, code: "NOT_MET" };
  if (cat.ownerDeviceId === deviceId) return { ok: "owner" };
  if (cat.ownerDeviceId !== null) {
    // Critic M1 (Task 4 review): another phone owns it, so it can't be
    // claimed, but the code must depend only on what the public sees, never
    // on the hidden owner link. The public reads "has a home" from the
    // derived status (from the owner column while the PR 3 gate is shut),
    // so: ALREADY_HOMED only when that says homed, else NOT_ON_STREET, the
    // same answer an ownerless cat in that state gets.
    const owned = (await deriveCatStatuses([{ id: catId, ownerDeviceId: cat.ownerDeviceId }], exec)).get(catId);
    return { ok: false, code: owned?.lifeStatus === "homed" ? "ALREADY_HOMED" : "NOT_ON_STREET" };
  }

  // A cat merged into another (§10.3) isn't a cat of its own any more: a
  // homed written on it would fold into the cat it was merged into, leaving
  // that cat homed with nobody linked, so nobody could claim it. The claim
  // belongs on the cat it was merged into. Only a merge nothing has undone.
  const mergedAway = await exec.execute<{ merged: boolean }>(sql`
    select exists (
      select 1 from cat_identity ci
       where ci.cat_id = ${catId}
         and ci.canonical_cat_id <> ${catId}
         and not exists (select 1 from cat_identity u where u.supersedes_id = ci.id)
    ) as merged`);
  if (mergedAway.rows[0]?.merged !== false) return { ok: false, code: "NOT_ON_STREET" };

  // Fail closed (critic HIGH-2): until the PR 3 backfill is recorded, and
  // whenever the gate can't be read, deriveCatStatuses falls back to the
  // owner column alone and calls every ownerless cat "street", including one
  // the team says is in care or has died. Nothing is claimable then.
  if (!(await pr3Recorded())) return { ok: false, code: "NOT_ON_STREET" };

  // Rule 1: the derived life status, never only the owner column. A cat
  // still homed after its owner was deleted (D13), or that the team says is
  // in care or has died, can't be claimed (D3).
  const status = (await deriveCatStatuses([{ id: catId, ownerDeviceId: null }], exec)).get(catId);
  if (status?.lifeStatus === "homed") return { ok: false, code: "ALREADY_HOMED" };
  if (status?.lifeStatus !== "street") return { ok: false, code: "NOT_ON_STREET" };

  // Rule 2: a resolved sighting from this phone (a sighting unlinked by
  // deletion has no device, so never matches), of this cat or of a cat merged
  // into it by a merge nothing has undone (§10.3), and either:
  // - with no match record, which only a sighting from before records were
  //   kept has (it is `unlabelled`; nothing backfilled them); or
  // - with a match record whose choice wasn't recorded (the label is written
  //   after the resolve, best effort), which counts like `unlabelled`
  //   (Samuel, 14 Oct 2026), unless it names a chosen cat other than the
  //   sighting's; or
  // - with a match record that is still on the cat chosen at match time
  //   (a sighting the team later moved doesn't count for its new cat), and
  //   whose choice is one of MET_MATCH_CHOICES.
  const choices = sql.join(
    MET_MATCH_CHOICES.map((c) => sql`${c}`),
    sql`, `,
  );
  const met = await exec.execute<{ met: boolean }>(sql`
    select exists (
      select 1
        from sightings s
        left join sighting_matches m on m.sighting_id = s.id
       where s.device_id = ${deviceId}
         and s.status = 'resolved'
         and (s.cat_id = ${catId}
              or s.cat_id in (
                select ci.cat_id from cat_identity ci
                 where ci.canonical_cat_id = ${catId}
                   and not exists (select 1 from cat_identity u where u.supersedes_id = ci.id)))
         and (m.sighting_id is null
              or (m.choice is null
                  and (m.chosen_cat_id is null or m.chosen_cat_id = s.cat_id))
              or (m.choice in (${choices}) and m.chosen_cat_id = s.cat_id))
    ) as met`);
  return met.rows[0]?.met === true ? { ok: true } : { ok: false, code: "NOT_MET" };
}

function isCoordinate(p: { lat: unknown; lng: unknown }): boolean {
  return (
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

/**
 * D11: within 1 km (inclusive) of the cat's PUBLIC position, the centre of
 * its 250 m cell, never its exact position or any sighting (review 2,
 * HIGH-1). Every exact spot in one cell gets the same answer, so moving a
 * pin about learns nothing the map doesn't already show. Only a yes or no.
 */
export function pinWithinReach(
  cat: { lat: number; lng: number },
  pin: { lat: number; lng: number },
): boolean {
  // haversine is periodic, so lng + 360 would otherwise pass (critic
  // MEDIUM-2). The claim route refuses these with a 400 first; this holds
  // whoever calls it.
  if (!isCoordinate(pin)) return false;
  const centre = blurPosition(cat.lat, cat.lng);
  return haversineKm(centre, pin) * 1000 <= CLAIM_PIN_REACH_M;
}

/**
 * The newest owner's `homed` on this cat that nothing supersedes yet, or
 * null. With a device, only that phone's; with null, any owner's (the team
 * removing an owner, or one deletion has unlinked).
 */
export async function newestActiveOwnerHomed(
  exec: DbOrTx,
  catId: number,
  deviceId: string | null,
): Promise<number | null> {
  const r = await exec.execute<{ id: number }>(sql`
    select o.id from observations o
     where o.cat_id = ${catId}
       and o.kind = 'life_status'
       and o.value->>'status' = 'homed'
       and o.authority_scope = 'owner_of_this_cat'
       and (${deviceId}::text is null or o.device_id = ${deviceId})
       and not exists (select 1 from observations x where x.supersedes_id = o.id)
     order by o.observed_at desc, o.id desc
     limit 1`);
  return r.rows[0]?.id ?? null;
}

/**
 * §11: has this phone withdrawn its own claim on this cat within `days`?
 * Counted by when the server wrote the withdrawal, which a phone can't set.
 */
export async function letGoWithinDays(
  exec: DbOrTx,
  catId: number,
  deviceId: string,
  days: number,
): Promise<boolean> {
  const r = await exec.execute<{ found: boolean }>(sql`
    select exists (
      select 1 from observations
       where cat_id = ${catId}
         and kind = 'life_status'
         and device_id = ${deviceId}
         and (value->>'withdrawn') = 'true'
         and created_at > now() - make_interval(days => ${days}::int)
    ) as found`);
  return r.rows[0]?.found === true;
}

/** Clears everything that made someone this cat's owner (§6, §7): the owner
 * link, their name, the home note and the home pin. */
export async function clearOwner(exec: DbOrTx, catId: number): Promise<void> {
  await exec
    .update(catsTable)
    .set({
      ownerDeviceId: null,
      ownerName: null,
      homeDescription: null,
      homeLat: null,
      homeLng: null,
    })
    .where(eq(catsTable.id, catId));
}
