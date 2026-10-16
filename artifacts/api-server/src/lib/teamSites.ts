import {
  coloniesTable,
  db,
  feedingSitesTable,
  mappingEventsTable,
  sitePageReadsTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { CapabilityHolder } from "./capabilities";
import { colonyFilter, nameLabeller, visibleColonyIds, type Visible } from "./guardianView";
import { stampText } from "./teamSiteWrites";

// The team's Feeding sites pages, read side (SYC-209 PR 3.2; spec §2.1, §2.2,
// §8). Reading only: PR 3.3 adds the writes. Nothing here is public; every
// caller is behind requireTeam("view_exact_location").
//
// The one thing a reader leaves behind is `site_page_reads`, written by
// `recordSitePageRead` and called ONLY from the one-site route: not the list,
// not the map (spec §8, "Who looked").
//
// **What a cat guardian sees (PR 4.1; spec §7.3).** Every reader takes a
// `Visible` (lib/guardianView.ts) and filters by it IN THE QUERY: a guardian
// gets her own colonies' sites, counts and changes, and nothing else exists.
// A site's history (and the "Recently changed" strip) shows her only what
// happened since the site joined its colony, so a site reassigned to her
// doesn't show the earlier colony's story; names outside her colonies read
// "Syros Cats".

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
export async function listSites(
  visible: Visible,
  opts: { includeRetired: boolean },
): Promise<SiteRow[]> {
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
    .where(
      and(
        colonyFilter(feedingSitesTable.colonyId, visible),
        opts.includeRetired ? undefined : isNull(feedingSitesTable.retiredAt),
      ),
    )
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
export async function siteCounts(visible: Visible): Promise<SiteCounts> {
  const [r] = await db
    .select({
      total: sql<number>`count(*)::int`,
      retired: sql<number>`(count(*) filter (where ${feedingSitesTable.retiredAt} is not null))::int`,
      public: sql<number>`(count(*) filter (where ${feedingSitesTable.retiredAt} is null and ${feedingSitesTable.isPublic}))::int`,
    })
    .from(feedingSitesTable)
    .where(colonyFilter(feedingSitesTable.colonyId, visible));
  const total = r?.total ?? 0;
  const retired = r?.retired ?? 0;
  const pub = r?.public ?? 0;
  return { total, public: pub, private: total - retired - pub, retired };
}

/**
 * For a cat guardian, only a site's events since it joined the colony it is
 * in now (spec §7.3; plan PR 4.1): no `colony_changed` event into its
 * current colony comes after the event. Nothing for the team. Used with
 * `mapping_events` and `feeding_sites` (the event's site) in the query.
 */
function sinceJoined(visible: Visible): SQL | undefined {
  if (visible.ids === null) return undefined;
  return sql`not exists (
    select 1 from ${mappingEventsTable} as joined
    where joined.subject_kind = 'site'
      and joined.subject_id = ${mappingEventsTable.subjectId}
      and joined.kind = 'colony_changed'
      and (joined.after ->> 'colonyId') = (${feedingSitesTable.colonyId})::text
      and (joined.at, joined.id) > (${mappingEventsTable.at}, ${mappingEventsTable.id})
  )`;
}

/**
 * The last five changes to any site, newest first. The baseline row the
 * migration wrote for a site that predates the history (`existing`) is not a
 * change, so it is left out.
 */
export async function recentSiteChanges(visible: Visible): Promise<SiteChange[]> {
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
    .where(
      and(
        eq(mappingEventsTable.subjectKind, "site"),
        ne(mappingEventsTable.kind, "existing"),
        colonyFilter(feedingSitesTable.colonyId, visible),
        sinceJoined(visible),
      ),
    )
    .orderBy(desc(mappingEventsTable.at), desc(mappingEventsTable.id))
    .limit(RECENT_CHANGES);
  const label = await nameLabeller(visible, rows.map((r) => r.personId));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    siteId: r.siteId,
    siteName: r.siteName,
    by: label(r.personId),
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

export async function siteView(visible: Visible, id: number): Promise<SiteView | null> {
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
    // Another colony's site is not found, exactly like a site that doesn't exist.
    .where(and(eq(feedingSitesTable.id, id), colonyFilter(feedingSitesTable.colonyId, visible)));
  if (!site) return null;

  const events = await db
    .select({ event: mappingEventsTable })
    .from(mappingEventsTable)
    .innerJoin(feedingSitesTable, eq(feedingSitesTable.id, mappingEventsTable.subjectId))
    .where(
      and(
        eq(mappingEventsTable.subjectKind, "site"),
        eq(mappingEventsTable.subjectId, id),
        sinceJoined(visible),
      ),
    )
    .orderBy(desc(mappingEventsTable.at), desc(mappingEventsTable.id))
    .then((rows) => rows.map((r) => r.event));
  const label = await nameLabeller(visible, [...events.map((e) => e.personId), site.madePublicBy]);
  // The event that brought the site into its colony is the first a guardian
  // sees; where it came from (another colony's number) is not hers to read.
  const oldest = events[events.length - 1];

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
      before:
        visible.ids !== null && e === oldest && e.kind === "colony_changed"
          ? null
          : ((e.before as Record<string, unknown> | null) ?? null),
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

// ── A person's own sites (for the roles plan) ──────────────────────────────

export interface PersonSite {
  id: number;
  name: string;
  lat: number;
  lng: number;
  /** The optional "how to find it" line (SYC-263). */
  directions: string | null;
  colony: { id: number; name: string };
}

/**
 * The sites a person may see, with their exact positions and "how to find
 * it" line, in ONE query, filtered by `visibleColonyIds(person)` in SQL.
 * Retired sites are left out; so are sites in no colony (nobody's to carry).
 * The roles plan calls this for "My colonies" (PR 1.3/2.1) and the saved
 * list with no signal (PR 4.2), so there is one filter, not three.
 * `onlyColonies` narrows it further (a team member choosing which colonies
 * to carry); it can never widen it.
 */
export async function sitesForPerson(
  person: CapabilityHolder,
  onlyColonies?: readonly number[],
): Promise<PersonSite[]> {
  const visible = visibleColonyIds(person);
  if (onlyColonies && onlyColonies.length === 0) return [];
  const rows = await db
    .select({
      id: feedingSitesTable.id,
      name: feedingSitesTable.name,
      lat: feedingSitesTable.lat,
      lng: feedingSitesTable.lng,
      directions: feedingSitesTable.directions,
      colonyId: coloniesTable.id,
      colonyName: coloniesTable.name,
    })
    .from(feedingSitesTable)
    .innerJoin(coloniesTable, eq(coloniesTable.id, feedingSitesTable.colonyId))
    .where(
      and(
        colonyFilter(feedingSitesTable.colonyId, visible),
        isNull(feedingSitesTable.retiredAt),
        onlyColonies ? inArray(feedingSitesTable.colonyId, [...onlyColonies]) : undefined,
      ),
    )
    .orderBy(asc(coloniesTable.name), asc(feedingSitesTable.name), asc(feedingSitesTable.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    directions: r.directions,
    colony: { id: r.colonyId, name: r.colonyName },
  }));
}
