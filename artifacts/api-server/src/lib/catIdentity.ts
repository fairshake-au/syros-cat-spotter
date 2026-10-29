import { catsTable, db, observationsTable } from "@workspace/db";
import { and, inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/pg-core";

/**
 * The one reader of merges (SYC-410; which-cat-is-which.md §9.3).
 *
 * `cat_identity` (data spine §10.3) is the merge record. A merge is a row
 * `(cat_id = Mimi, canonical_cat_id = Agatha)`; an undo is a newer row
 * `(Mimi, Mimi, supersedes_id = <the merge>)`. Every question about which cat
 * a record now belongs to is answered here, so every screen treats two merged
 * cats the same way. A source test (`catIdentityGuard.test.ts`) refuses any
 * other query on the table.
 *
 * The rules, in one place:
 * - A cat's newest merge row decides. It counts until a row supersedes it
 *   (an undo); then the cat stands alone, and an older merge it overrode
 *   (bad data: two merges of one cat with no undo between) stays overridden.
 *   The undo itself (a cat's row naming itself) is never a merge.
 * - Chains are followed: Mimi → Agatha → Dora makes Mimi count for Dora.
 * - At most {@link MAX_MERGE_HOPS} hops. A chain that loops, or runs deeper
 *   than any real one could, has no canonical cat (null), and its cats feed
 *   no other cat: each keeps only its own records.
 * - `asOf`: the merges as they stood then. Only rows entered by then
 *   (`created_at <= asOf`) count, and an undo counts only once it was entered.
 *
 * Every function issues a fixed number of queries whatever the number of
 * cats (data spine §2.3: never one query per cat).
 */

type Exec = Pick<typeof db, "execute">;

/** How many merges deep to follow before giving up (a loop is bad data). */
export const MAX_MERGE_HOPS = 8;

export interface MergeReadOptions {
  /** The merges as they stood at this moment (rows entered by then). */
  asOf?: Date;
}

/**
 * The merges still standing (as of `asOf`): at most one row per merged-away
 * cat. Each cat's newest merge row decides (newest by `created_at`, then
 * `id`); if an undo supersedes it, the cat stands alone. An older merge it
 * overrode never comes back to life (review of #375, finding 1), and undoing
 * the older one leaves the newer standing. Only a row on the same cat undoes
 * its merge (finding 2): an undo naming another cat undoes nothing.
 */
function standing(asOf: Date | undefined): SQL {
  const at = asOf ?? null;
  return sql`
    select newest.cat_id, newest.canonical_cat_id, newest.created_at from (
      select distinct on (ci.cat_id) ci.id, ci.cat_id, ci.canonical_cat_id, ci.created_at
        from cat_identity ci
       where ci.canonical_cat_id <> ci.cat_id
         and (${at}::timestamptz is null or ci.created_at <= ${at}::timestamptz)
       order by ci.cat_id, ci.created_at desc, ci.id desc) newest
     where not exists (
       select 1 from cat_identity u
        where u.supersedes_id = newest.id
          and u.cat_id = newest.cat_id
          and (${at}::timestamptz is null or u.created_at <= ${at}::timestamptz))`;
}

const idArray = (ids: readonly number[]): SQL => sql`${`{${ids.join(",")}}`}::int[]`;

const cleanIds = (ids: readonly number[]): number[] => [...new Set(ids)].filter((id) => Number.isInteger(id));

/**
 * The cat each of these is now: itself, or the cat it was merged into,
 * through every merge still standing. A chain that loops, or runs deeper
 * than {@link MAX_MERGE_HOPS}, resolves to null (no canonical cat: callers
 * fail closed, so only the team passes a capability check, and nobody can
 * claim or name it).
 */
export async function canonicalCatOf(
  catIds: readonly number[],
  opts: MergeReadOptions = {},
  q: Exec = db,
): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  const ids = cleanIds(catIds);
  if (ids.length === 0) return out;
  const r = await q.execute<{ start: number; canonical: number | null }>(sql`
    with recursive standing as (${standing(opts.asOf)}),
    walk (start, at, depth, path) as (
      select s, s, 0, array[s]
        from unnest(${idArray(ids)}) as s
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
 * The cats among these that now count as part of another cat: a standing
 * merge leads, within {@link MAX_MERGE_HOPS}, to a real cat other than
 * itself. A list leaves these out, because their records are read through
 * that cat. A cat in a loop, or in a chain too deep to follow, is not
 * among them: no other cat reads its records (see {@link catsFeeding}), so
 * it stays a cat of its own and bad data never makes a cat vanish.
 */
export async function catsMergedAway(
  catIds: readonly number[],
  opts: MergeReadOptions = {},
  q: Exec = db,
): Promise<Set<number>> {
  const canonical = await canonicalCatOf(catIds, opts, q);
  const away = new Set<number>();
  for (const [id, c] of canonical) if (c !== null && c !== id) away.add(id);
  return away;
}

export interface CatsFeedingOptions extends MergeReadOptions {
  /**
   * Statement kinds that stay each cat's own: a merged-in cat's rows of
   * these kinds don't count for the cat it was merged into. `coat` and
   * `markings` are kept to the staying record by design (spec §4.2).
   */
  excludeKinds?: readonly string[];
}

/** What feeds one cat's records. */
export interface Feeding {
  /** The cat asked about. */
  catId: number;
  /** It, then every cat merged into it, through chains. */
  ids: number[];
  /**
   * When each merged-in cat started counting for this one: the newest merge
   * on its way here (Mimi → Agatha on the 3rd, Agatha → Dora on the 5th: Mimi
   * counts for Dora from the 5th). The cat itself isn't listed.
   */
  since: ReadonlyMap<number, Date>;
  /** How many merges away each merged-in cat is (1 = merged straight into this cat). */
  hops: ReadonlyMap<number, number>;
  /** Whether a statement on `catId` of `kind` counts for this cat (`excludeKinds`). */
  counts(row: { catId: number; kind: string }): boolean;
}

/**
 * For each cat, the cats whose records count for it: itself, and every cat
 * whose standing chain of merges passes through it and ends at a real cat
 * (so a loop, or a chain too deep to follow, feeds nothing). A cat that is
 * itself merged away is still fed by the cats merged into it.
 *
 * Two queries whatever the number of cats.
 */
export async function catsFeeding(
  catIds: readonly number[],
  opts: CatsFeedingOptions = {},
  q: Exec = db,
): Promise<Map<number, Feeding>> {
  const out = new Map<number, Feeding>();
  const ids = cleanIds(catIds);
  if (ids.length === 0) return out;

  // Walk the standing merges backwards from each cat asked about. Each cat
  // has at most one standing row, so a cat found here passes through the
  // target on its one way forward.
  const r = await q.execute<{ target: number; cat: number; since: Date | string; depth: number }>(sql`
    with recursive standing as (${standing(opts.asOf)}),
    back (target, at, depth, path, since) as (
      select t, t, 0, array[t], null::timestamptz
        from unnest(${idArray(ids)}) as t
      union all
      select b.target, m.cat_id, b.depth + 1, b.path || m.cat_id, greatest(b.since, m.created_at)
        from back b
        join standing m on m.canonical_cat_id = b.at
       where b.depth < ${MAX_MERGE_HOPS}
         and not (m.cat_id = any (b.path))
    )
    select target, at as cat, since, depth from back where depth > 0`);

  // Only a cat whose whole chain ends at a real cat feeds anything: a cat
  // whose chain loops, or runs too deep, keeps its records to itself.
  const found = r.rows.map((row) => ({ target: Number(row.target), cat: Number(row.cat), since: new Date(row.since), depth: Number(row.depth) }));
  const canonical = await canonicalCatOf(
    found.map((f) => f.cat),
    opts,
    q,
  );

  const excluded = new Set(opts.excludeKinds ?? []);
  for (const id of ids) {
    const since = new Map<number, Date>();
    const hops = new Map<number, number>();
    for (const f of found) {
      if (f.target !== id || canonical.get(f.cat) == null) continue;
      since.set(f.cat, f.since);
      hops.set(f.cat, f.depth);
    }
    out.set(id, {
      catId: id,
      ids: [id, ...since.keys()],
      since,
      hops,
      counts: (row) => row.catId === id || (since.has(row.catId) && !excluded.has(row.kind)),
    });
  }
  return out;
}

/** One `cat_identity` row, as the dated timeline needs it. */
export interface MergeEvent {
  id: number;
  catId: number;
  canonicalCatId: number;
  supersedesId: number | null;
  createdAt: Date;
}

/**
 * Every `cat_identity` row that could ever have joined these cats to
 * another (which-cat-is-which.md §9.10): the rows of every cat linked to
 * them by any row, merge or undo, standing or not, through chains. Entered
 * by `asOf`, when given. One query whatever the number of cats. Read with
 * {@link feedingAt}, which answers {@link catsFeeding}'s question at any
 * moment, so a report loads the island once and looks back at many dates.
 */
export async function mergeTimeline(
  catIds: readonly number[],
  opts: MergeReadOptions = {},
  q: Exec = db,
): Promise<MergeEvent[]> {
  const ids = cleanIds(catIds);
  if (ids.length === 0) return [];
  const at = opts.asOf ?? null;
  const r = await q.execute<{ id: number; cat_id: number; canonical_cat_id: number; supersedes_id: number | null; created_at: Date | string }>(sql`
    with recursive linked (cat) as (
      select s from unnest(${idArray(ids)}) as s
      union
      select case when ci.cat_id = l.cat then ci.canonical_cat_id else ci.cat_id end
        from cat_identity ci
        join linked l on ci.cat_id = l.cat or ci.canonical_cat_id = l.cat
       where (${at}::timestamptz is null or ci.created_at <= ${at}::timestamptz)
    )
    select ci.id, ci.cat_id, ci.canonical_cat_id, ci.supersedes_id, ci.created_at
      from cat_identity ci
     where ci.cat_id in (select cat from linked)
       and (${at}::timestamptz is null or ci.created_at <= ${at}::timestamptz)`);
  return r.rows.map((row) => ({
    id: Number(row.id),
    catId: Number(row.cat_id),
    canonicalCatId: Number(row.canonical_cat_id),
    supersedesId: row.supersedes_id === null ? null : Number(row.supersedes_id),
    createdAt: new Date(row.created_at),
  }));
}

/**
 * The merges standing at `at`, from a timeline: {@link standing}'s rule in
 * TypeScript (each cat's newest merge row entered by then decides, unless an
 * undo on the same cat entered by then supersedes it). One pass over the
 * events: undos are looked up by the row they supersede.
 */
function standingAt(events: readonly MergeEvent[], undosOf: ReadonlyMap<number, readonly MergeEvent[]>, t: number): Map<number, MergeEvent> {
  const newest = new Map<number, MergeEvent>();
  for (const e of events) {
    if (e.canonicalCatId === e.catId || e.createdAt.getTime() > t) continue;
    const was = newest.get(e.catId);
    if (
      !was ||
      e.createdAt.getTime() > was.createdAt.getTime() ||
      (e.createdAt.getTime() === was.createdAt.getTime() && e.id > was.id)
    ) {
      newest.set(e.catId, e);
    }
  }
  for (const [cat, m] of [...newest]) {
    if ((undosOf.get(m.id) ?? []).some((u) => u.catId === m.catId && u.createdAt.getTime() <= t)) newest.delete(cat);
  }
  return newest;
}

/** Each row that supersedes another, by the row it supersedes. */
function undosBySuperseded(events: readonly MergeEvent[]): Map<number, MergeEvent[]> {
  const out = new Map<number, MergeEvent[]>();
  for (const e of events) if (e.supersedesId !== null) out.set(e.supersedesId, [...(out.get(e.supersedesId) ?? []), e]);
  return out;
}

/** {@link canonicalCatOf}'s walk over standing merges: null for a loop or a chain too deep. */
function canonicalIn(standingMerges: ReadonlyMap<number, MergeEvent>, start: number): number | null {
  const path = [start];
  let at = start;
  for (let depth = 0; depth < MAX_MERGE_HOPS; depth++) {
    const m = standingMerges.get(at);
    if (!m || path.includes(m.canonicalCatId)) break;
    at = m.canonicalCatId;
    path.push(at);
  }
  return standingMerges.has(at) ? null : at;
}

/**
 * {@link catsFeeding}'s answer for every cat at once, as of `t`: for each cat
 * something is merged into, the cats merged into it then (through chains),
 * with when each started counting (the newest merge on its way there). A
 * cat whose chain loops or runs too deep feeds nothing. Walks each standing
 * merge's chain forward once, at most {@link MAX_MERGE_HOPS} hops, so the
 * work is the number of merges, not cats times merges.
 */
function feedingAllAt(
  events: readonly MergeEvent[],
  undosOf: ReadonlyMap<number, readonly MergeEvent[]>,
  t: number,
): Map<number, Map<number, Date>> {
  const standingMerges = standingAt(events, undosOf, t);
  const out = new Map<number, Map<number, Date>>();
  for (const first of standingMerges.values()) {
    const cat = first.catId;
    if (canonicalIn(standingMerges, cat) === null) continue;
    let since = first.createdAt;
    let m: MergeEvent | undefined = first;
    for (let hop = 0; m && hop < MAX_MERGE_HOPS; hop++) {
      if (m.createdAt.getTime() > since.getTime()) since = m.createdAt;
      const into = m.canonicalCatId;
      const fed = out.get(into) ?? new Map<number, Date>();
      fed.set(cat, since);
      out.set(into, fed);
      m = standingMerges.get(into);
    }
  }
  return out;
}

/**
 * What {@link catsFeeding} answers for `target` as of `at`, from a timeline
 * ({@link mergeTimeline}) instead of the database: each cat merged into it
 * then, through chains, with when it started counting. Pure. A test holds it
 * to `catsFeeding({ asOf })` (catIdentity.timeline.test.ts). For many cats
 * or many moments, use {@link feedingSteps}.
 */
export function feedingAt(events: readonly MergeEvent[], target: number, at: Date): Map<number, Date> {
  return feedingAllAt(events, undosBySuperseded(events), at.getTime()).get(target) ?? new Map();
}

/** From `at` until the next step, these cats fed the cat (with when each started counting). */
export interface FeedingStep {
  at: number;
  feeding: ReadonlyMap<number, Date>;
}

const NOTHING_FEEDS: ReadonlyMap<number, Date> = new Map();

const sameFeeding = (a: ReadonlyMap<number, Date>, b: ReadonlyMap<number, Date>) =>
  a.size === b.size && [...a].every(([cat, d]) => b.get(cat)?.getTime() === d.getTime());

/**
 * Each cat's feeding over time, built once from a timeline (spec §9.10): the
 * moments it changed, oldest first. Before the first step nothing fed the
 * cat. One {@link feedingAllAt} per moment a merge or undo was entered, for
 * all the cats together, so a report over the island costs merges ×
 * moments, never cats × moments × merges. Read with {@link feedingFrom}.
 */
export function feedingSteps(events: readonly MergeEvent[], catIds: Iterable<number>): Map<number, FeedingStep[]> {
  const undosOf = undosBySuperseded(events);
  const moments = [...new Set(events.map((e) => e.createdAt.getTime()))].sort((a, b) => a - b);
  const out = new Map<number, FeedingStep[]>();
  const ids = [...new Set(catIds)];
  for (const id of ids) out.set(id, []);
  for (const t of moments) {
    const all = feedingAllAt(events, undosOf, t);
    for (const id of ids) {
      const steps = out.get(id)!;
      const now = all.get(id) ?? NOTHING_FEEDS;
      const was = steps.at(-1)?.feeding ?? NOTHING_FEEDS;
      if (!sameFeeding(now, was)) steps.push({ at: t, feeding: now });
    }
  }
  return out;
}

/** The cats feeding a cat at `at`, from its {@link feedingSteps}. */
export function feedingFrom(steps: readonly FeedingStep[], at: Date): ReadonlyMap<number, Date> {
  const t = at.getTime();
  let lo = 0;
  let hi = steps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid]!.at <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? NOTHING_FEEDS : steps[lo - 1]!.feeding;
}

/**
 * SQL that is true when `catId` names a cat that is not merged away (as of
 * `asOf`): the same answer as {@link catsMergedAway} for every id (the same
 * standing merges, the same {@link MAX_MERGE_HOPS}-hop walk, a loop or a chain
 * too deep is not merged away), in one fixed subquery whatever the number of
 * cats. For a query that already reads cats through {@link liveCats}, or one
 * that starts from another table and filters on its cat id column.
 */
export function notMergedAway(catId: SQLWrapper, opts: MergeReadOptions = {}): SQL {
  return sql`${catId} not in (
    with recursive standing as (${standing(opts.asOf)}),
    walk (start, at, depth, path) as (
      select s.cat_id, s.cat_id, 0, array[s.cat_id] from standing s
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
    select d.start from deepest d
     where d.at <> d.start
       and not exists (select 1 from standing m where m.cat_id = d.at))`;
}

/**
 * Cats that are not merged away: `select <fields> from cats where
 * notMergedAway(cats.id) and <where>`. The only way to list or count cats
 * (spec §9.3): a merged-away cat counts for the cat it was merged into, so
 * it is not a cat of its own in any list, count, pool or search. The caller
 * may still join, group, order, page and lock after it. Loading one cat by
 * id for a page or an action is not this (it names `catsTable` and is on the
 * liveCatsGuard allowlist, with its reason).
 */
export function liveCats<F extends SelectedFields>(
  fields: F,
  opts: MergeReadOptions & { where?: SQL } = {},
  q: Pick<typeof db, "select"> = db,
) {
  const live = notMergedAway(catsTable.id, opts);
  return q
    .select(fields)
    .from(catsTable)
    .where(opts.where ? and(live, opts.where) : live);
}

/**
 * SQL: the statement's cat is one of the cats feeding these (see
 * {@link catsFeeding}). `col` defaults to `observationsTable.catId`; a
 * raw-SQL reader passes its own column (`sql.raw("w.cat_id")`). An empty set
 * matches nothing. Keep only the rows whose feeding `counts(row)`.
 */
export function observationCatIn(feedings: Iterable<Pick<Feeding, "ids">>, col: SQLWrapper = observationsTable.catId): SQL {
  const ids = new Set<number>();
  for (const f of feedings) for (const id of f.ids) ids.add(id);
  if (ids.size === 0) return sql`false`;
  return inArray(col, [...ids]);
}

/** One merge as the undo needs it (which-cat-is-which.md §4.4, §9.7). */
export interface MergeRecord {
  id: number;
  /** The merged-away cat (Mimi). */
  catId: number;
  /** The cat it was merged into (Agatha). */
  canonicalCatId: number;
  createdAt: Date;
  /** What the team typed as the reason (SYC-59 PR 4.2: the undo screen quotes it). */
  reasonText: string | null;
  /** The undo row that superseded it, if any. */
  undoneBy: number | null;
}

/**
 * The merge row `id`, or null when there is none or the row is not a merge
 * (an undo names its own cat). Read through `q`, so the undo route sees it
 * inside its own transaction. Only an undo on the same cat undoes a merge
 * (the rule {@link standing} follows).
 */
export async function mergeRecord(id: number, q: Exec = db): Promise<MergeRecord | null> {
  if (!Number.isInteger(id)) return null;
  const r = await q.execute<{ id: number; cat_id: number; canonical_cat_id: number; created_at: Date | string; reason_text: string | null; undone_by: number | null }>(sql`
    select ci.id, ci.cat_id, ci.canonical_cat_id, ci.created_at, ci.reason_text,
           (select u.id from cat_identity u
             where u.supersedes_id = ci.id and u.cat_id = ci.cat_id
             order by u.id limit 1) as undone_by
      from cat_identity ci
     where ci.id = ${id}
       and ci.canonical_cat_id <> ci.cat_id`);
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    catId: Number(row.cat_id),
    canonicalCatId: Number(row.canonical_cat_id),
    createdAt: new Date(row.created_at),
    reasonText: row.reason_text,
    undoneBy: row.undone_by === null ? null : Number(row.undone_by),
  };
}

/** One merge or undo row a cat is part of, as the cat page's History needs it (SYC-59 PR 4.2). */
export interface MergeEventRow {
  /** The `cat_identity` row: the merge's, or the undo's. */
  id: number;
  createdAt: Date;
  reasonText: string | null;
  /** Who did it (a person's id, or null once redacted). */
  byAccountId: string | null;
  /** Set on an undo: the merge it undoes. */
  supersedesId: number | null;
  /** The merged-away cat (Mimi) and the cat it was merged into (Agatha), read through the merge for an undo. */
  mergedCatId: number;
  survivorCatId: number;
  /** Sightings this row moved (the merge's `merged` moves, or the undo's `merge_undone` moves). */
  moved: number;
  /** A merge row an undo has superseded. */
  undone: boolean;
}

/**
 * The merges this cat is part of, as the cat that stays or the cat merged
 * away, and the undos of them, oldest first. An undo row names no other cat of
 * its own (it names itself), so it is read through the merge it supersedes.
 * One query.
 */
export async function mergeEventRows(catId: number, q: Exec = db): Promise<MergeEventRow[]> {
  const r = await q.execute<{
    id: number;
    created_at: Date | string;
    reason_text: string | null;
    by_account_id: string | null;
    supersedes_id: number | null;
    mimi: number;
    agatha: number;
    n: number;
    undone: boolean;
  }>(sql`
    select ci.id, ci.created_at, ci.reason_text, ci.by_account_id, ci.supersedes_id,
           coalesce(sup.cat_id, ci.cat_id) as mimi,
           coalesce(sup.canonical_cat_id, ci.canonical_cat_id) as agatha,
           (select count(*)::int from sighting_moves m where m.merge_id = ci.id) as n,
           exists (select 1 from cat_identity u where u.supersedes_id = ci.id and u.cat_id = ci.cat_id) as undone
      from cat_identity ci
      left join cat_identity sup on sup.id = ci.supersedes_id
     where coalesce(sup.canonical_cat_id, ci.canonical_cat_id) <> coalesce(sup.cat_id, ci.cat_id)
       and (coalesce(sup.cat_id, ci.cat_id) = ${catId} or coalesce(sup.canonical_cat_id, ci.canonical_cat_id) = ${catId})
     order by ci.id`);
  return r.rows.map((row) => ({
    id: Number(row.id),
    createdAt: new Date(row.created_at),
    reasonText: row.reason_text,
    byAccountId: row.by_account_id,
    supersedesId: row.supersedes_id === null ? null : Number(row.supersedes_id),
    mergedCatId: Number(row.mimi),
    survivorCatId: Number(row.agatha),
    moved: Number(row.n),
    undone: row.undone,
  }));
}

/** A merged-away cat, by the name it had, and the cat it is now part of. */
export interface AlsoKnownAs {
  id: number;
  name: string;
  survivorId: number;
}

/**
 * "Also known as" (which-cat-is-which.md §4.2, §9.3, §9.6): every cat now
 * merged into another, with its current name (which passed the name checks;
 * a name the team replaced is never shown) and the cat it is part of now,
 * through chains. A cat in a loop or a chain too deep is not merged away
 * (see {@link catsMergedAway}) and is not listed. Three queries whatever the
 * number of cats.
 */
export async function alsoKnownAs(q: Exec & Pick<typeof db, "select"> = db): Promise<AlsoKnownAs[]> {
  const r = await q.execute<{ cat_id: number }>(sql`select cat_id from (${standing(undefined)}) s`);
  const ids = r.rows.map((row) => Number(row.cat_id));
  if (ids.length === 0) return [];
  const canonical = await canonicalCatOf(ids, {}, q);
  const away = ids.filter((id) => {
    const c = canonical.get(id);
    return c != null && c !== id;
  });
  if (away.length === 0) return [];
  const names = await q.select({ id: catsTable.id, name: catsTable.name }).from(catsTable).where(inArray(catsTable.id, away));
  return names.map((n) => ({ id: n.id, name: n.name, survivorId: canonical.get(n.id)! }));
}
