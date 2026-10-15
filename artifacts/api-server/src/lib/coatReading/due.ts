import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { catIdentityTable, catsTable, db, photosTable, sightingsTable, type Observation } from "@workspace/db";
import { loadCatRecords, type DbOrTx } from "../observations";
import { catDisplayPhotoIds, hiddenPhotoIds } from "../photoVisibility";
import { appearanceAuthorityLevel } from "../resolve";

/**
 * Which cats need a colour reading (SYC-161 plan, rules R1, R2 and R4).
 *
 * R1. The reading is always of the photo the public sees for the cat,
 *     decided only by `photoVisibility.ts` (`catDisplayPhotoIds`). A cat with
 *     no public photo is never read, so a hidden photo never reaches the model.
 * R2. A cat is due when it has a public photo and:
 *     1. it has no machine row at all (rows the team marked wrong and Not
 *        sure rows count as rows); or
 *     2. its main photo is public and the machine's newest reading is not of
 *        the main photo (a restore, or a future "choose a main photo"); or
 *     3. its main photo is hidden and the photo of the machine's newest
 *        reading is no longer public for this cat (a hide).
 *     A new sighting never makes a cat due by itself: a reading stands while
 *     its own photo stays public. When nothing is public, the last reading
 *     stays.
 * R4. A photo that already has a machine reading on this cat is never sent to
 *     the model again. A due cat whose public photo was read before gets a
 *     `copy` of that reading instead, unless the team marked a reading of that
 *     photo wrong: then the cat is not due at all, so a rejected colour never
 *     comes back and the cat isn't reported as due forever.
 *
 * "Newest" is the resolver's order (resolve.ts `isNewer`): `observedAt`, then
 * id. Readings are dated when they're read (R3), so the newest is the last
 * one read.
 *
 * Batched: a fixed number of queries for any number of cats.
 */

export type DueAction = "read" | "copy";

export interface DueCat {
  catId: number;
  /** The photo the public sees: the one to read, or to copy a reading of. */
  photoId: number;
  action: DueAction;
  /** For `copy`: the machine row to copy forward. */
  copyOf?: number;
  /** Which R2 case made it due (for the dry run's report). */
  because: "unread" | "main_restored" | "reading_photo_hidden";
}

/** A machine colour reading: a `coat` row from the reader, not a retraction. */
export function isMachineReading(o: Observation): boolean {
  return (
    o.kind === "coat" &&
    o.provenance === "machine" &&
    !(typeof o.value === "object" && o.value !== null && (o.value as { retracted?: unknown }).retracted === true)
  );
}

/** The resolver's order: `observedAt`, then id. */
function isNewer(a: Observation, b: Observation): boolean {
  const at = a.observedAt.getTime();
  const bt = b.observedAt.getTime();
  return at > bt || (at === bt && a.id > b.id);
}

function newest(rows: readonly Observation[]): Observation | undefined {
  return rows.reduce<Observation | undefined>((best, o) => (!best || isNewer(o, best) ? o : best), undefined);
}

/**
 * Ids of the rows the team marked wrong (superseded by a retraction). Only a
 * retraction the resolver itself honours counts: one from someone the
 * appearance ranking gives standing (`standingAppearanceRows`, resolve.ts).
 * A retraction without standing leaves the reading counting there, so it
 * must not stop the reading being copied forward here (Opus spot review,
 * finding 2).
 */
function markedWrong(observations: readonly Observation[]): Set<number> {
  const out = new Set<number>();
  for (const o of observations) {
    if (
      o.supersedesId != null &&
      appearanceAuthorityLevel(o) !== 0 &&
      (o.kind === "coat" || o.kind === "markings") &&
      typeof o.value === "object" &&
      o.value !== null &&
      (o.value as { retracted?: unknown }).retracted === true
    ) {
      out.add(o.supersedesId);
    }
  }
  return out;
}

/**
 * Every due cat, oldest cat first (`created_at`, then id), up to `limit`.
 * `opts.catIds` narrows the cats looked at (one cat, for `record.ts`'s
 * re-check; or a test's own cats).
 */
export async function catsDueForReading(
  limit: number = Number.POSITIVE_INFINITY,
  q: DbOrTx = db,
  opts: { catIds?: readonly number[] } = {},
): Promise<DueCat[]> {
  if (opts.catIds && opts.catIds.length === 0) return [];
  const cats = await q
    .select({ id: catsTable.id, primaryPhotoId: catsTable.primaryPhotoId })
    .from(catsTable)
    .where(opts.catIds ? inArray(catsTable.id, [...opts.catIds]) : undefined)
    .orderBy(asc(catsTable.createdAt), asc(catsTable.id));
  if (cats.length === 0) return [];

  // A cat folded into another by a merge (SYC-59) is read as part of the cat
  // it now belongs to, never on its own. Today no merge exists, and merged
  // cats refuse writes anyway.
  const folded = new Set(
    (
      await q
        .select({ catId: catIdentityTable.catId })
        .from(catIdentityTable)
        .where(
          and(
            inArray(catIdentityTable.catId, cats.map((c) => c.id)),
            ne(catIdentityTable.catId, catIdentityTable.canonicalCatId),
            isNull(catIdentityTable.supersedesId),
          ),
        )
    ).map((r) => r.catId),
  );
  const live = cats.filter((c) => !folded.has(c.id));

  const display = await catDisplayPhotoIds(live, q);
  // Through cat_identity, like every other reader of observations.
  const records = await loadCatRecords(live.map((c) => c.id), q);

  // R2 case 3 needs to know whether the newest reading's photo is still
  // public FOR THIS CAT: it exists, isn't hidden, and is the cat's main photo
  // or the photo of one of its resolved sightings (where the stand-in comes
  // from). Only asked for cats whose main photo is hidden.
  const ask: { catId: number; photoId: number }[] = [];
  const newestReading = new Map<number, Observation | undefined>();
  for (const c of live) {
    const observations = records.get(c.id)?.observations ?? [];
    const latest = newest(observations.filter(isMachineReading));
    newestReading.set(c.id, latest);
    const shown = display.get(c.id) ?? null;
    const mainPublic = c.primaryPhotoId > 0 && shown === c.primaryPhotoId;
    if (shown != null && !mainPublic && latest?.photoId != null && latest.photoId !== c.primaryPhotoId) {
      ask.push({ catId: c.id, photoId: latest.photoId });
    }
  }
  const stillPublic = await publicSightingPhotos(ask, q);

  const due: DueCat[] = [];
  for (const c of live) {
    if (due.length >= limit) break;
    const shown = display.get(c.id) ?? null;
    if (shown == null) continue; // R1: nothing public, nothing to read.
    const observations = records.get(c.id)?.observations ?? [];
    const latest = newestReading.get(c.id);
    const mainPublic = c.primaryPhotoId > 0 && shown === c.primaryPhotoId;

    let because: DueCat["because"] | null = null;
    if (!latest) because = "unread";
    else if (mainPublic) {
      if (latest.photoId !== c.primaryPhotoId) because = "main_restored";
    } else if (latest.photoId == null || !stillPublic.has(`${c.id}:${latest.photoId}`)) {
      because = "reading_photo_hidden";
    }
    if (!because) continue;
    // Belt and braces: the newest reading is already of the photo shown, so
    // there is nothing to do. Unreachable while the two rules above agree
    // with photoVisibility.ts; it stops a copy repeating every run if they
    // ever drift (SYC-163 rewrites the stand-in rule; Opus spot review,
    // finding 7).
    if (latest?.photoId === shown) continue;

    // R4: the photo to read may have been read before.
    const ofPhoto = observations.filter((o) => isMachineReading(o) && o.photoId === shown);
    if (ofPhoto.length === 0) {
      due.push({ catId: c.id, photoId: shown, action: "read", because });
      continue;
    }
    const wrong = markedWrong(observations);
    if (ofPhoto.some((o) => wrong.has(o.id))) continue; // the team rejected it
    due.push({ catId: c.id, photoId: shown, action: "copy", copyOf: newest(ofPhoto)!.id, because });
  }
  return due;
}

/**
 * Of these (cat, photo) pairs, the ones whose photo is still public for that
 * cat as a stand-in: the photo row exists, it isn't hidden, and it belongs to
 * one of the cat's resolved sightings. Keys are `catId:photoId`. Two queries.
 */
async function publicSightingPhotos(
  pairs: readonly { catId: number; photoId: number }[],
  q: DbOrTx,
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();
  const rows = await q
    .select({ catId: sightingsTable.catId, photoId: photosTable.id })
    .from(sightingsTable)
    .innerJoin(photosTable, eq(photosTable.id, sightingsTable.photoId))
    .where(
      and(
        inArray(sightingsTable.catId, [...new Set(pairs.map((p) => p.catId))]),
        inArray(photosTable.id, [...new Set(pairs.map((p) => p.photoId))]),
        eq(sightingsTable.status, "resolved"),
      ),
    );
  const hidden = await hiddenPhotoIds(rows.map((r) => r.photoId), q);
  const wanted = new Set(pairs.map((p) => `${p.catId}:${p.photoId}`));
  return new Set(
    rows
      .filter((r) => r.catId != null && !hidden.has(r.photoId))
      .map((r) => `${r.catId}:${r.photoId}`)
      .filter((k) => wanted.has(k)),
  );
}
