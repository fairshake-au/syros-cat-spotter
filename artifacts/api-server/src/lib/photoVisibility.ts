import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db,
  photosTable,
  photoVisibilityEventsTable,
  sightingsTable,
  welfareReportsTable,
  type PhotoVisibilityEvent,
} from "@workspace/db";
import { can } from "./capabilities";
import { teamOnlyPhotoIds } from "./teamOnlyPhotos";

// Hiding a photo from the public (SYC-43 part 2 plan, PR 6; Decision 3 and 4).
//
// **This file is the only place photo visibility is decided, and the only
// place a public photo address is built.** Every public reader goes through
// publicPhotoUrl() (or catDisplayPhotos(), which uses it), and the cat and
// sighting serialisers in catHelpers.ts accept only the PublicPhotoUrl type
// it returns. A source test (P6-0, photoVisibility.test.ts) fails if the
// public photo path is written anywhere else under src/, apart from the photo
// route itself and tests. A missed reader would otherwise be silent: a hidden
// photo still public, with every test green.
//
// A photo is hidden while its newest event in photo_visibility_events (the
// highest id) is "hide". Nothing is ever updated or deleted; a restore is one
// more row. Staff still see hidden photos, through the team photo route.

/** A public photo address. Only {@link publicPhotoUrl} makes one. */
export type PublicPhotoUrl = string & { readonly __publicPhotoUrl: unique symbol };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The global pool, or a transaction: inside one, every read goes through it. */
type Queryable = typeof db | Tx;

/** The newest event for each of `ids` that has one. One query. */
async function newestEvents(
  ids: readonly number[],
  q: Queryable,
): Promise<Map<number, PhotoVisibilityEvent>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const out = new Map<number, PhotoVisibilityEvent>();
  if (unique.length === 0) return out;
  const rows = await q
    .selectDistinctOn([photoVisibilityEventsTable.photoId])
    .from(photoVisibilityEventsTable)
    .where(inArray(photoVisibilityEventsTable.photoId, unique))
    .orderBy(photoVisibilityEventsTable.photoId, desc(photoVisibilityEventsTable.id));
  for (const r of rows) out.set(r.photoId, r);
  return out;
}

/**
 * Which of these photos are hidden from the public: their newest event is a
 * hide, or they were removed for good (SYC-462 spec §4.5: removed implies
 * hidden, so every route that asks this treats a removed photo as hidden,
 * whatever its log says), or they are a vet visit's team-only photos
 * (SYC-677, teamOnlyPhotos.ts: team-only implies hidden the same way, so
 * every public reader, the stand-in rule and the guardian's refusal on the
 * team photo route cover them). Three batched queries.
 */
export async function hiddenPhotoIds(
  ids: readonly number[],
  q: Queryable = db,
): Promise<Set<number>> {
  const newest = await newestEvents(ids, q);
  const out = new Set([...newest].filter(([, e]) => e.action === "hide").map(([id]) => id));
  const unique = [...new Set(ids)];
  if (unique.length > 0) {
    const removed = await q
      .select({ id: photosTable.id })
      .from(photosTable)
      .where(and(inArray(photosTable.id, unique), isNotNull(photosTable.removedAt)));
    for (const r of removed) out.add(r.id);
    for (const id of await teamOnlyPhotoIds(unique, q)) out.add(id);
  }
  return out;
}

/**
 * Which of these photos were removed for good (SYC-462). Each is also in
 * {@link hiddenPhotoIds}; this says the stronger thing, for the app's
 * "Photo removed" tile. One batched query.
 */
export async function removedPhotoIds(ids: readonly number[], q: Queryable = db): Promise<Set<number>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const rows = await q
    .select({ id: photosTable.id })
    .from(photosTable)
    .where(and(inArray(photosTable.id, unique), isNotNull(photosTable.removedAt)));
  return new Set(rows.map((r) => r.id));
}

/**
 * Which of these photos are hidden for a privacy reason (SYC-303): hidden now,
 * and either hidden with the reason `privacy` (the team's tick) or named by a
 * `photo_private` report. Like SYC-462's `hiddenForPrivacy`
 * (lib/db photoRemoval/eligibility.ts), except that eligibility counts a
 * report even once the photo is public again. Here a photo the team has
 * restored is public on purpose, so it is matched again: only a photo hidden
 * right now can be in the set.
 * Two batched queries.
 */
export async function privacyHiddenPhotoIds(
  ids: readonly number[],
  q: Queryable = db,
): Promise<Set<number>> {
  const hidden = [...(await hiddenPhotoIds(ids, q))];
  const out = new Set<number>();
  if (hidden.length === 0) return out;
  // A photo hidden now has a hide as its newest event (or was removed for
  // good); a hide after the last restore is exactly that newest event.
  for (const [id, e] of await newestEvents(hidden, q)) {
    if (e.action === "hide" && e.reason === "privacy") out.add(id);
  }
  const reported = await q
    .select({ id: welfareReportsTable.photoId })
    .from(welfareReportsTable)
    .where(
      and(
        inArray(welfareReportsTable.photoId, hidden),
        eq(welfareReportsTable.kind, "content"),
        eq(welfareReportsTable.reason, "photo_private"),
      ),
    );
  for (const r of reported) if (r.id !== null) out.add(r.id);
  return out;
}

/**
 * The photo each cat is compared by when a new spot is matched (SYC-303,
 * Samuel's choice (b)): its main photo, unless that is hidden for a privacy
 * reason; then the photo the public sees instead (the same stand-in rule as
 * {@link catDisplayPhotoIds}), or null when there is none, and the cat is
 * not compared. A main photo hidden for any other reason is still used.
 * `cats.primary_photo_id` is never changed.
 */
export async function catMatchingPhotoIds(
  cats: readonly { id: number; primaryPhotoId: number }[],
  q: Queryable = db,
): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  const privateIds = await privacyHiddenPhotoIds(
    cats.map((c) => c.primaryPhotoId).filter((id) => id > 0),
    q,
  );
  const needStandIn = cats.filter((c) => privateIds.has(c.primaryPhotoId));
  for (const c of cats) if (!privateIds.has(c.primaryPhotoId)) out.set(c.id, c.primaryPhotoId);
  if (needStandIn.length > 0) {
    for (const [catId, photoId] of await catDisplayPhotoIds(needStandIn, q)) out.set(catId, photoId);
  }
  return out;
}

/**
 * **The only builder of a public photo address.** Null for a hidden photo,
 * and for a photo that isn't there (the `primaryPhotoId: 0` sentinel, or a
 * row that has gone).
 */
export function publicPhotoUrl(
  photo: { id: number; publicId: string } | null | undefined,
  hidden: ReadonlySet<number>,
): PublicPhotoUrl | null {
  if (!photo || hidden.has(photo.id)) return null;
  return `/api/photos/${photo.publicId}` as PublicPhotoUrl;
}

/**
 * The photo the public sees for each cat (Decision 4): its main photo; if
 * the team has hidden that, the newest photo of the cat that isn't hidden
 * (from its resolved sightings, which are already public on its page); if
 * every one is hidden, null, and the app shows its placeholder.
 * `cats.primary_photo_id` is never changed, so a restore brings the main
 * photo back on its own. SYC-163 replaces the stand-in rule when the team can
 * choose a main photo.
 *
 * Batched: two queries for any number of cats, plus two more only when some
 * main photo is hidden.
 */
export async function catDisplayPhotos(
  cats: readonly { id: number; primaryPhotoId: number }[],
  q: Queryable = db,
): Promise<Map<number, PublicPhotoUrl | null>> {
  const out = new Map<number, PublicPhotoUrl | null>();
  for (const [catId, photo] of await displayPhotoRows(cats, q)) {
    // The chosen photo is public by construction, so nothing is hidden here.
    out.set(catId, publicPhotoUrl(photo, NOTHING_HIDDEN));
  }
  return out;
}

/**
 * The same choice as {@link catDisplayPhotos}, as photo ids rather than
 * addresses (SYC-161, rule R1): which photo the public sees for each cat, or
 * null when none. The colour reader reads exactly this photo, so a photo the
 * team hid is never sent to the model. Both functions share one stand-in
 * rule ({@link displayPhotoRows}); nothing parses an address back into an id.
 */
export async function catDisplayPhotoIds(
  cats: readonly { id: number; primaryPhotoId: number }[],
  q: Queryable = db,
): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  for (const [catId, photo] of await displayPhotoRows(cats, q)) out.set(catId, photo?.id ?? null);
  return out;
}

const NOTHING_HIDDEN: ReadonlySet<number> = new Set();

/**
 * **The one stand-in rule** behind {@link catDisplayPhotos} and
 * {@link catDisplayPhotoIds}: for each cat, the photo row the public sees,
 * or null.
 */
async function displayPhotoRows(
  cats: readonly { id: number; primaryPhotoId: number }[],
  q: Queryable,
): Promise<Map<number, { id: number; publicId: string } | null>> {
  const out = new Map<number, { id: number; publicId: string } | null>();
  const mainIds = [...new Set(cats.map((c) => c.primaryPhotoId).filter((id) => id > 0))];
  const mains = mainIds.length
    ? await q
        .select({ id: photosTable.id, publicId: photosTable.publicId })
        .from(photosTable)
        .where(inArray(photosTable.id, mainIds))
    : [];
  const mainById = new Map(mains.map((p) => [p.id, p]));
  const hidden = await hiddenPhotoIds(mains.map((p) => p.id), q);

  const needStandIn: number[] = [];
  for (const c of cats) {
    const main = mainById.get(c.primaryPhotoId);
    out.set(c.id, main && !hidden.has(main.id) ? main : null);
    if (main && hidden.has(main.id)) needStandIn.push(c.id);
  }
  if (needStandIn.length === 0) return out;

  // SYC-415 spec §6.3: the stand-in uses cover photos only; an extra photo is
  // never promoted automatically.
  const candidates = await q
    .select({
      catId: sightingsTable.catId,
      id: photosTable.id,
      publicId: photosTable.publicId,
    })
    .from(sightingsTable)
    .innerJoin(photosTable, eq(photosTable.id, sightingsTable.photoId))
    .where(
      and(inArray(sightingsTable.catId, needStandIn), eq(sightingsTable.status, "resolved")),
    )
    .orderBy(desc(sightingsTable.createdAt), desc(sightingsTable.id));
  const hiddenCandidates = await hiddenPhotoIds(candidates.map((p) => p.id), q);
  for (const p of candidates) {
    if (p.catId == null || out.get(p.catId) != null) continue;
    if (!hiddenCandidates.has(p.id)) out.set(p.catId, { id: p.id, publicId: p.publicId });
  }
  return out;
}

/** {@link catDisplayPhotos} for one cat. */
export async function catDisplayPhoto(
  cat: { id: number; primaryPhotoId: number },
  q: Queryable = db,
): Promise<PublicPhotoUrl | null> {
  return (await catDisplayPhotos([cat], q)).get(cat.id) ?? null;
}

// ── The team's side ────────────────────────────────────────────────────────

/** Who hid a photo and when, for the team's pages. Null while it is public. */
export interface PhotoHidden {
  /** A team member's people.id, or `report:<id>` (SYC-44). */
  author: string;
  personId: string | null;
  at: Date;
  reason: string | null;
}

/** For each of `ids`: who hid it and when, or nothing if it is public. */
export async function hiddenDetails(
  ids: readonly number[],
  q: Queryable = db,
): Promise<Map<number, PhotoHidden>> {
  const out = new Map<number, PhotoHidden>();
  for (const [photoId, e] of await newestEvents(ids, q)) {
    if (e.action !== "hide") continue;
    out.set(photoId, { author: e.author, personId: e.personId, at: e.at, reason: e.reason });
  }
  return out;
}

type Person = { id: string; scopes: { role: string; colonyId: number | null }[] };

export type VisibilityAction = "hide" | "restore";

export type VisibilityOutcome =
  | { kind: "changed"; event: PhotoVisibilityEvent }
  /** Already in that state (a second tab, or a double tap): nothing written. */
  | { kind: "already" }
  | { kind: "not_found" }
  | { kind: "not_authorised" }
  /** SYC-462: removed for good. It stays hidden and can't be restored. */
  | { kind: "removed"; removedAt: Date };

const CAPABILITY = { hide: "hide_photo", restore: "restore_photo" } as const;

/**
 * A team member hides or restores a photo (§3.3: one tap, reversible).
 * Checked here as well as on the route, by capability name: hide_photo or
 * restore_photo.
 *
 * In one transaction: lock the photo row, read its newest event through the
 * transaction, and write one event only if that changes something. Two
 * people (or two tabs) hiding the same photo at once queue on the lock; the
 * second finds it already hidden and writes nothing. The lock is also what
 * makes "newest = highest id" true (schema/photoVisibility.ts). SYC-44's
 * report-author writer must take the same lock.
 */
export async function setPhotoVisibility(
  person: Person,
  input: { publicId: string; action: VisibilityAction; reason?: string | null },
): Promise<VisibilityOutcome> {
  if (!can(person, CAPABILITY[input.action])) return { kind: "not_authorised" };
  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ id: number; removed_at: Date | string | null }>(
      sql`select id, removed_at from photos where public_id = ${input.publicId} for update`,
    );
    const photoId = locked.rows[0]?.id;
    if (photoId === undefined) return { kind: "not_found" } as const;
    // SYC-462 spec §6 item 2: a removed photo is hidden for good (migration
    // 0034's trigger refuses the event too). A hide falls through to "already".
    const removedAt = locked.rows[0]!.removed_at;
    if (removedAt !== null && input.action === "restore") {
      return { kind: "removed", removedAt: new Date(removedAt) } as const;
    }
    const newest = (await newestEvents([photoId], tx)).get(photoId);
    const hiddenNow = newest?.action === "hide";
    if ((input.action === "hide") === hiddenNow) return { kind: "already" } as const;
    const [event] = await tx
      .insert(photoVisibilityEventsTable)
      .values({
        photoId,
        action: input.action,
        author: person.id,
        personId: person.id,
        reason: input.reason?.trim() || null,
        // The moment of the write, not the transaction's start.
        at: sql`clock_timestamp()`,
      })
      .returning();
    return { kind: "changed", event: event! } as const;
  });
}
