import {
  coloniesTable,
  db,
  feedingSitesTable,
  observationsTable,
  peopleTable,
  personScopesTable,
  scopeInForce,
  welfareReportsTable,
} from "@workspace/db";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { loadTeamCats, type TeamCat } from "../teamCatList";
import { colonyFilter, covers, type Visible } from "../guardianView";
import { isActive, isStreet, splitOf, type Split } from "./countedCats";

// Each colony's figures and flags for the Colonies list (SYC-396 PR 2.2;
// spec §9.1). Who is counted comes from countedCats (§9.5): the bar is the
// colony's street cats, split four ways. Worked out from the records on
// every request (§9.6), with one query per rule over every visible colony,
// never one per colony.
//
// **What a cat guardian sees (§10.2).** Every read here takes the viewer's
// `Visible` and filters by it, so she gets her own colonies' figures and no
// other colony is ever in the answer. Her "Kittens reported" counts only the
// litter reports she may read: those tied to a cat in her colonies. The
// 300 m rule reads the team's welfare positions, so it is the team's alone
// (`opts.island`).

export const GROWING_DAYS = 90,
  GROWING_MIN = 3,
  KITTENS_DAYS = 60,
  KITTENS_RADIUS_M = 300,
  NOT_VISITED_DAYS = 30;

export type ColonyFlag = "growing" | "kittens" | "no_guardian" | "not_visited";

/** The flags in the order a card lists them. */
export const FLAG_ORDER: readonly ColonyFlag[] = ["kittens", "growing", "not_visited", "no_guardian"];

export interface ColonyFigures {
  colonyId: number;
  street: number;
  split: Split;
  /**
 * Whole per cent of street cats confirmed sterilised; null when street = 0.
 * Never 100 while one isn't, and never 0 while one is.
 */
  confirmedPct: number | null;
  /** Active cats here now (street, homed, in care) on Syros, never "No longer with us". */
  catCount: number;
  latestSightingAt: Date | null;
  flags: ColonyFlag[];
  /**
   * The cat guardians placed on this colony now, by name (people who haven't
   * left, placement in force). A colony a guardian created has her placement
   * but no typed guardian name, so the card names her from here. These are
   * names a guardian may already read on her own colony (`nameLabeller`).
   */
  guardianNames: string[];
}

const DAY = 86_400_000;
const EARTH_RADIUS_M = 6_371_000;

const blank = (s: string | null) => s === null || s.trim() === "";

/** Rounded, but 100 only when all are, and 0 only when none are. */
export function wholePct(part: number, whole: number): number {
  if (part >= whole) return 100;
  if (part <= 0) return 0;
  return Math.min(99, Math.max(1, Math.round((part / whole) * 100)));
}

/**
 * The colonies this viewer sees, with their typed guardian names. The
 * starting list: a colony with no cats still has figures.
 */
async function visibleColonies(visible: Visible): Promise<{ id: number; guardianName: string | null }[]> {
  return db
    .select({ id: coloniesTable.id, guardianName: coloniesTable.guardianName })
    .from(coloniesTable)
    .where(colonyFilter(coloniesTable.id, visible));
}

/** The names of the cat guardians placed on each visible colony now. */
async function placedGuardians(visible: Visible, now: Date): Promise<Map<number, string[]>> {
  const rows = await db
    // By person, so two guardians who share a name are both named.
    .selectDistinct({ colonyId: personScopesTable.colonyId, personId: peopleTable.id, name: peopleTable.name })
    .from(personScopesTable)
    .innerJoin(peopleTable, eq(peopleTable.id, personScopesTable.personId))
    .where(
      and(
        eq(personScopesTable.role, "guardian"),
        eq(personScopesTable.reach, "colony"),
        isNotNull(personScopesTable.colonyId),
        scopeInForce(sql`${now.toISOString()}::timestamptz`),
        isNull(peopleTable.leftAt),
        // Someone invited who hasn't joined yet isn't looking after it.
        isNotNull(peopleTable.acceptedAt),
        colonyFilter(personScopesTable.colonyId, visible),
      ),
    )
    .orderBy(asc(peopleTable.name));
  const out = new Map<number, string[]>();
  for (const r of rows) {
    if (r.colonyId === null) continue;
    const list = out.get(r.colonyId);
    if (list) list.push(r.name);
    else out.set(r.colonyId, [r.name]);
  }
  return out;
}

/**
 * The colony each cat was FIRST recorded in: its earliest colony statement
 * that names a colony, leaving out any marked wrong or redacted. A cat moved
 * in from elsewhere has an earlier statement there, so it is not new here.
 */
async function firstColonyOf(catIds: readonly number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (catIds.length === 0) return out;
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
        inArray(observationsTable.catId, [...catIds]),
        sql`jsonb_typeof(${observationsTable.value}->'colonyId') = 'number'`,
        notExists(
          db.select({ one: sql`1` }).from(replacer).where(eq(replacer.supersedesId, observationsTable.id)),
        ),
      ),
    )
    .orderBy(asc(observationsTable.catId), asc(observationsTable.observedAt), asc(observationsTable.id));
  for (const r of rows) {
    const colonyId = (r.value as { colonyId?: unknown } | null)?.colonyId;
    if (typeof colonyId === "number") out.set(r.catId, colonyId);
  }
  return out;
}

/**
 * Growing (§9.1): at least GROWING_MIN cats new to the records in the last
 * GROWING_DAYS whose first colony is this one, and more than in the
 * GROWING_DAYS before.
 */
async function growingColonies(cats: readonly TeamCat[], now: Date): Promise<Set<number>> {
  const recent = now.getTime() - GROWING_DAYS * DAY;
  const before = now.getTime() - 2 * GROWING_DAYS * DAY;
  const candidates = cats.filter((c) => c.createdAt.getTime() > before && c.createdAt.getTime() <= now.getTime());
  const first = await firstColonyOf(candidates.map((c) => c.id));
  const counts = new Map<number, { recent: number; before: number }>();
  for (const c of candidates) {
    const colonyId = first.get(c.id);
    if (colonyId === undefined) continue;
    const n = counts.get(colonyId) ?? { recent: 0, before: 0 };
    if (c.createdAt.getTime() > recent) n.recent += 1;
    else n.before += 1;
    counts.set(colonyId, n);
  }
  const out = new Set<number>();
  for (const [colonyId, n] of counts) if (n.recent >= GROWING_MIN && n.recent > n.before) out.add(colonyId);
  return out;
}

/** The litter reports that count: welfare, with kittens, sent, in the last KITTENS_DAYS. */
const countedLitter = (now: Date) =>
  and(
    eq(welfareReportsTable.kind, "welfare"),
    eq(welfareReportsTable.isLitter, true),
    eq(welfareReportsTable.isDraft, false),
    gt(welfareReportsTable.submittedAt, new Date(now.getTime() - KITTENS_DAYS * DAY)),
    lte(welfareReportsTable.submittedAt, now),
  );

/** Colonies with a counted litter report tied to one of their cats now. */
async function kittensTiedToCats(cats: readonly TeamCat[], now: Date): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ catId: welfareReportsTable.catId })
    .from(welfareReportsTable)
    .where(and(countedLitter(now), isNotNull(welfareReportsTable.catId)));
  const colonyOf = new Map(cats.map((c) => [c.id, c.colonyId]));
  const out = new Set<number>();
  for (const r of rows) {
    const colonyId = r.catId === null ? null : colonyOf.get(r.catId);
    if (typeof colonyId === "number") out.add(colonyId);
  }
  return out;
}

/**
 * Colonies with a counted litter report within KITTENS_RADIUS_M of one of
 * their feeding sites that isn't retired. The team's alone: it reads exact
 * welfare positions. The distance is worked out in the query (haversine, as
 * lib/feedingSiteProximity.ts), so no position reaches the application.
 */
async function kittensNearSites(visible: Visible, now: Date): Promise<Set<number>> {
  const w = welfareReportsTable;
  const s = feedingSitesTable;
  const rows = await db
    .selectDistinct({ colonyId: s.colonyId })
    .from(w)
    .innerJoin(
      s,
      sql`${2 * EARTH_RADIUS_M}::float8 * asin(least(1::float8, sqrt(
            power(sin(radians(${s.lat} - ${w.lat}) / 2), 2)
            + cos(radians(${w.lat})) * cos(radians(${s.lat}))
              * power(sin(radians(${s.lng} - ${w.lng}) / 2), 2)
          ))) <= ${KITTENS_RADIUS_M}::float8`,
    )
    .where(
      and(
        countedLitter(now),
        isNotNull(w.lat),
        isNotNull(w.lng),
        isNull(s.retiredAt),
        isNotNull(s.colonyId),
        colonyFilter(s.colonyId, visible),
      ),
    );
  return new Set(rows.flatMap((r) => (r.colonyId === null ? [] : [r.colonyId])));
}

/**
 * Every visible colony's figures, by colony id. `opts.island` is true for the
 * team (`isIslandWide`): only then does "Kittens reported" read the 300 m rule.
 * `opts.asOf` (Colony health for a past range, SYC-396 PR 3.3a): the cats,
 * their sightings and colonies as they stood then (`loadTeamCats`'s asOf), so
 * the latest sighting and Not visited lately don't use later records.
 */
export async function colonyFigures(
  visible: Visible,
  opts: { island: boolean; asOf?: Date; cats?: readonly TeamCat[] },
  now: Date = new Date(),
): Promise<Map<number, ColonyFigures>> {
  // `cats`: a caller that already loaded every cat (Home, SYC-603) passes them
  // in, so they aren't loaded twice. They are as of now, so never with asOf.
  if (opts.cats && opts.asOf) throw new Error("colonyFigures: cats and asOf are exclusive");
  const out = new Map<number, ColonyFigures>();
  const colonies = await visibleColonies(visible);
  if (colonies.length === 0) return out;

  const all = opts.cats ?? (await loadTeamCats(now, { asOf: opts.asOf }));
  // Only the cats in a colony this viewer sees.
  const cats = all.filter((c) => c.colonyId !== null && covers(visible, c.colonyId));

  const [guardians, growing, tied, near] = await Promise.all([
    placedGuardians(visible, now),
    // Over every cat, so a cat new here that has since moved to a colony this
    // viewer can't see still counts here: the team and the colony's own cat
    // guardian read the same flag. Only the flags of visible colonies leave.
    growingColonies(all, now),
    kittensTiedToCats(cats, now),
    opts.island ? kittensNearSites(visible, now) : Promise.resolve(new Set<number>()),
  ]);

  const byColony = new Map<number, TeamCat[]>();
  for (const c of cats) {
    const list = byColony.get(c.colonyId!);
    if (list) list.push(c);
    else byColony.set(c.colonyId!, [c]);
  }

  const notVisitedBefore = now.getTime() - NOT_VISITED_DAYS * DAY;
  for (const colony of colonies) {
    const here = byColony.get(colony.id) ?? [];
    const split = splitOf(here);
    const street = split.sterilised + split.probably + split.not_sterilised + split.not_known;
    // The latest sighting and the cat count read the colony's current cats:
    // active (not "No longer with us") and on Syros (§3.3).
    const current = here.filter((c) => isActive(c) && c.areaKey !== "off");
    const newest = (cs: readonly TeamCat[]) =>
      cs.reduce<number | null>(
        (m, c) => (c.lastSeenAt === null ? m : Math.max(m ?? -Infinity, c.lastSeenAt.getTime())),
        null,
      );
    const latest = newest(current);
    // Not visited lately reads its street cats only (Samuel, 19 Oct): a cat
    // with a home or in care isn't expected to be spotted, so a colony whose
    // street cats were all rehomed is never flagged.
    const streetCats = here.filter(isStreet);
    const streetLatest = newest(streetCats);
    const names = guardians.get(colony.id) ?? [];
    const flags = new Set<ColonyFlag>();
    if (growing.has(colony.id)) flags.add("growing");
    if (tied.has(colony.id) || near.has(colony.id)) flags.add("kittens");
    // Decision 15: no placement in force AND no typed name.
    if (names.length === 0 && blank(colony.guardianName)) flags.add("no_guardian");
    if (streetCats.length > 0 && (streetLatest === null || streetLatest < notVisitedBefore)) flags.add("not_visited");
    out.set(colony.id, {
      colonyId: colony.id,
      street,
      split,
      confirmedPct: street === 0 ? null : wholePct(split.sterilised, street),
      catCount: current.length,
      latestSightingAt: latest === null ? null : new Date(latest),
      flags: FLAG_ORDER.filter((f) => flags.has(f)),
      guardianNames: names,
    });
  }
  return out;
}
