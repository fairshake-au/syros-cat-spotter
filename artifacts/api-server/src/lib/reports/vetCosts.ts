import { catsTable, db, observationsTable, type Observation } from "@workspace/db";
import { inArray, or, sql } from "drizzle-orm";
import type { VetVisitValue } from "../observations";
import { standingRows, type Vaccine } from "../resolve";
import { TEAM_ROLES } from "../teamRoles";
import { clinicName } from "../vetVisits";
import { monthsIn, type Range } from "./range";

// Vet visits and costs (SYC-396 PR 3.3c, Task 3.3c.1; spec §8.4, §9.3
// report 5). Team-only, and only with view_vet_costs on top of view_reports.
//
// - **Spend** is Syros Cats' money only: visits paid by Syros Cats, or by a
//   donation given for the cat (§8.4). An owner-paid visit is listed in the
//   table with its cost, but never added into spend, the purposes or the
//   cost per sterilisation.
// - **What was done** files each visit under its main purpose (Decision 14):
//   Sterilised if ticked, else Vaccinated, else Treated, else Checked. One
//   visit is never counted twice, so the purposes add up to the spend.
// - **No cost recorded** counts the cats the team said were sterilised with
//   "Update this cat" (a standing team `sterilised: true` without a visit),
//   plus visits with Sterilised ticked and no cost.
// - A visit counts on the day it happened (its observedAt), however late it
//   was entered, like every event in the reports (§9.3).
// - **An undone visit is nowhere.** Visits and their statements are read as
//   they stand (standingRows), so an undo takes the visit, its sterilisation
//   and its cost out of every figure and the table.
//
// Money is added in cents, never as floats. Every visit counts wherever the
// cat lives: this is money spent and visits made, not a count of cats, so it
// doesn't go through countedCats (the same rule as Home's vetSpendEur).

export type Purpose = "sterilised" | "vaccinated" | "treated" | "checked";
export const PURPOSE_ORDER: readonly Purpose[] = ["sterilised", "vaccinated", "treated", "checked"];

/** Who paid, for spend (§8.4): Syros Cats' own money and donations given for the cat. */
export const SPEND_PAID_BY: ReadonlySet<VetVisitValue["paidBy"]> = new Set(["syros_cats", "donation"]);

/** A visit's main purpose (Decision 14). */
export function purposeOf(did: readonly VetVisitValue["did"][number][]): Purpose {
  return PURPOSE_ORDER.find((p) => did.includes(p)) ?? "checked";
}

/** One standing visit, as the table lists it. */
export interface VisitRow {
  visitId: number;
  catId: number;
  catName: string;
  at: Date;
  clinic: string;
  did: VetVisitValue["did"];
  vaccines?: Vaccine[];
  treatedNote?: string;
  costEur: number | null;
  paidBy: VetVisitValue["paidBy"];
}

export interface VetCostsReport {
  /** Every month the range touches, oldest first: all visits, and Syros Cats' spend. */
  perMonth: { at: Date; visits: number; spendEur: number }[];
  /** Syros Cats' spend by each visit's main purpose (Decision 14). */
  byPurpose: Record<Purpose, number>;
  /** All visits by main purpose, whoever paid. */
  visitsByPurpose: Record<Purpose, number>;
  /** Sterilising visits Syros Cats paid for, with a cost; null if none. */
  perSterilisation: { avg: number; min: number; max: number; n: number } | null;
  noCost: number;
  /** Newest first. */
  visits: VisitRow[];
  workedOutAt: Date;
  ms: number;
}

const cents = (eur: number) => Math.round(eur * 100);
const zeroes = (): Record<Purpose, number> => ({ sterilised: 0, vaccinated: 0, treated: 0, checked: 0 });

const isTeamYesWithoutVisit = (o: Observation) => {
  const v = o.value as { sterilised?: unknown; vetVisitId?: unknown } | null;
  return TEAM_ROLES.has(o.roleAtTime) && v !== null && typeof v === "object" && v.sterilised === true && v.vetVisitId === undefined;
};

/**
 * The report from the island's `sterilised` and `vet_visit` rows (with every
 * row that supersedes one) and the cats' names. Pure.
 */
export function vetCostsFrom(
  observations: readonly Observation[],
  catNames: ReadonlyMap<number, string>,
  range: Range,
): Omit<VetCostsReport, "workedOutAt" | "ms"> {
  const from = range.from?.getTime() ?? -Infinity;
  const to = range.to.getTime();
  const inRange = (o: Observation) => o.observedAt.getTime() >= from && o.observedAt.getTime() <= to;

  // Redacted visits are left out, as Home's vetSpend leaves them out.
  const standingVisits = standingRows(observations, "vet_visit").filter((o) => !o.redactedAt);
  const visits = standingVisits.filter(inRange).sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime() || b.id - a.id);

  const months = monthsIn(range, visits.reduce<Date>((m, o) => (o.observedAt < m ? o.observedAt : m), range.to));
  const perMonth = months.map((at) => ({ at, visits: 0, spendCents: 0 }));
  const monthOf = (at: Date) => {
    let i = -1;
    for (let k = 0; k < months.length && months[k]!.getTime() <= at.getTime(); k++) i = k;
    return i;
  };

  const byPurposeCents = zeroes();
  const visitsByPurpose = zeroes();
  const sterilisationCents: number[] = [];
  let noCost = 0;

  for (const o of visits) {
    const v = o.value as VetVisitValue;
    const purpose = purposeOf(v.did);
    const spends = SPEND_PAID_BY.has(v.paidBy) && typeof v.costEur === "number";
    const m = perMonth[monthOf(o.observedAt)];
    if (m) {
      m.visits += 1;
      if (spends) m.spendCents += cents(v.costEur as number);
    }
    visitsByPurpose[purpose] += 1;
    if (spends) byPurposeCents[purpose] += cents(v.costEur as number);
    if (v.did.includes("sterilised")) {
      if (v.costEur === null) noCost += 1;
      else if (spends) sterilisationCents.push(cents(v.costEur));
    }
  }

  // "Update this cat → whether sterilised": once per cat, and not for a cat a
  // standing visit sterilised, whose sterilisation is the visit's.
  const sterilisedByVisit = new Set(standingVisits.filter((o) => (o.value as VetVisitValue).did.includes("sterilised")).map((o) => o.catId));
  const updated = new Set(
    standingRows(observations, "sterilised")
      .filter((o) => inRange(o) && isTeamYesWithoutVisit(o) && !sterilisedByVisit.has(o.catId))
      .map((o) => o.catId),
  );
  noCost += updated.size;

  const n = sterilisationCents.length;
  const perSterilisation =
    n === 0
      ? null
      : {
          avg: Math.round(sterilisationCents.reduce((s, c) => s + c, 0) / n) / 100,
          min: Math.min(...sterilisationCents) / 100,
          max: Math.max(...sterilisationCents) / 100,
          n,
        };

  return {
    perMonth: perMonth.map((m) => ({ at: m.at, visits: m.visits, spendEur: m.spendCents / 100 })),
    byPurpose: Object.fromEntries(PURPOSE_ORDER.map((p) => [p, byPurposeCents[p] / 100])) as Record<Purpose, number>,
    visitsByPurpose,
    perSterilisation,
    noCost,
    visits: visits.map((o) => {
      const v = o.value as VetVisitValue;
      const row: VisitRow = {
        visitId: o.id,
        catId: o.catId,
        catName: catNames.get(o.catId) ?? `Cat ${o.catId}`,
        at: o.observedAt,
        clinic: clinicName(v.clinicId),
        did: v.did,
        costEur: v.costEur,
        paidBy: v.paidBy,
      };
      if (v.vaccines) row.vaccines = v.vaccines;
      if (v.treatedNote) row.treatedNote = v.treatedNote;
      return row;
    }),
  };
}

export async function vetCostsReport(range: Range, now: Date): Promise<VetCostsReport> {
  const started = Date.now();
  const o = observationsTable;
  const KINDS = ["sterilised", "vet_visit"];
  // Every row of the two kinds, with its undos and corrections (they are the
  // same kinds), and any row of another kind that points at one, so the
  // restore rule can say which stand.
  const rows = await db
    .select()
    .from(o)
    .where(
      or(
        inArray(o.kind, KINDS),
        sql`${o.supersedesId} in (select id from observations where kind in ('sterilised', 'vet_visit'))`,
      ),
    );
  const catIds = [...new Set(rows.filter((r) => r.kind === "vet_visit").map((r) => r.catId))];
  const cats = catIds.length
    ? await db.select({ id: catsTable.id, name: catsTable.name }).from(catsTable).where(inArray(catsTable.id, catIds))
    : [];
  const names = new Map(cats.map((c) => [c.id, c.name]));
  return { ...vetCostsFrom(rows, names, range), workedOutAt: now, ms: Date.now() - started };
}
