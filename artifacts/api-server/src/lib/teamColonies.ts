import {
  catsTable,
  colonyNameHistoryTable,
  coloniesTable,
  db,
  feedingSitesTable,
  foldName,
  isPersonId,
  mappingEventsTable,
  observationsTable,
  photosTable,
  type Colony,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { catsByColony } from "./colonyMembership";
import { colonyFilter, covers, nameLabeller, type Visible } from "./guardianView";
import { recordMappingEvent } from "./mappingEvents";
import { syrNumber, teamPhotoUrl } from "./teamCatView";

// The team's Colonies screens (SYC-209 PR 2.1; spec §2.6, §2.7, §8): reading
// the list and one colony, and the four writes (create, rename, guardian,
// notes, centre). Every write is one transaction holding the change and its
// history row (`recordMappingEvent(tx, …)`), so they commit or fail together.
//
// Everything here is behind requireTeam; the routes (routes/teamColonies.ts)
// do the capability checks. Nothing here is public.
//
// **What a cat guardian sees (PR 4.1; spec §7.3).** Every reader takes a
// `Visible` (lib/guardianView.ts) and filters by it in the query: her own
// colonies only, found by any name they have had; another colony's name,
// guardian and counts never appear, and a cat that moved from hers to
// another colony goes to "another colony", unnamed.

export const COLONY_NAME_MAX = 100;
export const GUARDIAN_NAME_MAX = 100;
export const COLONY_NOTES_MAX = 2000;

// ── Reading ────────────────────────────────────────────────────────────────

export interface ColonyRow {
  id: number;
  name: string;
  guardianName: string | null;
  siteCount: number;
  catCount: number;
  /** Set when the search found this colony by an earlier name. */
  matchedOldName?: string;
}

/**
 * The sites each colony has now. A retired site is a closed one, so it is not
 * counted.
 */
async function siteCounts(visible: Visible): Promise<Map<number, number>> {
  const rows = await db
    .select({
      colonyId: feedingSitesTable.colonyId,
      n: sql<number>`count(*)::int`,
    })
    .from(feedingSitesTable)
    .where(and(isNull(feedingSitesTable.retiredAt), colonyFilter(feedingSitesTable.colonyId, visible)))
    .groupBy(feedingSitesTable.colonyId);
  const out = new Map<number, number>();
  for (const r of rows) if (r.colonyId !== null) out.set(r.colonyId, r.n);
  return out;
}

/**
 * Every colony by name, or, with a search, the colonies that have ever had a
 * name containing it. The search is folded with `foldName` (case, accents,
 * final sigma, spacing), so `ΜΙΜΗ` finds `Μιμή`; it reads the colony's
 * current folded name and its earlier names, skipping any a guardian asked to
 * be forgotten (redacted).
 */
export async function listColonies(visible: Visible, rawQuery = ""): Promise<ColonyRow[]> {
  const q = foldName(rawQuery.slice(0, 200));

  let matchedOld = new Map<number, string>();
  let where = undefined;
  if (q !== "") {
    // strpos, not LIKE: a % or _ typed into the box means itself.
    const olds = await db
      .select({
        colonyId: colonyNameHistoryTable.colonyId,
        name: colonyNameHistoryTable.name,
      })
      .from(colonyNameHistoryTable)
      .where(
        and(
          isNull(colonyNameHistoryTable.redactedAt),
          colonyFilter(colonyNameHistoryTable.colonyId, visible),
          sql`strpos(${colonyNameHistoryTable.normalisedName}, ${q}) > 0`,
        ),
      )
      .orderBy(desc(colonyNameHistoryTable.id));
    // The newest earlier name that matched, for the hint.
    for (const o of olds) if (!matchedOld.has(o.colonyId)) matchedOld.set(o.colonyId, o.name);
    where = or(
      sql`strpos(${coloniesTable.normalisedName}, ${q}) > 0`,
      matchedOld.size > 0
        ? inArray(coloniesTable.id, [...matchedOld.keys()])
        : undefined,
    );
  }

  const colonies = await db
    .select({
      id: coloniesTable.id,
      name: coloniesTable.name,
      normalisedName: coloniesTable.normalisedName,
      guardianName: coloniesTable.guardianName,
    })
    .from(coloniesTable)
    .where(and(colonyFilter(coloniesTable.id, visible), where))
    .orderBy(asc(coloniesTable.normalisedName), asc(coloniesTable.id));

  const [sites, cats] = await Promise.all([siteCounts(visible), catsByColony()]);
  return colonies.map((c) => {
    const current = q !== "" && c.normalisedName.includes(q);
    const old = matchedOld.get(c.id);
    return {
      id: c.id,
      name: c.name,
      guardianName: c.guardianName,
      siteCount: sites.get(c.id) ?? 0,
      catCount: cats.get(c.id)?.length ?? 0,
      ...(!current && old !== undefined ? { matchedOldName: old } : {}),
    };
  });
}

export interface ColonyHistoryEntry {
  id: number;
  kind: string;
  /** "Maria", "Maria (left)" or "the system". */
  by: string;
  at: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  redacted: boolean;
}

export interface ColonyCat {
  id: number;
  syr: string;
  name: string;
  photoUrl: string | null;
}

export interface ColonyView {
  id: number;
  name: string;
  guardianName: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  siteCount: number;
  catCount: number;
  sites: { id: number; name: string }[];
  cats: ColonyCat[];
  /** Newest first. */
  history: ColonyHistoryEntry[];
}

/**
 * "Cat added" and "Cat taken out" lines for a colony's history (spec §2.6),
 * read from the `colony` statements, not from a table of their own. Per cat,
 * the statements that stand (not marked wrong, not redacted) are walked in
 * the order `currentColonyOf` uses; a statement that puts the cat in this
 * colony when it was not already is "added", and one that moves it out of
 * this colony is "taken out" (to no colony) or "moved out" (to another).
 */
async function catHistoryEntries(visible: Visible, colonyId: number): Promise<ColonyHistoryEntry[]> {
  const replacer = alias(observationsTable, "replacer");
  const standing = and(
    eq(observationsTable.kind, "colony"),
    isNull(observationsTable.redactedAt),
    notExists(
      db
        .select({ one: sql`1` })
        .from(replacer)
        .where(eq(replacer.supersedesId, observationsTable.id)),
    ),
  );
  const touched = await db
    .selectDistinct({ catId: observationsTable.catId })
    .from(observationsTable)
    .where(and(standing, sql`${observationsTable.value}->>'colonyId' = ${String(colonyId)}`));
  if (touched.length === 0) return [];
  const catIds = touched.map((t) => t.catId);

  const rows = await db
    .select({
      id: observationsTable.id,
      catId: observationsTable.catId,
      value: observationsTable.value,
      accountId: observationsTable.accountId,
      createdAt: observationsTable.createdAt,
    })
    .from(observationsTable)
    .where(and(standing, inArray(observationsTable.catId, catIds)))
    .orderBy(
      asc(observationsTable.catId),
      asc(observationsTable.observedAt),
      asc(observationsTable.id),
    );

  const [cats, label] = await Promise.all([
    db
      .select({ id: catsTable.id, name: catsTable.name })
      .from(catsTable)
      .where(inArray(catsTable.id, catIds)),
    nameLabeller(
      visible,
      rows.map((r) => (r.accountId && isPersonId(r.accountId) ? r.accountId : null)),
    ),
  ]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  // Only colonies this viewer sees are named: a cat that went to a colony
  // that isn't hers went to "another colony" (spec §7.3).
  const otherIds = [
    ...new Set(
      rows
        .map((r) => (r.value as { colonyId?: unknown } | null)?.colonyId)
        .filter((c): c is number => typeof c === "number" && c !== colonyId && covers(visible, c)),
    ),
  ];
  const otherNames = new Map<number, string>();
  if (otherIds.length > 0) {
    for (const c of await db
      .select({ id: coloniesTable.id, name: coloniesTable.name })
      .from(coloniesTable)
      .where(and(inArray(coloniesTable.id, otherIds), colonyFilter(coloniesTable.id, visible)))) {
      otherNames.set(c.id, c.name);
    }
  }

  const out: ColonyHistoryEntry[] = [];
  const previous = new Map<number, number | null>();
  for (const r of rows) {
    const raw = (r.value as { colonyId?: unknown } | null)?.colonyId;
    const now = typeof raw === "number" ? raw : null;
    const before = previous.get(r.catId) ?? null;
    previous.set(r.catId, now);
    if (now === before) continue;
    if (now !== colonyId && before !== colonyId) continue;
    const entry = {
      id: r.id,
      by: label(r.accountId && isPersonId(r.accountId) ? r.accountId : null),
      at: r.createdAt.toISOString(),
      before: null,
      redacted: false,
    };
    const cat = { catId: r.catId, catName: catName.get(r.catId) ?? "", catSyr: syrNumber(r.catId) };
    out.push(
      now === colonyId
        ? { ...entry, kind: "cat_added", after: cat }
        : now === null
          ? { ...entry, kind: "cat_taken_out", after: cat }
          : {
              ...entry,
              kind: "cat_moved_out",
              after: { ...cat, movedTo: otherNames.get(now) ?? null },
            },
    );
  }
  return out;
}

export async function colonyView(visible: Visible, id: number): Promise<ColonyView | null> {
  // Another colony is not found, exactly like a colony that doesn't exist.
  const [colony] = await db
    .select()
    .from(coloniesTable)
    .where(and(eq(coloniesTable.id, id), colonyFilter(coloniesTable.id, visible)));
  if (!colony) return null;

  const [sites, catIds, events, catEvents] = await Promise.all([
    db
      .select({ id: feedingSitesTable.id, name: feedingSitesTable.name })
      .from(feedingSitesTable)
      .where(and(eq(feedingSitesTable.colonyId, id), isNull(feedingSitesTable.retiredAt)))
      .orderBy(asc(feedingSitesTable.name), asc(feedingSitesTable.id)),
    catsByColony().then((m) => m.get(id) ?? []),
    db
      .select()
      .from(mappingEventsTable)
      .where(
        and(eq(mappingEventsTable.subjectKind, "colony"), eq(mappingEventsTable.subjectId, id)),
      )
      .orderBy(desc(mappingEventsTable.at), desc(mappingEventsTable.id)),
    catHistoryEntries(visible, id),
  ]);

  const cats: ColonyCat[] =
    catIds.length === 0
      ? []
      : (
          await db
            .select({
              id: catsTable.id,
              name: catsTable.name,
              photoPublicId: photosTable.publicId,
            })
            .from(catsTable)
            .leftJoin(photosTable, eq(photosTable.id, catsTable.primaryPhotoId))
            .where(inArray(catsTable.id, catIds))
            .orderBy(asc(catsTable.name), asc(catsTable.id))
        ).map((c) => ({
          id: c.id,
          syr: syrNumber(c.id),
          name: c.name,
          photoUrl: c.photoPublicId ? teamPhotoUrl(c.photoPublicId) : null,
        }));

  const label = await nameLabeller(visible, events.map((e) => e.personId));

  return {
    id: colony.id,
    name: colony.name,
    guardianName: colony.guardianName,
    notes: colony.notes,
    lat: colony.lat,
    lng: colony.lng,
    siteCount: sites.length,
    catCount: cats.length,
    sites,
    cats,
    history: [
      ...events.map((e) => ({
        id: e.id,
        kind: e.kind,
        by: label(e.personId),
        at: e.at.toISOString(),
        before: (e.before as Record<string, unknown> | null) ?? null,
        after: (e.after as Record<string, unknown> | null) ?? null,
        redacted: e.redactedAt !== null,
      })),
      ...catEvents,
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id)),
  };
}

// ── Writing ────────────────────────────────────────────────────────────────

/**
 * The folded-name unique index specifically, however Drizzle wraps the pg
 * error. Any other unique violation must surface as the error it is.
 */
export function isColonyNameClash(err: unknown): boolean {
  for (let cur = err; cur; cur = (cur as { cause?: unknown }).cause) {
    const pgErr = cur as { code?: string; constraint?: string };
    if (pgErr.code === "23505" && pgErr.constraint === "colonies_normalised_name_unique") {
      return true;
    }
  }
  return false;
}

/** The colony that holds `name` once folded (what the unique index refuses). */
export async function colonyNamed(name: string): Promise<{ id: number; name: string } | null> {
  const [row] = await db
    .select({ id: coloniesTable.id, name: coloniesTable.name })
    .from(coloniesTable)
    .where(eq(coloniesTable.normalisedName, foldName(name)));
  return row ?? null;
}

export type CreateColonyOutcome =
  | { kind: "created"; id: number }
  | { kind: "taken"; holder: { id: number; name: string } | null };

export async function createColony(
  personId: string,
  input: { name: string; guardianName: string | null; notes: string | null },
): Promise<CreateColonyOutcome> {
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(coloniesTable)
        .values({
          name: input.name,
          normalisedName: foldName(input.name),
          guardianName: input.guardianName,
          notes: input.notes,
          // The person's id as text: the column is text by design (roles plan C7).
          createdBy: personId,
        })
        .returning({ id: coloniesTable.id });
      await recordMappingEvent(tx, {
        subjectKind: "colony",
        subjectId: row!.id,
        kind: "colony_created",
        personId,
        after: {
          name: input.name,
          guardianName: input.guardianName,
          notes: input.notes,
        },
      });
      return row!.id;
    });
    return { kind: "created", id };
  } catch (err) {
    if (!isColonyNameClash(err)) throw err;
    return { kind: "taken", holder: await colonyNamed(input.name) };
  }
}

export interface ColonyChanges {
  /** Each is present only if the caller sent it. */
  name?: string;
  guardianName?: string | null;
  notes?: string | null;
  centre?: { lat: number; lng: number } | null;
}

/** What a change will need, so the route can check the capabilities first. */
export function neededBy(colony: Colony, changes: ColonyChanges) {
  return {
    rename: changes.name !== undefined && changes.name !== colony.name,
    edit:
      (changes.guardianName !== undefined && changes.guardianName !== colony.guardianName) ||
      (changes.notes !== undefined && changes.notes !== colony.notes) ||
      (changes.centre !== undefined && centreChanged(colony, changes.centre)),
  };
}

const centreOf = (c: Colony) =>
  c.lat !== null && c.lng !== null ? { lat: c.lat, lng: c.lng } : null;

function centreChanged(c: Colony, next: { lat: number; lng: number } | null): boolean {
  const cur = centreOf(c);
  if (cur === null || next === null) return cur !== next;
  return cur.lat !== next.lat || cur.lng !== next.lng;
}

export type UpdateColonyOutcome =
  | { kind: "saved"; events: number }
  | { kind: "unchanged" }
  | { kind: "missing" }
  | { kind: "forbidden" }
  | { kind: "taken"; holder: { id: number; name: string } | null };

/**
 * Applies the changes that differ from what is stored, one history row per
 * change, in one transaction. The colony row is taken `FOR UPDATE` first, so
 * two edits at once queue up and each compares against what the other left
 * (K8: no `updated_at` on colonies; the name clash is the unique index's job).
 *
 * `allow` is asked, inside the lock, whether this person may make the changes
 * the row actually needs: rename and edit are different capabilities.
 */
export async function updateColony(
  personId: string,
  id: number,
  changes: ColonyChanges,
  allow: (needed: ReturnType<typeof neededBy>) => boolean,
): Promise<UpdateColonyOutcome> {
  try {
    return await db.transaction(async (tx): Promise<UpdateColonyOutcome> => {
      const [colony] = await tx
        .select()
        .from(coloniesTable)
        .where(eq(coloniesTable.id, id))
        .for("update");
      if (!colony) return { kind: "missing" };

      const needed = neededBy(colony, changes);
      if (!needed.rename && !needed.edit) return { kind: "unchanged" };
      if (!allow(needed)) return { kind: "forbidden" };

      const set: Partial<typeof coloniesTable.$inferInsert> = {};
      let events = 0;

      if (needed.rename) {
        const name = changes.name!;
        // The old name stays findable (spec §2.7) and keeps a data-spine
        // import matching. A change of capitals or accents only folds to the
        // same name, which search already finds, so it needs no history row.
        if (foldName(name) !== colony.normalisedName) {
          await tx.insert(colonyNameHistoryTable).values({
            colonyId: id,
            name: colony.name,
            normalisedName: colony.normalisedName,
            replacedBy: personId,
          });
        }
        set.name = name;
        set.normalisedName = foldName(name);
        await recordMappingEvent(tx, {
          subjectKind: "colony",
          subjectId: id,
          kind: "colony_renamed",
          personId,
          before: { name: colony.name },
          after: { name },
        });
        events++;
      }
      if (changes.guardianName !== undefined && changes.guardianName !== colony.guardianName) {
        set.guardianName = changes.guardianName;
        await recordMappingEvent(tx, {
          subjectKind: "colony",
          subjectId: id,
          kind: "guardian_changed",
          personId,
          before: { guardianName: colony.guardianName },
          after: { guardianName: changes.guardianName },
        });
        events++;
      }
      if (changes.notes !== undefined && changes.notes !== colony.notes) {
        set.notes = changes.notes;
        await recordMappingEvent(tx, {
          subjectKind: "colony",
          subjectId: id,
          kind: "colony_notes_changed",
          personId,
          before: { notes: colony.notes },
          after: { notes: changes.notes },
        });
        events++;
      }
      if (changes.centre !== undefined && centreChanged(colony, changes.centre)) {
        set.lat = changes.centre?.lat ?? null;
        set.lng = changes.centre?.lng ?? null;
        await recordMappingEvent(tx, {
          subjectKind: "colony",
          subjectId: id,
          kind: "colony_centre_changed",
          personId,
          before: { centre: centreOf(colony) },
          after: { centre: changes.centre },
        });
        events++;
      }

      await tx.update(coloniesTable).set(set).where(eq(coloniesTable.id, id));
      return { kind: "saved", events };
    });
  } catch (err) {
    if (!isColonyNameClash(err)) throw err;
    return { kind: "taken", holder: changes.name ? await colonyNamed(changes.name) : null };
  }
}
