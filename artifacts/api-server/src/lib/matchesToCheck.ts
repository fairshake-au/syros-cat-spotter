import { catsTable, db, photosTable, sightingMatchesTable, sightingMovesTable, sightingsTable } from "@workspace/db";
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { areaByKey } from "./areas/namedAreas";
import { canonicalCatOf } from "./catIdentity";
import { can, type CapabilityHolder } from "./capabilities";
import { MoveRefused } from "./moveSightings";
import { catDisplayPhotos } from "./photoVisibility";
import { launchMidnight, MERGE_REASONS, MERGE_SOURCES } from "./reports/launchMeasures";

// Matches to check (SYC-795, launch measures spec §4.6). The suggestions
// spotters took that nobody has checked or moved yet, since launch, oldest
// first, for Samuel to answer "Looks right" or "Different cat". Team-only,
// behind `move_sighting`. It names no spotter and no device, and the only
// place it gives is the named area (never a position).

export interface MatchToCheck {
  sightingId: number;
  catId: number;
  catName: string;
  /** 1, 2 or 3: which of the app's suggestions the spotter took. */
  rank: number;
  spottedAt: Date;
  /** The named area's words, "Off Syros", or "Somewhere on Syros" when none was stamped. */
  area: string;
  /** The team photo address of the spotter's photo, or null. */
  sightingPhotoUrl: string | null;
  /** The cat's main photo as the public sees it, or null. */
  catPhotoUrl: string | null;
}

type Person = CapabilityHolder & { id: string };

/** The rows that belong on the list: a suggestion taken, no team step, no move other than a merge's, since launch. */
function listed(launch: Date) {
  const list = (xs: readonly string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
  const mv = sightingMovesTable;
  return and(
    eq(sightingMatchesTable.choice, "suggested"),
    isNull(sightingMatchesTable.teamAction),
    isNull(sightingsTable.redactedAt),
    gte(sightingsTable.createdAt, launch),
    // A merge (or its undo) moves sightings between records: not a correction, so it stays listed (§4.3).
    sql`not exists (select 1 from ${mv} where ${mv.sightingId} = ${sightingsTable.id}
      and ${mv.reason} not in (${list(MERGE_REASONS)}) and ${mv.source} not in (${list(MERGE_SOURCES)}))`,
  );
}

/** The list, oldest first (spotted time, then id), so it can't be sorted by how easy a row is (§4.6). */
export async function matchesToCheck(launchDate: string | null): Promise<MatchToCheck[]> {
  const launch = launchMidnight(launchDate);
  if (launch === null) return [];
  const rows = await db
    .select({
      sightingId: sightingsTable.id,
      photoId: sightingsTable.photoId,
      areaKey: sightingsTable.areaKey,
      spottedAt: sightingsTable.createdAt,
      chosenCatId: sightingMatchesTable.chosenCatId,
      rank: sightingMatchesTable.suggestedRank,
    })
    .from(sightingMatchesTable)
    .innerJoin(sightingsTable, eq(sightingsTable.id, sightingMatchesTable.sightingId))
    .where(and(listed(launch), sql`${sightingMatchesTable.chosenCatId} is not null`))
    .orderBy(asc(sightingsTable.createdAt), asc(sightingsTable.id));
  if (rows.length === 0) return [];

  const canonical = await canonicalCatOf(rows.map((r) => r.chosenCatId!));
  const catIds = [...new Set([...canonical.values()].filter((c): c is number => c !== null))];
  const cats = catIds.length
    ? await db.select({ id: catsTable.id, name: catsTable.name, primaryPhotoId: catsTable.primaryPhotoId }).from(catsTable).where(inArray(catsTable.id, catIds))
    : [];
  const catById = new Map(cats.map((c) => [c.id, c]));
  const catPhotos = await catDisplayPhotos(cats);
  const photos = await db
    .select({ id: photosTable.id, publicId: photosTable.publicId })
    .from(photosTable)
    .where(and(inArray(photosTable.id, rows.map((r) => r.photoId)), isNull(photosTable.removedAt)));
  const publicIdOf = new Map(photos.map((p) => [p.id, p.publicId]));

  const out: MatchToCheck[] = [];
  for (const r of rows) {
    const catId = canonical.get(r.chosenCatId!) ?? null;
    const cat = catId === null ? undefined : catById.get(catId);
    if (cat === undefined || r.rank === null) continue;
    const publicId = publicIdOf.get(r.photoId);
    out.push({
      sightingId: r.sightingId,
      catId: cat.id,
      catName: cat.name,
      rank: r.rank,
      spottedAt: r.spottedAt,
      area: r.areaKey === "off" ? "Off Syros" : (areaByKey(r.areaKey)?.name ?? "Somewhere on Syros"),
      sightingPhotoUrl: publicId ? `/api/team/photos/${encodeURIComponent(publicId)}` : null,
      catPhotoUrl: catPhotos.get(cat.id) ?? null,
    });
  }
  return out;
}

/** How many are on the list, for the Home tile. */
export async function matchesToCheckCount(launchDate: string | null): Promise<number> {
  return (await matchesToCheck(launchDate)).length;
}

/**
 * "Looks right": the match record's team step, written once and only while
 * empty (so a press after a move, or a second press, changes nothing). It
 * leaves `team_cat_id` null, which the table's check requires for this action.
 */
export async function markLooksRight(person: Person, sightingId: number): Promise<"done" | "already"> {
  if (!can(person, "move_sighting")) throw new MoveRefused("NOT_AUTHORISED", "Not authorised");
  const done = await db
    .update(sightingMatchesTable)
    .set({ teamAction: "looks_right", teamByAccountId: person.id, teamAt: new Date() })
    .where(
      and(
        eq(sightingMatchesTable.sightingId, sightingId),
        isNull(sightingMatchesTable.teamAction),
        eq(sightingMatchesTable.choice, "suggested"),
      ),
    )
    .returning({ sightingId: sightingMatchesTable.sightingId });
  return done.length === 0 ? "already" : "done";
}
