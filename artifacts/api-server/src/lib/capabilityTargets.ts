import {
  catsTable,
  db,
  observationsTable,
  photosTable,
  sightingsTable,
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
//   photo, a sighting's photo, or a statement's photo). It may be tied to
//   more than one, so this returns one target per cat and the check must pass
//   for EVERY one of them. A photo tied to no cat gets one target with no
//   colony, which only island holders pass.
// - (Later PRs add a report's target, its cat's colony, with SYC-44's
//   `kind = 'welfare'` filter in the same query (PR 3.3), and a feeding
//   site's, its own colony column (SYC-209 PR 4.1). Neither has a route yet.)
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
 */
export async function canonicalCats(
  catIds: readonly number[],
  q: Pick<typeof db, "execute"> = db,
): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  for (const id of new Set(catIds)) {
    let at = id;
    const seen = new Set<number>([id]);
    let resolved: number | null = null;
    for (let hop = 0; hop <= MAX_MERGE_HOPS; hop++) {
      const r = await q.execute<{ canonical: number }>(sql`
        select ci.canonical_cat_id as canonical from cat_identity ci
         where ci.cat_id = ${at}
           and ci.canonical_cat_id <> ${at}
           and not exists (select 1 from cat_identity u where u.supersedes_id = ci.id)
         order by ci.id desc
         limit 1`);
      const next = r.rows[0]?.canonical;
      if (next === undefined) {
        resolved = at;
        break;
      }
      if (seen.has(Number(next))) break;
      seen.add(Number(next));
      at = Number(next);
    }
    out.set(id, resolved);
  }
  return out;
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
  const [asMain, asSighting, asStatement] = await Promise.all([
    db
      .select({ catId: catsTable.id })
      .from(catsTable)
      .where(eq(catsTable.primaryPhotoId, photo.id)),
    db
      .select({ catId: sightingsTable.catId })
      .from(sightingsTable)
      .where(and(eq(sightingsTable.photoId, photo.id), isNotNull(sightingsTable.catId))),
    db
      .select({ catId: observationsTable.catId })
      .from(observationsTable)
      .where(eq(observationsTable.photoId, photo.id)),
  ]);
  return [...asMain, ...asSighting, ...asStatement]
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
