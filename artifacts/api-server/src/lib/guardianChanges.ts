import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  catsTable,
  coloniesTable,
  db,
  observationsTable,
  peopleTable,
  personEventsTable,
  type Observation,
} from "@workspace/db";
import { authorityLevel, supersedeChains } from "./resolve";
import { readCoatValue } from "./appearance";

// The team's "recent guardian changes" (SYC-53 plan, PR 2.2; roles spec §6.2
// `view_guardian_changes`, §7.4, §6.9; Decision G). SYC-209's Colonies page
// draws the list and checks `view_guardian_changes` (island-only) before it
// calls this; this module only reads.
//
// It holds, newest first:
// - every statement written as `guardian` (any kind: sterilisation, life
//   status, colour, markings, colony membership, and later field checks),
//   each flagged `contradictsTeam` when a team record of the same kind on the
//   same cat that still stands says something different. Decision G lets her
//   word stand over the team's, so this is how the team sees the
//   disagreement instead of a silent flip;
// - every colony a guardian created, with the placement on it she was given
//   by doing so (`createColonyWithPlacement`'s `roles_changed` event, which
//   is add-only, so the entry survives her leaving);
// - every time the team marked a guardian's statement wrong, with the team
//   member's reason (SYC-2's hand-off: a team Correct on colour or markings
//   retracts her statements, and that overrule shows here).
//
// Names: the team page shows team members' and guardians' names (spec §2.3);
// nothing here reaches a guardian's own pages.

export interface ChangePerson {
  id: string;
  name: string;
  left: boolean;
}

export interface ChangeCat {
  id: number;
  name: string;
}

export type GuardianChange =
  | {
      type: "statement";
      /** When it was recorded (ISO). */
      at: string;
      /** When she said it was true (ISO): the server's clock on her routes. */
      observedAt: string;
      statementId: number;
      kind: string;
      /** The statement's value as stored (her reason, if any, is inside it). */
      value: unknown;
      guardian: ChangePerson | null;
      /** The colony that gave her the power, from `colony:<id>`. */
      colonyId: number | null;
      cat: ChangeCat;
      /** Nothing has marked it wrong. */
      standing: boolean;
      /** A team record of the same kind on this cat, still standing, says otherwise. */
      contradictsTeam: boolean;
    }
  | {
      type: "colony_created";
      at: string;
      guardian: ChangePerson | null;
      colony: { id: number; name: string } | null;
      colonyId: number;
    }
  | {
      type: "overruled";
      at: string;
      /** The team's row that marked hers wrong. */
      statementId: number;
      /** Her statement that it marked wrong. */
      overruledId: number;
      kind: string;
      reason: string | null;
      by: ChangePerson | null;
      guardian: ChangePerson | null;
      cat: ChangeCat;
      /**
       * The overrule was itself undone, so her statement stands again: a vet
       * visit marked wrong (SYC-396 PR 3.0, Decision 6). Shown as
       * {@link PUT_BACK_WORDS}.
       */
      putBack: boolean;
    };

/** How an overrule that was undone is shown (plan Task 3.0.2). */
export const PUT_BACK_WORDS = "put back when the visit was undone";

export const GUARDIAN_CHANGES_LIMIT = 200;

/**
 * What a statement says, as a comparable key, or null when it says nothing
 * to compare (a retraction, a malformed value). Reasons, agreements and
 * other context inside the value are ignored.
 */
export function meaningOf(kind: string, value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v["retracted"] === true) return null;
  const sorted = (x: unknown) => (Array.isArray(x) ? [...x].map(String).sort().join(",") : null);
  switch (kind) {
    case "sterilised":
      return typeof v["sterilised"] === "boolean" ? String(v["sterilised"]) : null;
    case "life_status":
      return typeof v["status"] === "string" ? v["status"] : null;
    case "ear_tip":
      return v["clipped"] === undefined ? null : String(v["clipped"]);
    case "coat": {
      // Read through the one translation (SYC-398 §6), so old and new shapes
      // compare, and a difference in the pattern alone counts.
      const parts = readCoatValue(v);
      if (!parts) return null;
      if (parts.notSure) return "notSure";
      return `${(parts.colours ?? []).join(",")}|${parts.pattern ?? ""}`;
    }
    case "markings":
      return v["cantTell"] === true ? "cantTell" : sorted(v["marks"]);
    case "colony":
      return "colonyId" in v ? String(v["colonyId"]) : null;
    default:
      return null;
  }
}

/** A row the team (staff, management) or an import wrote: Decision G's level 1. */
function isTeamRecord(o: Pick<Observation, "roleAtTime" | "authorityScope" | "provenance">): boolean {
  return authorityLevel(o) === 1;
}

/**
 * Does this guardian statement disagree with a team record that still stands
 * on the same cat? Both must say something comparable; a team row that is
 * itself a correction of hers doesn't count (that is an overrule, listed as
 * one).
 */
export function contradictsTeamRecord(
  statement: Observation,
  sameCatSameKind: readonly Observation[],
  replaced: ReadonlySet<number>,
): boolean {
  const mine = meaningOf(statement.kind, statement.value);
  if (mine === null) return false;
  // SYC-315 B, as the cat page reads it (review m6, r2-n1): a "not
  // sterilised" older than ANY standing "sterilised" on the cat is set aside,
  // whoever said either, so it is no disagreement.
  const newestYesAt =
    statement.kind === "sterilised"
      ? Math.max(
          ...sameCatSameKind
            .filter((o) => !replaced.has(o.id) && authorityLevel(o) > 0 && meaningOf(o.kind, o.value) === "true")
            .map((o) => o.observedAt.getTime()),
        )
      : -Infinity;
  const setAside = (o: Observation) =>
    statement.kind === "sterilised" &&
    meaningOf(o.kind, o.value) === "false" &&
    o.observedAt.getTime() < newestYesAt;
  if (setAside(statement)) return false;
  return sameCatSameKind.some(
    (o) =>
      o.id !== statement.id &&
      !replaced.has(o.id) &&
      o.supersedesId !== statement.id &&
      isTeamRecord(o) &&
      (() => {
        const theirs = meaningOf(o.kind, o.value);
        if (theirs === null || theirs === mine) return false;
        return !setAside(o);
      })(),
  );
}

const isRestorable = (kind: string) => kind === "sterilised" || kind === "vaccinated" || kind === "vet_visit";

const colonyOfScope = (scope: string | null): number | null => {
  const m = /^colony:([1-9][0-9]*)$/.exec(scope ?? "");
  return m ? Number(m[1]) : null;
};

/**
 * The list, newest first, at most `limit` entries (default 200). A fixed
 * number of queries whatever the count.
 */
export async function listGuardianChanges(
  opts: { limit?: number } = {},
): Promise<GuardianChange[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? GUARDIAN_CHANGES_LIMIT, 1000));

  // 1. Her statements, newest first.
  const statements = await db
    .select()
    .from(observationsTable)
    .where(eq(observationsTable.roleAtTime, "guardian"))
    .orderBy(desc(observationsTable.createdAt), desc(observationsTable.id))
    .limit(limit);

  // 2. Rows that marked a guardian's statement wrong, written by someone else.
  const target = alias(observationsTable, "target");
  const overrules = await db
    .select({ row: observationsTable, targetAccount: target.accountId, targetId: target.id })
    .from(observationsTable)
    .innerJoin(target, eq(observationsTable.supersedesId, target.id))
    .where(
      and(
        eq(target.roleAtTime, "guardian"),
        sql`${observationsTable.accountId} is distinct from ${target.accountId}`,
      ),
    )
    .orderBy(desc(observationsTable.createdAt), desc(observationsTable.id))
    .limit(limit);

  // 3. Colonies a guardian created (and the placement that came with it).
  const created = await db
    .select({
      personId: personEventsTable.personId,
      at: personEventsTable.at,
      detail: personEventsTable.detail,
    })
    .from(personEventsTable)
    .where(
      and(
        eq(personEventsTable.kind, "roles_changed"),
        sql`${personEventsTable.by} = ${personEventsTable.personId}::text`,
        isNotNull(sql`${personEventsTable.detail} -> 'createdColony'`),
      ),
    )
    .orderBy(desc(personEventsTable.at), desc(personEventsTable.id))
    .limit(limit);

  // Everything the entries name, in one query each.
  const catIds = [
    ...new Set([...statements.map((s) => s.catId), ...overrules.map((o) => o.row.catId)]),
  ];
  const sameKindRows =
    catIds.length === 0
      ? []
      : await db
          .select()
          .from(observationsTable)
          .where(
            and(
              inArray(observationsTable.catId, catIds),
              inArray(
                observationsTable.kind,
                [...new Set([...statements.map((s) => s.kind), ...overrules.map((o) => o.row.kind)])].concat("_none"),
              ),
            ),
          );

  const rowsByCatKind = new Map<string, Observation[]>();
  for (const o of sameKindRows) {
    const key = `${o.catId}:${o.kind}`;
    const list = rowsByCatKind.get(key) ?? [];
    list.push(o);
    rowsByCatKind.set(key, list);
  }
  // What no longer stands. For the kinds a vet visit writes, by the
  // resolver's restore rule (SYC-396 PR 3.0): her statement overruled by a
  // visit stands again once the visit is undone, and the overruling row
  // that was undone is `undone`. Every other kind: anything pointing at it.
  const replaced = new Set<number>();
  const undone = new Set<number>();
  for (const o of sameKindRows) {
    if (o.supersedesId != null && !isRestorable(o.kind)) replaced.add(o.supersedesId);
  }
  for (const kind of ["sterilised", "vaccinated", "vet_visit"] as const) {
    const chains = supersedeChains(sameKindRows, kind);
    for (const id of chains.displaced) replaced.add(id);
    for (const id of chains.retracted) undone.add(id);
  }
  const cats =
    catIds.length === 0
      ? []
      : await db
          .select({ id: catsTable.id, name: catsTable.name })
          .from(catsTable)
          .where(inArray(catsTable.id, catIds));
  const catById = new Map(cats.map((c) => [c.id, c]));

  const colonyIds = [
    ...new Set(
      created
        .map((c) => (c.detail as { createdColony?: unknown } | null)?.createdColony)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];
  const colonies =
    colonyIds.length === 0
      ? []
      : await db
          .select({ id: coloniesTable.id, name: coloniesTable.name })
          .from(coloniesTable)
          .where(inArray(coloniesTable.id, colonyIds));
  const colonyById = new Map(colonies.map((c) => [c.id, c]));

  const personIds = [
    ...new Set(
      [
        ...statements.map((s) => s.accountId),
        ...overrules.flatMap((o) => [o.row.accountId, o.targetAccount]),
        ...created.map((c) => c.personId),
      ].filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)),
    ),
  ];
  const people =
    personIds.length === 0
      ? []
      : await db
          .select({ id: peopleTable.id, name: peopleTable.name, leftAt: peopleTable.leftAt })
          .from(peopleTable)
          .where(inArray(peopleTable.id, personIds));
  const personById = new Map(
    people.map((p) => [p.id, { id: p.id, name: p.name, left: p.leftAt !== null }]),
  );
  const who = (id: string | null) => (id ? (personById.get(id) ?? null) : null);
  const catRef = (id: number): ChangeCat => catById.get(id) ?? { id, name: `#${id}` };

  const out: GuardianChange[] = [
    ...statements.map(
      (s): GuardianChange => ({
        type: "statement",
        at: s.createdAt.toISOString(),
        observedAt: s.observedAt.toISOString(),
        statementId: s.id,
        kind: s.kind,
        value: s.value,
        guardian: who(s.accountId),
        colonyId: colonyOfScope(s.authorityScope),
        cat: catRef(s.catId),
        standing: !replaced.has(s.id),
        contradictsTeam:
          !replaced.has(s.id) &&
          contradictsTeamRecord(s, rowsByCatKind.get(`${s.catId}:${s.kind}`) ?? [], replaced),
      }),
    ),
    ...overrules.map(
      ({ row, targetAccount, targetId }): GuardianChange => ({
        type: "overruled",
        at: row.createdAt.toISOString(),
        statementId: row.id,
        overruledId: targetId,
        kind: row.kind,
        reason: row.supersedeReason,
        by: who(row.accountId),
        guardian: who(targetAccount),
        cat: catRef(row.catId),
        putBack: undone.has(row.id),
      }),
    ),
    ...created.flatMap((c): GuardianChange[] => {
      const colonyId = (c.detail as { createdColony?: unknown } | null)?.createdColony;
      if (typeof colonyId !== "number") return [];
      return [
        {
          type: "colony_created",
          at: c.at.toISOString(),
          guardian: who(c.personId),
          colony: colonyById.get(colonyId) ?? null,
          colonyId,
        },
      ];
    }),
  ];
  out.sort((a, b) => b.at.localeCompare(a.at));
  return out.slice(0, limit);
}
