import {
  coloniesTable,
  db,
  feedingSitesTable,
  mappingEventsTable,
  sitePageReadsTable,
} from "@workspace/db";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { personLabels } from "./teamColonies";
import { stampText } from "./teamSiteWrites";

// The team's Feeding sites pages, read side (SYC-209 PR 3.2; spec §2.1, §2.2,
// §8). Reading only: PR 3.3 adds the writes. Nothing here is public; every
// caller is behind requireTeam("view_exact_location").
//
// The one thing a reader leaves behind is `site_page_reads`, written by
// `recordSitePageRead` and called ONLY from the one-site route: not the list,
// not the map (spec §8, "Who looked").

export interface SiteRow {
  id: number;
  name: string;
  lat: number;
  lng: number;
  isPublic: boolean;
  retired: boolean;
  colony: { id: number; name: string } | null;
  /** The site's `updated_at`, as ISO text. */
  changedAt: string;
}

export interface SiteCounts {
  total: number;
  public: number;
  private: number;
  retired: number;
}

export interface SiteChange {
  id: number;
  kind: string;
  siteId: number;
  siteName: string;
  /** "Maria", "Maria (left)" or "the system". */
  by: string;
  at: string;
  redacted: boolean;
}

/** How many changes the "Recently changed" strip shows. */
export const RECENT_CHANGES = 5;

/**
 * Every site by name, with its colony. Retired sites only when asked for
 * (the "Show retired" box); the count line counts all of them either way.
 */
export async function listSites(opts: { includeRetired: boolean }): Promise<SiteRow[]> {
  const rows = await db
    .select({
      id: feedingSitesTable.id,
      name: feedingSitesTable.name,
      lat: feedingSitesTable.lat,
      lng: feedingSitesTable.lng,
      isPublic: feedingSitesTable.isPublic,
      retiredAt: feedingSitesTable.retiredAt,
      updatedAt: feedingSitesTable.updatedAt,
      colonyId: coloniesTable.id,
      colonyName: coloniesTable.name,
    })
    .from(feedingSitesTable)
    .leftJoin(coloniesTable, eq(coloniesTable.id, feedingSitesTable.colonyId))
    .where(opts.includeRetired ? undefined : isNull(feedingSitesTable.retiredAt))
    .orderBy(asc(feedingSitesTable.name), asc(feedingSitesTable.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    isPublic: r.isPublic,
    retired: r.retiredAt !== null,
    colony: r.colonyId !== null ? { id: r.colonyId, name: r.colonyName! } : null,
    changedAt: r.updatedAt.toISOString(),
  }));
}

/** The numbers in the count line. A retired site is never public (a database check). */
export async function siteCounts(): Promise<SiteCounts> {
  const [r] = await db
    .select({
      total: sql<number>`count(*)::int`,
      retired: sql<number>`(count(*) filter (where ${feedingSitesTable.retiredAt} is not null))::int`,
      public: sql<number>`(count(*) filter (where ${feedingSitesTable.retiredAt} is null and ${feedingSitesTable.isPublic}))::int`,
    })
    .from(feedingSitesTable);
  const total = r?.total ?? 0;
  const retired = r?.retired ?? 0;
  const pub = r?.public ?? 0;
  return { total, public: pub, private: total - retired - pub, retired };
}

/**
 * The last five changes to any site, newest first. The baseline row the
 * migration wrote for a site that predates the history (`existing`) is not a
 * change, so it is left out.
 */
export async function recentSiteChanges(): Promise<SiteChange[]> {
  const rows = await db
    .select({
      id: mappingEventsTable.id,
      kind: mappingEventsTable.kind,
      siteId: mappingEventsTable.subjectId,
      siteName: feedingSitesTable.name,
      personId: mappingEventsTable.personId,
      at: mappingEventsTable.at,
      redactedAt: mappingEventsTable.redactedAt,
    })
    .from(mappingEventsTable)
    .innerJoin(feedingSitesTable, eq(feedingSitesTable.id, mappingEventsTable.subjectId))
    .where(and(eq(mappingEventsTable.subjectKind, "site"), ne(mappingEventsTable.kind, "existing")))
    .orderBy(desc(mappingEventsTable.at), desc(mappingEventsTable.id))
    .limit(RECENT_CHANGES);
  const people = await personLabels(rows.map((r) => r.personId).filter((p): p is string => p !== null));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    siteId: r.siteId,
    siteName: r.siteName,
    by: r.personId ? (people.get(r.personId) ?? "someone no longer on the team list") : "the system",
    at: r.at.toISOString(),
    redacted: r.redactedAt !== null,
  }));
}

// ── One site ───────────────────────────────────────────────────────────────

export interface SiteHistoryEntry {
  id: number;
  kind: string;
  by: string;
  at: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  redacted: boolean;
}

export interface SiteView {
  id: number;
  name: string;
  lat: number;
  lng: number;
  isPublic: boolean;
  madePublicAt: string | null;
  madePublicBy: string | null;
  retiredAt: string | null;
  colony: { id: number; name: string } | null;
  notes: string | null;
  directions: string | null;
  /** The exact database value of `updated_at`, as text to the microsecond (every write compares against it). */
  updatedAt: string;
  /** Newest first. */
  history: SiteHistoryEntry[];
}

export async function siteView(id: number): Promise<SiteView | null> {
  const [site] = await db
    .select({
      id: feedingSitesTable.id,
      name: feedingSitesTable.name,
      lat: feedingSitesTable.lat,
      lng: feedingSitesTable.lng,
      isPublic: feedingSitesTable.isPublic,
      madePublicAt: feedingSitesTable.madePublicAt,
      madePublicBy: feedingSitesTable.madePublicBy,
      retiredAt: feedingSitesTable.retiredAt,
      notes: feedingSitesTable.notes,
      directions: feedingSitesTable.directions,
      // The stamp text (UTC, to the microsecond, fixed layout) (PR 3.3's writes compare it in SQL).
      stamp: stampText(feedingSitesTable.updatedAt),
      colonyId: coloniesTable.id,
      colonyName: coloniesTable.name,
    })
    .from(feedingSitesTable)
    .leftJoin(coloniesTable, eq(coloniesTable.id, feedingSitesTable.colonyId))
    .where(eq(feedingSitesTable.id, id));
  if (!site) return null;

  const events = await db
    .select()
    .from(mappingEventsTable)
    .where(and(eq(mappingEventsTable.subjectKind, "site"), eq(mappingEventsTable.subjectId, id)))
    .orderBy(desc(mappingEventsTable.at), desc(mappingEventsTable.id));
  const people = await personLabels(
    [...events.map((e) => e.personId), site.madePublicBy].filter((p): p is string => p !== null),
  );
  const label = (p: string | null) =>
    p === null ? "the system" : (people.get(p) ?? "someone no longer on the team list");

  return {
    id: site.id,
    name: site.name,
    lat: site.lat,
    lng: site.lng,
    isPublic: site.isPublic,
    madePublicAt: site.madePublicAt?.toISOString() ?? null,
    madePublicBy: site.madePublicBy ? label(site.madePublicBy) : null,
    retiredAt: site.retiredAt?.toISOString() ?? null,
    colony: site.colonyId !== null ? { id: site.colonyId, name: site.colonyName! } : null,
    notes: site.notes,
    directions: site.directions,
    updatedAt: site.stamp,
    history: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      by: label(e.personId),
      at: e.at.toISOString(),
      before: (e.before as Record<string, unknown> | null) ?? null,
      after: (e.after as Record<string, unknown> | null) ?? null,
      note: e.note,
      redacted: e.redactedAt !== null,
    })),
  };
}

/**
 * "Who looked" (spec §8): one row for opening a site's page, naming the
 * person, the site and the time, and no position. Called by the one-site
 * route only.
 */
export async function recordSitePageRead(personId: string, siteId: number): Promise<void> {
  await db.insert(sitePageReadsTable).values({ personId, siteId });
}
