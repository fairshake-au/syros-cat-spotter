import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";

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
 * the older one leaves the newer standing.
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
  const r = await q.execute<{ target: number; cat: number; since: Date | string }>(sql`
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
    select target, at as cat, since from back where depth > 0`);

  // Only a cat whose whole chain ends at a real cat feeds anything: a cat
  // whose chain loops, or runs too deep, keeps its records to itself.
  const found = r.rows.map((row) => ({ target: Number(row.target), cat: Number(row.cat), since: new Date(row.since) }));
  const canonical = await canonicalCatOf(
    found.map((f) => f.cat),
    opts,
    q,
  );

  const excluded = new Set(opts.excludeKinds ?? []);
  for (const id of ids) {
    const since = new Map<number, Date>();
    for (const f of found) if (f.target === id && canonical.get(f.cat) != null) since.set(f.cat, f.since);
    out.set(id, {
      catId: id,
      ids: [id, ...since.keys()],
      since,
      counts: (row) => row.catId === id || (since.has(row.catId) && !excluded.has(row.kind)),
    });
  }
  return out;
}
