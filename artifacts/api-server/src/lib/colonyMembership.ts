import { db, observationsTable } from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

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
 * The colony each cat is in now. A cat in no colony (never said, or "in no
 * colony", or every statement marked wrong) is simply absent from the map.
 * Pass `catIds` to look at some cats only; leave it out to look at every cat.
 */
export async function currentColonyOf(
  catIds?: readonly number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (catIds && catIds.length === 0) return out;

  // A statement is superseded when some other row points back at it.
  const replacer = alias(observationsTable, "replacer");
  const rows = await db
    .selectDistinctOn([observationsTable.catId], {
      catId: observationsTable.catId,
      value: observationsTable.value,
    })
    .from(observationsTable)
    .where(
      and(
        eq(observationsTable.kind, "colony"),
        isNull(observationsTable.redactedAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(replacer)
            .where(eq(replacer.supersedesId, observationsTable.id)),
        ),
        catIds ? inArray(observationsTable.catId, [...catIds]) : undefined,
      ),
    )
    .orderBy(
      asc(observationsTable.catId),
      desc(observationsTable.observedAt),
      desc(observationsTable.id),
    );

  for (const r of rows) {
    const colonyId = (r.value as { colonyId?: unknown } | null)?.colonyId;
    if (typeof colonyId === "number") out.set(r.catId, colonyId);
  }
  return out;
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
