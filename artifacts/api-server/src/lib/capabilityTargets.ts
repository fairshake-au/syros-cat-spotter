import {
  catsTable,
  db,
  feedingSitesTable,
  observationsTable,
  photosTable,
  sightingPhotosTable,
  sightingsTable,
  vetBatchCatsTable,
  vetBatchPhotosTable,
  vetVisitPhotosTable,
} from "@workspace/db";
import { eq, isNotNull, and, sql } from "drizzle-orm";
import type { CapabilityTarget } from "./capabilities";
import { currentColonyOf } from "./colonyMembership";

// Where a check applies, read FROM THE RECORD, never from the request
// (roles-and-invites.md §6.1; SYC-53 PR 0.5, test T5). A guardian can't name
// her own colony in a query string or a form to reach someone else's cat.
//
// - A cat's colony is its newest active `colony` statement (superseded ones
//   ignored; `colonyId: null` means none), through colonyMembership.ts, the
//   one place that rule lives.
// - A photo's colony is its cats': every cat it is tied to (as a cat's main
//   photo, a sighting's photo, one of a sighting's extra photos (SYC-415), or a
//   statement's photo). It may be tied to
//   more than one, so this returns one target per cat and the check must pass
//   for EVERY one of them. A photo tied to no cat gets one target with no
//   colony, which only island holders pass.
// - A feeding site's colony is its own colony column (`siteTarget`, SYC-209
//   PR 4.2). A site in no colony, or no such site, gets a target with no
//   colony, which only island holders pass.
// - (A later PR adds a report's target, its cat's colony, with SYC-44's
//   `kind = 'welfare'` filter in the same query (PR 3.3).)
//
// A cat in no colony has no placed target, so only island holders pass.
//
// A cat merged into another (`cat_identity`, data spine §10.3) is judged by
// the cat it was merged INTO (SYC-333, PR 2.1): its own old colony
// statements no longer say where it belongs. Merges don't exist yet (SYC-59),
// so today every cat is its own canonical cat.

type Reader = Parameters<typeof currentColonyOf>[1];

/** How many merges deep to follow before giving up (a loop is bad data). */
const MAX_MERGE_HOPS = 8;

/**
 * The cat each of these is now (itself, or the cat it was merged into, through
 * every merge nothing has undone). A chain that loops, or runs deeper than
 * any real one could, resolves to null: no colony, so only the team passes.
 *
 * One query whatever the number of cats (data spine §2.3: never one query
 * per cat): a recursive walk over the merges still standing, at most
 * MAX_MERGE_HOPS deep. Where a cat has more than one standing merge (bad
 * data), the newest row counts.
 */
export async function canonicalCats(
  catIds: readonly number[],
  q: Pick<typeof db, "execute"> = db,
): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  const ids = [...new Set(catIds)].filter((id) => Number.isInteger(id));
  if (ids.length === 0) return out;
  const r = await q.execute<{ start: number; canonical: number | null }>(sql`
    with recursive standing as (
      select distinct on (ci.cat_id) ci.cat_id, ci.canonical_cat_id
        from cat_identity ci
       where ci.canonical_cat_id <> ci.cat_id
         and not exists (select 1 from cat_identity u where u.supersedes_id = ci.id)
       order by ci.cat_id, ci.id desc
    ),
    walk (start, at, depth, path) as (
      select s, s, 0, array[s]
        from unnest(${`{${ids.join(",")}}`}::int[]) as s
      union all
      select w.start, m.canonical_cat_id, w.depth + 1, w.path || m.canonical_cat_id
        from walk w
        join standing m on m.cat_id = w.at
       where w.depth < ${MAX_MERGE_HOPS}
         and not (m.canonical_cat_id = any (w.path))
    ),
    deepest as (
      select distinct on (start) start, at from walk order by start, depth desc
    )
    select d.start,
           case when exists (select 1 from standing m where m.cat_id = d.at) then null else d.at end as canonical
      from deepest d`);
  for (const row of r.rows) out.set(Number(row.start), row.canonical === null ? null : Number(row.canonical));
  return out;
}

/**
 * One cat's target and the cat it is now, from one lookup: for a route that
 * must both check the target and show the canonical cat.
 */
export async function catTargetWithCanonical(
  catId: number,
): Promise<{ target: CapabilityTarget; canonicalId: number | null }> {
  const canonical = await canonicalCats([catId]);
  const canonicalId = canonical.get(catId) ?? null;
  const colonies = canonicalId === null ? new Map<number, number>() : await currentColonyOf([canonicalId]);
  return {
    target: { colonyId: canonicalId === null ? null : (colonies.get(canonicalId) ?? null) },
    canonicalId,
  };
}

/** Colony targets for these cats, each judged as its canonical cat. */
async function targetsOf(catIds: readonly number[], q?: Reader & Pick<typeof db, "execute">) {
  const canonical = await canonicalCats(catIds, q);
  const ids = [...new Set([...canonical.values()].filter((c): c is number => c !== null))];
  const colonies = await currentColonyOf(ids, q);
  return (catId: number): CapabilityTarget => {
    const c = canonical.get(catId);
    return { colonyId: c == null ? null : (colonies.get(c) ?? null) };
  };
}

/**
 * The target for one cat. Inside a transaction, pass it: a second connection
 * taken while the transaction holds one can starve the pool under a burst.
 */
export async function catTarget(
  catId: number,
  q?: Reader & Pick<typeof db, "execute">,
): Promise<CapabilityTarget> {
  return (await targetsOf([catId], q))(catId);
}

/** One target per cat, for checking every one of them. */
async function catTargets(catIds: readonly number[]): Promise<CapabilityTarget[]> {
  const unique = [...new Set(catIds)];
  if (unique.length === 0) return [{ colonyId: null }];
  const targetOf = await targetsOf(unique);
  return unique.map(targetOf);
}

/** The cats a stored photo is tied to, by its public id. */
export async function catsOfPhoto(publicId: string): Promise<number[]> {
  const [photo] = await db
    .select({ id: photosTable.id })
    .from(photosTable)
    .where(eq(photosTable.publicId, publicId));
  if (!photo) return [];
  const [asMain, asSighting, asSpotPhoto, asStatement, asKept, asStaged] = await Promise.all([
    db
      .select({ catId: catsTable.id })
      .from(catsTable)
      .where(eq(catsTable.primaryPhotoId, photo.id)),
    db
      .select({ catId: sightingsTable.catId })
      .from(sightingsTable)
      .where(and(eq(sightingsTable.photoId, photo.id), isNotNull(sightingsTable.catId))),
    // SYC-415 spec §6.3: a spot's extra photos (face, body) belong to the cat
    // the spot was resolved to. A cover photo is also found by the query
    // above; seen twice is harmless, targetsOf() de-duplicates by cat.
    db
      .select({ catId: sightingsTable.catId })
      .from(sightingPhotosTable)
      .innerJoin(sightingsTable, eq(sightingsTable.id, sightingPhotosTable.sightingId))
      .where(and(eq(sightingPhotosTable.photoId, photo.id), isNotNull(sightingsTable.catId))),
    db
      .select({ catId: observationsTable.catId })
      .from(observationsTable)
      .where(eq(observationsTable.photoId, photo.id)),
    // SYC-677: a vet visit's kept photo, and a batch's staged photo (of a cat
    // already in the catalogue), belong to that cat. Both are team-only
    // (teamOnlyPhotos.ts), so a cat guardian of that cat's colony passes
    // this check and is then refused as for a hidden photo.
    db
      .select({ catId: vetVisitPhotosTable.catId })
      .from(vetVisitPhotosTable)
      .where(eq(vetVisitPhotosTable.photoId, photo.id)),
    db
      .select({ catId: vetBatchCatsTable.catId })
      .from(vetBatchPhotosTable)
      .innerJoin(vetBatchCatsTable, eq(vetBatchCatsTable.id, vetBatchPhotosTable.batchCatId))
      .where(and(eq(vetBatchPhotosTable.photoId, photo.id), isNotNull(vetBatchCatsTable.catId))),
  ]);
  return [...asMain, ...asSighting, ...asSpotPhoto, ...asStatement, ...asKept, ...asStaged]
    .map((r) => r.catId)
    .filter((id): id is number => typeof id === "number");
}

// The only shape a photo's public id takes (base64url or a uuid). Anything
// else is not a photo, and is never sent to Postgres (which refuses some
// bytes, a NUL say, with an error): it has no cats, so no colony.
const PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Every target a catalogue photo must pass: one per cat it is tied to. */
export async function photoTargets(publicId: string): Promise<CapabilityTarget[]> {
  if (!PHOTO_ID_RE.test(publicId)) return [{ colonyId: null }];
  return catTargets(await catsOfPhoto(publicId));
}

// A site's id as a route carries it: digits only, nothing Postgres would refuse.
const SITE_ID_RE = /^[1-9][0-9]{0,8}$/;

/**
 * The target for one feeding site: its own colony, read from the record
 * (SYC-209 PR 4.2). Anything that isn't a site id, no such site, and a site
 * in no colony all answer `{ colonyId: null }`, so a cat guardian is refused
 * each of them the same way, and can't tell another colony's site from one
 * that doesn't exist.
 */
export async function siteTarget(rawId: unknown): Promise<CapabilityTarget> {
  if (typeof rawId !== "string" || !SITE_ID_RE.test(rawId)) return { colonyId: null };
  const [site] = await db
    .select({ colonyId: feedingSitesTable.colonyId })
    .from(feedingSitesTable)
    .where(eq(feedingSitesTable.id, Number(rawId)));
  return { colonyId: site?.colonyId ?? null };
}
