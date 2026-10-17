import { catsTable, db, observationsTable } from "@workspace/db";
import { and, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { CapabilityHolder } from "./capabilities";
import { visibleColonyIds } from "./guardianView";

// "Mimi has moved to another colony" (SYC-209 PR 4.2; feeding-sites spec
// Decision 14; Samuel, 15 Oct 2026: SYC-209 builds it, once, here). When
// someone else puts one of a cat guardian's cats in a colony that isn't hers,
// her colony page tells her, for 30 days, without saying which colony or
// whose. The roles plan's "My colonies" page and her saved list call this
// same function, so the rule lives in one place.
//
// Worked out from the cat's `colony` statements, with the same rule as
// colonyMembership.ts (marked-wrong and redacted statements don't count; the
// newest by observedAt stands, then the higher id). No new table.

/** How long the line stays: 30 days after the move (the plan's choice). */
export const MOVED_AWAY_DAYS = 30;

export interface MovedAwayNotice {
  catId: number;
  catName: string;
  /** Her colony the cat left. Never the colony it went to. */
  fromColonyId: number;
  movedAt: Date;
}

/**
 * The cats that left one of this person's colonies for a colony that isn't
 * one of hers, moved by someone else, in the last 30 days. Newest first.
 * Nothing for the team (island-wide) or for someone with no colony. A cat
 * taken OUT of her colony (to no colony) isn't "moved to another colony",
 * and neither is a move she made herself or a move between two of her own
 * colonies.
 */
export async function movedAwayNotices(
  person: CapabilityHolder & { id: string },
  now: Date = new Date(),
): Promise<MovedAwayNotice[]> {
  const mine = visibleColonyIds(person).ids;
  if (mine === null || mine.length === 0) return [];
  const since = new Date(now.getTime() - MOVED_AWAY_DAYS * 24 * 60 * 60 * 1000);

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

  // Candidates: cats a standing statement has ever put in one of her colonies.
  const candidates = await db
    .selectDistinct({ catId: observationsTable.catId })
    .from(observationsTable)
    .where(
      and(
        standing,
        sql`(${observationsTable.value}->>'colonyId') in (${sql.join(
          mine.map((id) => sql`${String(id)}`),
          sql`, `,
        )})`,
      ),
    );
  if (candidates.length === 0) return [];

  const rows = await db
    .select({
      catId: observationsTable.catId,
      value: observationsTable.value,
      accountId: observationsTable.accountId,
      observedAt: observationsTable.observedAt,
    })
    .from(observationsTable)
    .where(and(standing, inArray(observationsTable.catId, candidates.map((c) => c.catId))))
    .orderBy(
      observationsTable.catId,
      desc(observationsTable.observedAt),
      desc(observationsTable.id),
    );

  const byCat = new Map<number, typeof rows>();
  for (const r of rows) {
    const list = byCat.get(r.catId);
    if (list) list.push(r);
    else byCat.set(r.catId, [r]);
  }

  const colonyOf = (v: unknown): number | null => {
    const c = (v as { colonyId?: unknown } | null)?.colonyId;
    return typeof c === "number" ? c : null;
  };

  const found: Omit<MovedAwayNotice, "catName">[] = [];
  for (const [catId, list] of byCat) {
    const [newest, previous] = list;
    if (!newest || !previous) continue;
    const from = colonyOf(previous.value);
    const to = colonyOf(newest.value);
    if (from === null || !mine.includes(from)) continue; // wasn't hers
    if (to === null || mine.includes(to)) continue; // taken out, or moved within hers
    if (newest.accountId === person.id) continue; // she moved it herself
    if (newest.observedAt < since) continue; // more than 30 days ago
    found.push({ catId, fromColonyId: from, movedAt: newest.observedAt });
  }
  if (found.length === 0) return [];

  const names = new Map(
    (
      await db
        .select({ id: catsTable.id, name: catsTable.name })
        .from(catsTable)
        .where(inArray(catsTable.id, found.map((f) => f.catId)))
    ).map((c) => [c.id, c.name]),
  );
  return found
    .map((f) => ({ ...f, catName: names.get(f.catId) ?? "" }))
    .sort((a, b) => b.movedAt.getTime() - a.movedAt.getTime() || a.catId - b.catId);
}
