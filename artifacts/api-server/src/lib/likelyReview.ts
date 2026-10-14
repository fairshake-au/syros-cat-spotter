import { and, eq, inArray } from "drizzle-orm";
import {
  catsTable,
  db,
  observationsTable,
  photosTable,
  sightingMatchesTable,
} from "@workspace/db";
import { loadCatRecords } from "./observations";
import { resolveCat } from "./resolve";
import { newestActiveClip } from "./teamCorrections";
import { TEAM_ROLES } from "./teamRoles";

// The *Probably sterilised* review list (spec §4.5 point 3; SYC-43 part 2
// plan, PR 4). Read by the dashboard page (GET /api/team/likely) and by data
// spine PR 8's JSON route (GET /api/team/observations/review/likely), which
// both call listLikelyForReview, so they can't disagree.
//
// **The list rule** (Decision 6): a cat is listed while the resolver says
// *Likely* **and** its newest active `ear_tip { clipped: true }` (newest by
// createdAt) was written by a spotter, not by the team (`staff`, `vet`,
// `admin`). "Looks right" writes the team's own clipped answer, so the cat
// leaves the list; a newer spotter answer puts it back. This is a rule of
// the list, not of the resolver, which is unchanged.
//
// Evidence photos are served by the team photo route (/api/team/photos/),
// never the public photo route, which sits behind the pre-launch gate and
// doesn't load on the team domain.

const teamPhotoUrl = (publicId: string) =>
  `/api/team/photos/${encodeURIComponent(publicId)}`;

export interface LikelyEvidence {
  observationId: number;
  photoId: number | null;
  observedAt: string;
  side: string | null;
  matchedByHand: boolean;
  photoUrl: string | null;
}

export interface LikelyCat {
  catId: number;
  name: string;
  sterilisedAsOf: string;
  matchedByHand: boolean;
  /** The spotter's answer the two buttons act on: the newest active clipped one. */
  reviewObservationId: number;
  evidence: LikelyEvidence[];
}

/**
 * Cats waiting for the team to look at their clipped-ear evidence. Matched
 * by hand first (a spotter who picked the cat themselves may have picked the
 * wrong one, data spine PR 7), then newest evidence first.
 *
 * Only loads cats that actually have an `ear_tip` observation (review of #68,
 * "n-plus-one") and batches the hand-pick and photo lookups: a fixed number
 * of queries whatever the catalogue's size.
 */
export async function listLikelyForReview(now = new Date()): Promise<LikelyCat[]> {
  const earTipCats = await db
    .selectDistinct({ id: catsTable.id, name: catsTable.name })
    .from(observationsTable)
    .innerJoin(catsTable, eq(catsTable.id, observationsTable.catId))
    .where(eq(observationsTable.kind, "ear_tip"));
  if (earTipCats.length === 0) return [];

  const records = await loadCatRecords(earTipCats.map((c) => c.id));

  const evidenceSightingIds = [
    ...new Set(
      [...records.values()].flatMap((r) =>
        r.observations
          .filter((o) => o.kind === "ear_tip" && o.sightingId != null)
          .map((o) => o.sightingId!),
      ),
    ),
  ];
  const handPickRows =
    evidenceSightingIds.length === 0
      ? []
      : await db
          .select({ sightingId: sightingMatchesTable.sightingId })
          .from(sightingMatchesTable)
          .where(
            and(
              inArray(sightingMatchesTable.sightingId, evidenceSightingIds),
              eq(sightingMatchesTable.choice, "hand_pick"),
            ),
          );
  const handPickedSightings = new Set(handPickRows.map((r) => r.sightingId));

  const drafts: (Omit<LikelyCat, "evidence"> & {
    evidence: Omit<LikelyEvidence, "photoUrl">[];
  })[] = [];

  for (const cat of earTipCats) {
    const record = records.get(cat.id);
    if (!record) continue;
    const snapshot = resolveCat(record.observations, record.evidenceOfLife, now);
    if (snapshot.sterilised.confidence !== "likely") continue;

    // The list rule. A cat at Likely always has an active clipped answer.
    const newest = newestActiveClip(record.observations);
    if (!newest || TEAM_ROLES.has(newest.roleAtTime)) continue;

    const replaced = new Set(
      record.observations.map((o) => o.supersedesId).filter((id) => id != null),
    );
    const evidence = record.observations
      .filter((o) => {
        if (o.kind !== "ear_tip" || replaced.has(o.id)) return false;
        const v = o.value as { clipped?: unknown };
        return v?.clipped === true && o.photoId != null;
      })
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())
      .map((o) => ({
        observationId: o.id,
        photoId: o.photoId,
        observedAt: o.observedAt.toISOString(),
        side:
          typeof (o.value as { side?: unknown })?.side === "string"
            ? (o.value as { side: string }).side
            : null,
        matchedByHand: o.sightingId != null && handPickedSightings.has(o.sightingId),
      }));

    drafts.push({
      catId: cat.id,
      name: cat.name,
      sterilisedAsOf: snapshot.sterilised.asOf,
      matchedByHand: evidence.some((e) => e.matchedByHand),
      reviewObservationId: newest.id,
      evidence,
    });
  }

  const photoIds = [
    ...new Set(
      drafts.flatMap((c) =>
        c.evidence.map((e) => e.photoId).filter((id): id is number => id != null),
      ),
    ),
  ];
  const photoRows =
    photoIds.length === 0
      ? []
      : await db
          .select({ id: photosTable.id, publicId: photosTable.publicId })
          .from(photosTable)
          .where(inArray(photosTable.id, photoIds));
  const publicIdByPhotoId = new Map(photoRows.map((p) => [p.id, p.publicId]));

  const likely: LikelyCat[] = drafts.map((c) => ({
    ...c,
    evidence: c.evidence.map((e) => {
      const publicId = e.photoId == null ? undefined : publicIdByPhotoId.get(e.photoId);
      return { ...e, photoUrl: publicId ? teamPhotoUrl(publicId) : null };
    }),
  }));

  likely.sort(
    (a, b) =>
      Number(b.matchedByHand) - Number(a.matchedByHand) ||
      new Date(b.sterilisedAsOf).getTime() - new Date(a.sterilisedAsOf).getTime(),
  );
  return likely;
}
