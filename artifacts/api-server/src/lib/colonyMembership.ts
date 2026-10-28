import { catsTable, db, observationsTable } from "@workspace/db";
import { and, asc, desc, eq, isNull, lte, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { canonicalCatOf, catsFeeding, liveCats, observationCatIn, type Feeding } from "./catIdentity";

// "Which colony is a cat in" (SYC-209 plan, Slice 2; spec §2.8, data spine
// §10.2). **This is the one place the rule lives.** The colony counts, the
// colony page, the cat page and (later) the roles plan's target lookup all
// ask here, so they can never disagree.
//
// The rule: of a cat's `colony` statements, ignore the ones that were marked
// wrong (superseded) and the ones that were redacted; the newest by
// `observedAt` stands, and two with the same time go to the higher id. If the
// one that stands says `colonyId: null` ("in no colony"), the cat is in none.

/**
 * Which of the records feeding a cat decides her colony, given each record's
 * own newest standing colony statement: the nearest record that has one (her
 * own; else the cats merged straight into her; else those merged into them),
 * and among records the same distance away, the newest statement (observedAt,
 * then id). "Mimi is in Ano Syros and Agatha in Vaporia: after merging she'll
 * show as Vaporia" (spec 4.1). Every reader of a merged cat's colony uses this,
 * so they cannot disagree.
 */
export function pickColonyRow<T extends { id: number; catId: number; observedAt: Date }>(
  f: Feeding,
  newestByCat: ReadonlyMap<number, T>,
): T | undefined {
  let best: T | undefined;
  let bestHops = Infinity;
  for (const [catId, r] of newestByCat) {
    const hops = catId === f.catId ? 0 : f.hops.get(catId);
    if (hops === undefined) continue;
    const newer =
      best !== undefined &&
      (r.observedAt.getTime() > best.observedAt.getTime() ||
        (r.observedAt.getTime() === best.observedAt.getTime() && r.id > best.id));
    if (hops < bestHops || (hops === bestHops && newer)) {
      best = r;
      bestHops = hops;
    }
  }
  return best;
}

/**
 * The colony each cat is in now. A cat in no colony (never said, or "in no
 * colony", or every statement marked wrong) is simply absent from the map.
 * Pass `catIds` to look at some cats only; leave it out to look at every cat.
 */
export async function currentColonyOf(
  catIds?: readonly number[],
  /** A transaction to read through, so a caller inside one doesn't take a second connection. */
  q: Pick<typeof db, "select" | "selectDistinctOn" | "execute"> = db,
  /**
   * `asOf` (SYC-396 PR 3.0, Decision 10): the colonies as they stood then.
   * Only colony rows, and rows marking them wrong, entered by then
   * (`createdAt <= asOf`) count, so a past report doesn't use today's
   * colonies. A redacted row stays left out.
   */
  opts: { asOf?: Date } = {},
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (catIds && catIds.length === 0) return out;
  const asOf = opts.asOf;

  // A cat's colony is read over every record that counts for her (SYC-410,
  // spec §4.2): a cat merged into another has her colony statements counted
  // with the cat she is now. The whole island asks for the cats that are not
  // merged away.
  const targets = catIds
    ? [...new Set(catIds)]
    : (await liveCats({ id: catsTable.id }, { asOf }, q)).map((c) => c.id);
  if (targets.length === 0) return out;
  const feeding = await catsFeeding(targets, { asOf }, q);

  // A statement is superseded when some other row points back at it.
  const replacer = alias(observationsTable, "replacer");
  const rows = await q
    .selectDistinctOn([observationsTable.catId], {
      id: observationsTable.id,
      catId: observationsTable.catId,
      observedAt: observationsTable.observedAt,
      value: observationsTable.value,
    })
    .from(observationsTable)
    .where(
      and(
        eq(observationsTable.kind, "colony"),
        isNull(observationsTable.redactedAt),
        asOf ? lte(observationsTable.createdAt, asOf) : undefined,
        notExists(
          q
            .select({ one: sql`1` })
            .from(replacer)
            .where(
              and(
                eq(replacer.supersedesId, observationsTable.id),
                asOf ? lte(replacer.createdAt, asOf) : undefined,
              ),
            ),
        ),
        observationCatIn(feeding.values()),
      ),
    )
    .orderBy(
      asc(observationsTable.catId),
      desc(observationsTable.observedAt),
      desc(observationsTable.id),
    );

  // One rule everywhere (pickColonyRow): the nearest record with a statement.
  const byCat = new Map(rows.map((r) => [r.catId, r]));
  const newest = new Map<number, (typeof rows)[number]>();
  for (const id of targets) {
    const f = feeding.get(id);
    const row = f && pickColonyRow(f, byCat);
    if (row) newest.set(id, row);
  }
  for (const [id, r] of newest) {
    const colonyId = (r.value as { colonyId?: unknown } | null)?.colonyId;
    if (typeof colonyId === "number") out.set(id, colonyId);
  }
  return out;
}

/**
 * The cats in ONE colony now (SYC-53 PR 2.1), without reading the whole
 * island: the cats any statement has ever put in this colony are the only
 * candidates, and the one rule above decides which of them are in it now. A
 * candidate merged into another is the cat she is now, so the colony lists
 * that cat once (SYC-410).
 */
export async function catsInColony(colonyId: number): Promise<number[]> {
  const candidates = await db
    .selectDistinct({ catId: observationsTable.catId })
    .from(observationsTable)
    .where(
      and(
        eq(observationsTable.kind, "colony"),
        sql`${observationsTable.value}->>'colonyId' = ${String(colonyId)}`,
      ),
    );
  if (candidates.length === 0) return [];
  const canonical = await canonicalCatOf(candidates.map((c) => c.catId));
  const survivors = [...new Set(candidates.map((c) => canonical.get(c.catId) ?? c.catId))];
  const now = await currentColonyOf(survivors);
  return [...now].filter(([, c]) => c === colonyId).map(([catId]) => catId);
}

/** The cats in each colony now, by colony id. Colonies with no cats are absent. */
export async function catsByColony(): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  for (const [catId, colonyId] of await currentColonyOf()) {
    const list = out.get(colonyId);
    if (list) list.push(catId);
    else out.set(colonyId, [catId]);
  }
  return out;
}
