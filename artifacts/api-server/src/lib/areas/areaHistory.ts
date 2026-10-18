import { db, mappingEventsTable, peopleTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { SEED_AREAS, type NamedArea } from "./seedAreas";

// The named areas' history (SYC-396 PR 2.4; dashboard §3.3, plan Decision 9).
// Every change to the list is one `named_area` row in mapping_events, holding
// the whole row before and after ({key, name, lat, lng, retired}). So the
// list as it stood at any moment is a replay of the `after`s, and its version
// is how many changes there had been by then.
//
// This module reads mapping_events, so it is registered in
// guardianView.source.test.ts ISLAND_ONLY_MODULES: a route calls it only
// behind an island-only capability (`edit_named_areas` for the Areas page).

/** The `named_area` part of the history, and nothing else. */
const areaRows = eq(mappingEventsTable.subjectKind, "named_area");

/** How many changes the list has had: the current version. */
export async function areaEventCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mappingEventsTable)
    .where(areaRows);
  return row?.n ?? 0;
}

/** A history row's `after`, if it still holds a whole area (not redacted). */
function areaOf(after: unknown): (NamedArea & { retired: boolean }) | null {
  if (typeof after !== "object" || after === null) return null;
  const a = after as Record<string, unknown>;
  if (
    typeof a.key !== "string" ||
    typeof a.name !== "string" ||
    typeof a.lat !== "number" ||
    typeof a.lng !== "number"
  ) {
    return null;
  }
  return { key: a.key, name: a.name, lat: a.lat, lng: a.lng, retired: a.retired === true };
}

/**
 * The list as it stood at `at`, and its version ("as of" means entered by
 * then, Decision 10). Replays every `named_area` change made at or before
 * `at`, in order, keeping each area's latest `after`. Retired areas drop out.
 *
 * Before the first change (the seed, dated 15 Oct 2026) there is no history,
 * so it gives SEED_AREAS as version 0: a report reaching back that far still
 * has areas.
 *
 * `at` is a JavaScript Date, to the millisecond; the history is stamped to the
 * microsecond. A change stamped within the same millisecond as `at` counts as
 * made by then, so a moment read back from a row includes that row.
 */
export async function namedAreasAt(at: Date): Promise<{ version: number; areas: NamedArea[] }> {
  const rows = await db
    .select({ subjectId: mappingEventsTable.subjectId, after: mappingEventsTable.after })
    .from(mappingEventsTable)
    .where(and(areaRows, sql`date_trunc('milliseconds', ${mappingEventsTable.at}) <= ${at.toISOString()}::timestamptz`))
    .orderBy(mappingEventsTable.at, mappingEventsTable.id);
  if (rows.length === 0) return { version: 0, areas: SEED_AREAS.map((a) => ({ ...a })) };

  const latest = new Map<number, NamedArea & { retired: boolean }>();
  for (const row of rows) {
    const area = areaOf(row.after);
    if (area) latest.set(row.subjectId, area);
  }
  const areas = [...latest.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, a]) => !a.retired)
    .map(([, { key, name, lat, lng }]) => ({ key, name, lat, lng }));
  return { version: rows.length, areas };
}

/** One line of the Areas page's history. */
export interface AreaChange {
  at: Date;
  kind: string;
  /** The person's name, or null for the app's own rows (the seed). */
  who: string | null;
  before: (NamedArea & { retired: boolean }) | null;
  after: (NamedArea & { retired: boolean }) | null;
}

/** The latest changes to the list, newest first, with who made them. */
export async function areaChanges(limit = 50): Promise<AreaChange[]> {
  const rows = await db
    .select({
      at: mappingEventsTable.at,
      kind: mappingEventsTable.kind,
      who: peopleTable.name,
      before: mappingEventsTable.before,
      after: mappingEventsTable.after,
    })
    .from(mappingEventsTable)
    .leftJoin(peopleTable, eq(peopleTable.id, mappingEventsTable.personId))
    .where(areaRows)
    .orderBy(desc(mappingEventsTable.at), desc(mappingEventsTable.id))
    .limit(limit);
  return rows.map((r) => ({
    at: r.at,
    kind: r.kind,
    who: r.who ?? null,
    before: areaOf(r.before),
    after: areaOf(r.after),
  }));
}
