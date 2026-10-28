import { catsTable, coloniesTable, db, feedingSitesTable, photosTable } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { liveCats } from "../catIdentity";
import { catsInColony } from "../colonyMembership";
import { colonyFilter, type Visible } from "../guardianView";
import { placeLabel, publicLabelOf, type PublicLabel } from "../areas/placeLabel";
import { getAppSettings } from "../appSettings";
import { haversineKm } from "../catHelpers";
import type { CoatColour, CoatPattern } from "../appearance";
import { syrNumber } from "../teamCatView";
import { areaFor } from "../areas/namedAreas";
import { loadTeamCats, type Lives, type SterilisedMark, type TeamCat } from "../teamCatList";
import { isStreet, toDo } from "./countedCats";

// A colony's trapping planner (SYC-396 PR 2.3; SYC-621; spec §9.2). Who is
// counted comes from countedCats (§9.5): To do is `toDo()`'s street cats not
// confirmed sterilised, in its order, never cut short. Done is the colony's
// sterilised street cats. Every other cat placed here (homed, in care, no
// longer with us, or a merged-away half) is "Not on the street" (Samuel, 24
// Oct 2026, on SYC-621), so it keeps its row on the page.
//
// **Positions.** A cat's usual place is words only: its nearest feeding site's
// PUBLIC label, or its area. The site's internal `name` is never read here.
// For the team the place is drawn from the cat's last sighting; for a cat
// guardian from where it was first found (§10.2: never sighting positions),
// and her cats are copied field by field into `GuardianPlanCat`, so no
// sighting position, snapshot or place derived from one reaches her page or
// its JSON.

/** A feeding site this close to a cat's reference point names where it's usually seen. */
export const USUAL_SITE_RADIUS_M = 300;

export interface PlanCat extends TeamCat {
  /** Where the cat is usually seen, in words: "Kini, harbour steps" or "Kini". */
  usualPlace: string;
  /** Someone has seen its ear clip (`clippedTipSightings > 0`). */
  earClipSeen: boolean;
}

/**
 * What a guardian's planner may hold: an explicit field list, never a TeamCat
 * with fields hidden. No lastSeen, placedAt, place or snapshot: those carry or
 * derive from sighting positions.
 */
export interface GuardianPlanCat {
  id: number;
  name: string;
  namePending: boolean;
  syr: string;
  photoPublicId: string | null;
  coat: CoatColour[];
  pattern: CoatPattern | null;
  mark: SterilisedMark;
  lastSeenAt: Date | null;
  usualPlace: string;
  earClipSeen: boolean;
}

/** Copies the listed fields only. */
export function forGuardian(c: PlanCat): GuardianPlanCat {
  return {
    id: c.id,
    name: c.name,
    namePending: c.namePending,
    syr: c.syr,
    photoPublicId: c.photoPublicId,
    coat: c.coat,
    pattern: c.pattern,
    mark: c.mark,
    lastSeenAt: c.lastSeenAt,
    usualPlace: c.usualPlace,
    earClipSeen: c.earClipSeen,
  };
}

/**
 * A cat placed in the colony that's on neither list: homed, in care, no
 * longer with us, a street cat off Syros (never counted, §3.3), or a
 * merged-away half that `loadTeamCats` leaves out. No mark, no place: it
 * isn't part of the round.
 */
export type OtherWhy = Exclude<Lives, "street"> | "off_syros" | "merged";

export interface OtherPlanCat {
  id: number;
  name: string;
  namePending: boolean;
  syr: string;
  photoPublicId: string | null;
  why: OtherWhy;
}

export interface PlanSite {
  id: number;
  /** For the small map only; never drawn as numbers, never in an address. */
  lat: number;
  lng: number;
  publicLabel: PublicLabel | null;
}

export interface TrappingPlan {
  colonyId: number;
  /** Guardian: GuardianPlanCat only. */
  toDo: PlanCat[] | GuardianPlanCat[];
  done: PlanCat[] | GuardianPlanCat[];
  other: OtherPlanCat[];
  /** "N cats × €price = €total", priced from Vet settings. Null for a cat guardian (§10.2). */
  estimate: { cats: number; priceEur: number; totalEur: number } | null;
  /** The colony's feeding sites that aren't retired. */
  sites: PlanSite[];
}

type Point = { lat: number; lng: number };

/** The nearest site within USUAL_SITE_RADIUS_M of `p`, or null. */
function nearestSite(p: Point, sites: readonly PlanSite[]): PlanSite | null {
  let best: PlanSite | null = null;
  let bestM = USUAL_SITE_RADIUS_M;
  for (const s of sites) {
    const m = haversineKm(p.lat, p.lng, s.lat, s.lng) * 1000;
    if (m <= bestM) {
      best = s;
      bestM = m;
    }
  }
  return best;
}

/** The site's area and public label, else the point's own area. Words only. */
export function usualPlaceOf(p: Point, sites: readonly PlanSite[]): string {
  const s = nearestSite(p, sites);
  return s ? placeLabel(s, s.publicLabel) : placeLabel(p);
}

const byName = (a: { name: string; id: number }, b: { name: string; id: number }) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id - b.id;

/**
 * The colony's plan, or null for a colony this viewer doesn't see (exactly
 * like one that doesn't exist). `opts.island` is the viewer's reach: false
 * for a cat guardian, whose plan has no estimate and no sighting positions.
 */
export async function trappingPlan(
  visible: Visible,
  colonyId: number,
  opts: { island: boolean },
  now: Date = new Date(),
): Promise<TrappingPlan | null> {
  const [colony] = await db
    .select({ id: coloniesTable.id })
    .from(coloniesTable)
    .where(and(eq(coloniesTable.id, colonyId), colonyFilter(coloniesTable.id, visible)));
  if (!colony) return null;

  const [siteRows, ids, team] = await Promise.all([
    // Never the internal name: only what publicLabelOf needs, and the position.
    db
      .select({
        id: feedingSitesTable.id,
        lat: feedingSitesTable.lat,
        lng: feedingSitesTable.lng,
        isPublic: feedingSitesTable.isPublic,
        publicLabel: feedingSitesTable.publicLabel,
        retiredAt: feedingSitesTable.retiredAt,
      })
      .from(feedingSitesTable)
      .where(
        and(
          eq(feedingSitesTable.colonyId, colonyId),
          isNull(feedingSitesTable.retiredAt),
          colonyFilter(feedingSitesTable.colonyId, visible),
        ),
      )
      .orderBy(feedingSitesTable.id),
    catsInColony(colonyId),
    loadTeamCats(now),
  ]);
  const sites: PlanSite[] = siteRows.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, publicLabel: publicLabelOf(s) }));

  const here = new Set(ids);
  const mine = team.filter((c) => here.has(c.id));
  const seen = new Set(mine.map((c) => c.id));
  const missing = ids.filter((id) => !seen.has(id));

  // Where a guardian's cat was first found, and the records loadTeamCats
  // leaves out: one query for both.
  const needRows = opts.island ? missing : ids;
  const rows =
    needRows.length === 0
      ? []
      : await liveCats(
          {
            id: catsTable.id,
            name: catsTable.name,
            namePending: catsTable.namePending,
            lat: catsTable.lat,
            lng: catsTable.lng,
            photoPublicId: photosTable.publicId,
          },
          { where: inArray(catsTable.id, needRows) },
        ).leftJoin(photosTable, eq(photosTable.id, catsTable.primaryPhotoId));
  const found = new Map(rows.map((r) => [r.id, r]));

  // A cat guardian's cats are sorted by where they were first found, never by
  // a sighting (§10.2): "Off Syros" from a last sighting would tell her where
  // a spotter saw the cat. The team's figures keep the sighting-based area.
  const classed = opts.island
    ? mine
    : mine.map((c) => {
        const f = found.get(c.id);
        return f ? { ...c, areaKey: areaFor(f.lat, f.lng).key } : c;
      });

  const plan = (c: TeamCat): PlanCat => {
    // The team: the last sighting (else where it was found). A guardian: where it was found only.
    const ref: Point = opts.island ? c.placedAt : (found.get(c.id) ?? c.placedAt);
    return {
      ...c,
      usualPlace: usualPlaceOf(ref, sites),
      earClipSeen: c.snapshot.sterilised.clippedTipSightings > 0,
    };
  };

  const todo = toDo(classed).map(plan);
  const done = classed
    .filter((c) => isStreet(c) && c.mark === "sterilised")
    .sort((a, b) => (b.lastSeenAt?.getTime() ?? -Infinity) - (a.lastSeenAt?.getTime() ?? -Infinity) || a.id - b.id)
    .map(plan);
  const onList = new Set([...todo, ...done].map((c) => c.id));
  const other: OtherPlanCat[] = [
    ...classed
      .filter((c) => !onList.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        namePending: c.namePending,
        syr: c.syr,
        photoPublicId: c.photoPublicId,
        why: c.lives === "street" ? ("off_syros" as const) : c.lives,
      })),
    ...missing.flatMap((id) => {
      const r = found.get(id);
      return r ? [{ id, name: r.name, namePending: r.namePending, syr: syrNumber(id), photoPublicId: r.photoPublicId, why: "merged" as const }] : [];
    }),
  ].sort(byName);

  // getAppSettings never throws: a failed read serves the last answer or the default.
  const priceEur = opts.island ? (await getAppSettings()).sterilisationPriceEur : null;
  const estimate = priceEur === null ? null : { cats: todo.length, priceEur, totalEur: todo.length * priceEur };

  return {
    colonyId,
    toDo: opts.island ? todo : todo.map(forGuardian),
    done: opts.island ? done : done.map(forGuardian),
    other,
    estimate,
    sites,
  };
}
