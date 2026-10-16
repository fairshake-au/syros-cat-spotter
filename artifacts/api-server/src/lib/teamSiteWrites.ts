import { coloniesTable, db, feedingSitesTable } from "@workspace/db";
import { and, asc, eq, sql, type AnyColumn } from "drizzle-orm";
import { colonyFilter, type Visible } from "./guardianView";
import { recordMappingEvent } from "./mappingEvents";
import { inIsland } from "./mapTiles/geometry";

// The team's Feeding sites pages, write side (SYC-209 PR 3.3; spec §2.3 to
// §2.5, §4.5, §8, §11.2; plan K8). Every function takes the person doing it
// and the page's `updated_at` stamp.
//
// **Every write is conditional on what the page showed (spec §11.2).** The
// stamp is the database's own `updated_at::text`, to the microsecond; the
// comparison is done in SQL (the stamp text built by `stampText`), because a
// JavaScript Date drops the microseconds and would make every edit look like
// a clash. The row is read `FOR UPDATE` with that condition in its WHERE:
// a second writer waits for the first to commit, then re-checks the
// condition against the new row and finds nothing, so it changes nothing and
// writes no history. The `updated_at` trigger moves the stamp on every write.
//
// **Every change writes its history row in the same transaction** (spec
// test 11), through `recordMappingEvent`, which is the only writer of the
// history. Nothing here ever sets a site public: `isPublic` is only ever
// written as false (spec test 7).

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const SITE_NAME_MAX = 100;
export const SITE_NOTES_MAX = 2000;
export const SITE_DIRECTIONS_MAX = 300;
export const SITE_REASON_MAX = 500;

/**
 * `updated_at` as the pages carry it: UTC, to the microsecond, in a fixed
 * layout ("2026-10-15 05:12:33.123456"). Built with to_char and compared the
 * same way in SQL, so neither the connection's DateStyle nor its TimeZone can
 * change what a page shows or break the comparison.
 */
export const stampText = (column: AnyColumn) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`;
export const STAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/;

/** What a locked site row looks like to a writer. */
interface Locked {
  id: number;
  name: string;
  lat: number;
  lng: number;
  isPublic: boolean;
  publicId: string | null;
  colonyId: number | null;
  notes: string | null;
  directions: string | null;
  retiredAt: Date | null;
}

type Gate = { kind: "ok"; site: Locked } | { kind: "missing" } | { kind: "stale" };

/**
 * Locks the site row if (and only if) it still has the stamp the page
 * showed. No row: either there is no such site, or someone changed it first.
 */
async function lockFresh(tx: Tx, id: number, seen: string): Promise<Gate> {
  const [site] = await tx
    .select({
      id: feedingSitesTable.id,
      name: feedingSitesTable.name,
      lat: feedingSitesTable.lat,
      lng: feedingSitesTable.lng,
      isPublic: feedingSitesTable.isPublic,
      publicId: feedingSitesTable.publicId,
      colonyId: feedingSitesTable.colonyId,
      notes: feedingSitesTable.notes,
      directions: feedingSitesTable.directions,
      retiredAt: feedingSitesTable.retiredAt,
    })
    .from(feedingSitesTable)
    .where(
      and(
        eq(feedingSitesTable.id, id),
        sql`${stampText(feedingSitesTable.updatedAt)} = ${seen}`,
      ),
    )
    .for("update");
  if (site) return { kind: "ok", site };
  const [there] = await tx
    .select({ id: feedingSitesTable.id })
    .from(feedingSitesTable)
    .where(eq(feedingSitesTable.id, id));
  return there ? { kind: "stale" } : { kind: "missing" };
}

/** A colony that must exist, held in place until this transaction ends. */
async function colonyExists(tx: Tx, id: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: coloniesTable.id })
    .from(coloniesTable)
    .where(eq(coloniesTable.id, id))
    .for("share");
  return row !== undefined;
}

export type Why = "moved" | "colony_changed" | "retired";

/**
 * Takes a public site back to private, in the caller's transaction. Does
 * nothing to a private site. On a public one it sets `is_public = false`
 * (and nothing else: the label, the public code and who made it public
 * stay, spec §4.5) and writes `made_private_moved` or
 * `made_private_colony_changed`. For a retire the `retired` event is the
 * record, so no second row is written. Returns whether it changed anything.
 *
 * Live once sites can be public (PR 6.2); written now so the rule can't be
 * forgotten when publishing arrives.
 */
export async function makePrivateIfPublic(
  tx: Tx,
  site: { id: number; isPublic: boolean },
  why: Why,
  personId: string,
): Promise<boolean> {
  if (!site.isPublic) return false;
  await tx
    .update(feedingSitesTable)
    .set({ isPublic: false })
    .where(eq(feedingSitesTable.id, site.id));
  if (why !== "retired") {
    await recordMappingEvent(tx, {
      subjectKind: "site",
      subjectId: site.id,
      kind: why === "moved" ? "made_private_moved" : "made_private_colony_changed",
      personId,
    });
  }
  return true;
}

export type Failure = { kind: "missing" } | { kind: "stale" };

// ── Add ────────────────────────────────────────────────────────────────────

export interface NewSite {
  name: string;
  colonyId: number | null;
  directions: string | null;
  notes: string | null;
  lat: number;
  lng: number;
}

/**
 * Adds a site. It is always private: there is no visibility argument, and
 * nothing the form sends can set one (spec test 7).
 */
export async function addSite(
  personId: string,
  input: NewSite,
): Promise<{ kind: "created"; id: number } | { kind: "no_colony" } | { kind: "outside" }> {
  if (!inIsland({ lat: input.lat, lng: input.lng })) return { kind: "outside" };
  return db.transaction(async (tx) => {
    if (input.colonyId !== null && !(await colonyExists(tx, input.colonyId))) {
      return { kind: "no_colony" as const };
    }
    const [row] = await tx
      .insert(feedingSitesTable)
      .values({
        name: input.name,
        colonyId: input.colonyId,
        lat: input.lat,
        lng: input.lng,
        notes: input.notes,
        directions: input.directions,
        isPublic: false,
      })
      .returning({ id: feedingSitesTable.id });
    const id = row!.id;
    await recordMappingEvent(tx, {
      subjectKind: "site",
      subjectId: id,
      kind: "created",
      personId,
      after: { name: input.name, lat: input.lat, lng: input.lng, colonyId: input.colonyId },
    });
    return { kind: "created" as const, id };
  });
}

// ── Edit details ───────────────────────────────────────────────────────────

export interface SiteDetails {
  name?: string;
  notes?: string | null;
  directions?: string | null;
}

// Retired sites stay editable, movable and re-colonisable, by decision (review
// of PR 3.3): it is harmless (a retired site is private and off every list
// by default) and lets the team tidy the records. Only Retire itself refuses
// a retired site.

/**
 * Name, notes and "how to find it": one history row for each that differs. A
 * field left out (undefined) is left alone; null clears notes and directions.
 */
export async function editSite(
  personId: string,
  id: number,
  seen: string,
  next: SiteDetails,
): Promise<Failure | { kind: "unchanged" } | { kind: "saved"; events: number }> {
  return db.transaction(async (tx) => {
    const gate = await lockFresh(tx, id, seen);
    if (gate.kind !== "ok") return gate;
    const s = gate.site;
    const set: Partial<SiteDetails> = {};
    const events: Array<{
      kind: "renamed" | "notes_edited" | "directions_edited";
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }> = [];
    if (next.name !== undefined && next.name !== s.name) {
      set.name = next.name;
      events.push({ kind: "renamed", before: { name: s.name }, after: { name: next.name } });
    }
    if (next.notes !== undefined && next.notes !== s.notes) {
      set.notes = next.notes;
      events.push({ kind: "notes_edited", before: { notes: s.notes }, after: { notes: next.notes } });
    }
    if (next.directions !== undefined && next.directions !== s.directions) {
      set.directions = next.directions;
      events.push({
        kind: "directions_edited",
        before: { directions: s.directions },
        after: { directions: next.directions },
      });
    }
    if (events.length === 0) return { kind: "unchanged" as const };
    await tx.update(feedingSitesTable).set(set).where(eq(feedingSitesTable.id, id));
    for (const e of events) {
      await recordMappingEvent(tx, { subjectKind: "site", subjectId: id, personId, ...e });
    }
    return { kind: "saved" as const, events: events.length };
  });
}

// ── Move ───────────────────────────────────────────────────────────────────

/** Moves a site (with the reason) and, if it was public, makes it private (spec §4.5). */
export async function moveSite(
  personId: string,
  id: number,
  seen: string,
  to: { lat: number; lng: number },
  reason: string,
): Promise<
  Failure | { kind: "outside" } | { kind: "unchanged" } | { kind: "saved"; madePrivate: boolean }
> {
  if (!inIsland(to)) return { kind: "outside" };
  return db.transaction(async (tx) => {
    const gate = await lockFresh(tx, id, seen);
    if (gate.kind !== "ok") return gate;
    const s = gate.site;
    if (s.lat === to.lat && s.lng === to.lng) return { kind: "unchanged" as const };
    await tx
      .update(feedingSitesTable)
      .set({ lat: to.lat, lng: to.lng })
      .where(eq(feedingSitesTable.id, id));
    await recordMappingEvent(tx, {
      subjectKind: "site",
      subjectId: id,
      kind: "moved",
      personId,
      before: { lat: s.lat, lng: s.lng },
      after: { lat: to.lat, lng: to.lng },
      note: reason,
    });
    const madePrivate = await makePrivateIfPublic(tx, s, "moved", personId);
    return { kind: "saved" as const, madePrivate };
  });
}

// ── Change colony ──────────────────────────────────────────────────────────

/** Puts a site in another colony, or in none; a public site goes private (spec §4.7). */
export async function changeSiteColony(
  personId: string,
  id: number,
  seen: string,
  colonyId: number | null,
): Promise<
  Failure | { kind: "no_colony" } | { kind: "unchanged" } | { kind: "saved"; madePrivate: boolean }
> {
  return db.transaction(async (tx) => {
    const gate = await lockFresh(tx, id, seen);
    if (gate.kind !== "ok") return gate;
    const s = gate.site;
    if (colonyId !== null && !(await colonyExists(tx, colonyId))) {
      return { kind: "no_colony" as const };
    }
    if (colonyId === s.colonyId) return { kind: "unchanged" as const };
    await tx.update(feedingSitesTable).set({ colonyId }).where(eq(feedingSitesTable.id, id));
    await recordMappingEvent(tx, {
      subjectKind: "site",
      subjectId: id,
      kind: "colony_changed",
      personId,
      before: { colonyId: s.colonyId },
      after: { colonyId },
    });
    const madePrivate = await makePrivateIfPublic(tx, s, "colony_changed", personId);
    return { kind: "saved" as const, madePrivate };
  });
}

// ── Retire and bring back ──────────────────────────────────────────────────

/** Retires a site, with the reason. A public site is made private first. */
export async function retireSite(
  personId: string,
  id: number,
  seen: string,
  reason: string,
): Promise<Failure | { kind: "saved" }> {
  return db.transaction(async (tx) => {
    const gate = await lockFresh(tx, id, seen);
    if (gate.kind !== "ok") return gate;
    // Already retired: the page offered "Retire" on a state that has moved on.
    if (gate.site.retiredAt !== null) return { kind: "stale" as const };
    await makePrivateIfPublic(tx, gate.site, "retired", personId);
    await tx
      .update(feedingSitesTable)
      .set({ retiredAt: sql`now()`, retiredBy: personId })
      .where(eq(feedingSitesTable.id, id));
    await recordMappingEvent(tx, {
      subjectKind: "site",
      subjectId: id,
      kind: "retired",
      personId,
      // A public site goes private as part of the retire, with no row of its
      // own (spec §8), so this one records it. Retiring the public code itself
      // is PR 6.2's job.
      before: gate.site.isPublic ? { isPublic: true, publicId: gate.site.publicId } : null,
      note: reason,
    });
    return { kind: "saved" as const };
  });
}

/** Brings a retired site back. It always comes back private (spec §2.5). */
export async function restoreSite(
  personId: string,
  id: number,
  seen: string,
  reason: string,
): Promise<Failure | { kind: "saved" }> {
  return db.transaction(async (tx) => {
    const gate = await lockFresh(tx, id, seen);
    if (gate.kind !== "ok") return gate;
    if (gate.site.retiredAt === null) return { kind: "stale" as const };
    await tx
      .update(feedingSitesTable)
      .set({ retiredAt: null, retiredBy: null, isPublic: false })
      .where(eq(feedingSitesTable.id, id));
    await recordMappingEvent(tx, {
      subjectKind: "site",
      subjectId: id,
      kind: "restored",
      personId,
      note: reason,
    });
    return { kind: "saved" as const };
  });
}

// ── For the forms ──────────────────────────────────────────────────────────

/**
 * The colonies this viewer sees, by name, for the colony pickers (spec §7.3:
 * a cat guardian's lists hold her own colonies only).
 */
export async function colonyOptions(visible: Visible): Promise<Array<{ id: number; name: string }>> {
  return db
    .select({ id: coloniesTable.id, name: coloniesTable.name })
    .from(coloniesTable)
    .where(colonyFilter(coloniesTable.id, visible))
    .orderBy(asc(coloniesTable.name), asc(coloniesTable.id));
}

/** What the move picker and the confirmation need to know about a site. */
export async function siteForMove(visible: Visible, id: number): Promise<{
  id: number;
  name: string;
  lat: number;
  lng: number;
  stamp: string;
  retired: boolean;
  isPublic: boolean;
} | null> {
  const [row] = await db
    .select({
      id: feedingSitesTable.id,
      name: feedingSitesTable.name,
      lat: feedingSitesTable.lat,
      lng: feedingSitesTable.lng,
      stamp: stampText(feedingSitesTable.updatedAt),
      retiredAt: feedingSitesTable.retiredAt,
      isPublic: feedingSitesTable.isPublic,
    })
    .from(feedingSitesTable)
    .where(and(eq(feedingSitesTable.id, id), colonyFilter(feedingSitesTable.colonyId, visible)));
  return row
    ? {
        id: row.id,
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        stamp: row.stamp,
        retired: row.retiredAt !== null,
        isPublic: row.isPublic,
      }
    : null;
}
