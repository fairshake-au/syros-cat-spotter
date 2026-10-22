import { db, observationsTable, sightingsTable, welfareReportsTable } from "@workspace/db";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { listWelfareQueue, type QueueReport } from "../welfareQueue";
import { listLikelyForReview } from "../likelyReview";
import { listColourCheck } from "../colourCheck";
import { loadTeamCats, type TeamCat } from "../teamCatList";
import { areaFor, OFF_SYROS } from "../areas/namedAreas";
import { athensMonths } from "../athensTime";
import { allColonyChoices } from "../colonyCats";
import type { Visible } from "../guardianView";
import { headline, toDo, type Headline } from "./countedCats";
import { colonyFigures } from "./colonyFigures";
import { rankTrapNext, type TrapColony } from "./trapNext";
import { standardPriceNow } from "../vetSettings";
import { standingRows } from "../resolve";
import type { VetVisitValue } from "../observations";

// The figures behind Home (SYC-396 spec §4; plan PR 2.1, Task 2.1.1).
// Worked out from the records on every request (§9.6). Each section is read
// on its own: one that fails comes back as `{ ok: false }` and the page says
// "This figure isn't available right now", while every other section still
// draws (§13). Home never holds response times, rankings or anything per
// person (D6): nothing here reads who did what.

export const HOME_LINES_LIMIT = 5; // urgent and kitten report lines shown (SYC-603, §4.1)

export interface MonthFigures {
  sightings: number;
  newCats: number;
  sterilisations: number;
  /**
   * Syros Cats' money spent on vet visits in the month (§8.4): the cost of
   * every standing visit paid by Syros Cats or by a donation for that cat.
   * Owner-paid visits are never added in. Shown only with `view_vet_costs`.
   */
  vetSpendEur: number;
}

export interface HomeNeeds {
  /**
   * Open, checked reports that are urgent or about kittens (§4.1): urgent
   * first, then newest, at most HOME_LINES_LIMIT. A report both urgent and
   * about kittens is one line.
   */
  lines: QueueReport[];
  /** Every such report, so "See all N" is honest. */
  linesTotal: number;
  /** The other open, checked reports: the "more reports" tile. */
  otherOpen: number;
  /** Reports accepted while the bot check was down: never missed (§4, plan review finding 1). */
  unchecked: number;
  /** "Report an issue" reports still open. */
  issuesOpen: number;
  /** Sightings held for the team to match ("Ask Syros Cats to match it"). 0 until something writes it. */
  awaitingMatch: number;
}

/** The two check lists' counts (§4.1 tiles). Their photos stay on their own pages. */
export interface HomeToCheck {
  earClips: number;
  colour: number;
}

/** Where to trap next (§4.2). */
export interface TrapNext {
  colonies: TrapColony[];
  /** Every colony on the island, so the empty states can tell "none yet" from "all done". */
  colonyCount: number;
  /** Street cats to do that aren't in any colony. */
  noColony: number;
  /** The standard sterilisation price from Vet settings (§8.2). */
  priceEur: number;
}

/** A section's figures, or a note that they couldn't be worked out this time. */
export type Section<T> = { ok: true; value: T } | { ok: false };

export interface HomeData {
  needs: Section<HomeNeeds>;
  toCheck: Section<HomeToCheck>;
  trapNext: Section<TrapNext>;
  headline: Section<Headline>;
  month: Section<{ now: MonthFigures; last: MonthFigures }>;
  /** When these figures were worked out (§9.6: a page always says). */
  at: Date;
}

/** sightings.status = 'awaiting_team': spotters' points held until the team acts. */
export async function countAwaitingMatch(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sightingsTable)
    .where(and(eq(sightingsTable.status, "awaiting_team"), isNull(sightingsTable.redactedAt)));
  return Number(row?.n ?? 0);
}

/** "Report an issue" reports (kind 'content') that are sent and still new or being looked at. */
export async function countOpenIssues(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(welfareReportsTable)
    .where(
      and(
        eq(welfareReportsTable.kind, "content"),
        eq(welfareReportsTable.isDraft, false),
        inArray(welfareReportsTable.state, ["new", "looking"]),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * One month's figures, [from, to):
 * - sightings: resolved sightings entered in the month, on Syros, not redacted;
 * - newCats: cats first recorded in the month (merged-away halves are
 *   already left out by loadTeamCats);
 * - sterilisations: cats confirmed sterilised whose operation date (the
 *   resolved value's asOf) falls in the month, however late it was entered.
 * Off Syros is never counted in any figure (§3.3).
 */
/** Who paid, for spend (§8.4): Syros Cats' own money and donations given for the cat. */
const SPEND_PAID_BY: ReadonlySet<string> = new Set(["syros_cats", "donation"]);

/**
 * The month's vet spend (§8.4), from the visits as they stand: an undone
 * visit costs nothing. Every visit counts, wherever the cat is: this is
 * money spent, not a count of cats.
 */
export async function vetSpend(from: Date, to: Date): Promise<number> {
  // Every vet_visit row, with its undos (they are vet_visit rows too), so
  // the restore rule can say which visits stand.
  const rows = await db.select().from(observationsTable).where(eq(observationsTable.kind, "vet_visit"));
  const cents = standingRows(rows, "vet_visit")
    .filter((o) => !o.redactedAt && o.observedAt.getTime() >= from.getTime() && o.observedAt.getTime() < to.getTime())
    .map((o) => o.value as VetVisitValue)
    .filter((v) => SPEND_PAID_BY.has(v.paidBy) && typeof v.costEur === "number")
    .reduce((sum, v) => sum + Math.round((v.costEur as number) * 100), 0);
  return cents / 100;
}

export async function monthFigures(from: Date, to: Date, cats: readonly TeamCat[]): Promise<MonthFigures> {
  const rows = await db
    .select({ lat: sightingsTable.lat, lng: sightingsTable.lng })
    .from(sightingsTable)
    .where(
      and(
        eq(sightingsTable.status, "resolved"),
        isNull(sightingsTable.redactedAt),
        gte(sightingsTable.createdAt, from),
        lt(sightingsTable.createdAt, to),
      ),
    );
  const inMonth = (at: Date) => at.getTime() >= from.getTime() && at.getTime() < to.getTime();
  const onSyros = cats.filter((c) => c.areaKey !== OFF_SYROS.key);
  return {
    sightings: rows.filter((r) => areaFor(r.lat, r.lng).key !== OFF_SYROS.key).length,
    newCats: onSyros.filter((c) => inMonth(c.createdAt)).length,
    sterilisations: onSyros.filter(
      (c) =>
        c.snapshot.sterilised.value === true &&
        c.snapshot.sterilised.confidence === "confirmed" &&
        inMonth(new Date(c.snapshot.sterilised.asOf)),
    ).length,
    vetSpendEur: await vetSpend(from, to),
  };
}

/** The readers Home uses. A test passes its own to prove one failing section doesn't take the page down. */
export interface HomeDeps {
  listWelfareQueue: typeof listWelfareQueue;
  countOpenIssues: typeof countOpenIssues;
  countAwaitingMatch: typeof countAwaitingMatch;
  listLikelyForReview: typeof listLikelyForReview;
  listColourCheck: typeof listColourCheck;
  loadTeamCats: typeof loadTeamCats;
  monthFigures: typeof monthFigures;
  allColonyChoices: typeof allColonyChoices;
  colonyFigures: typeof colonyFigures;
  standardPriceNow: typeof standardPriceNow;
}

const DEFAULT_DEPS: HomeDeps = {
  listWelfareQueue,
  countOpenIssues,
  countAwaitingMatch,
  listLikelyForReview,
  listColourCheck,
  loadTeamCats,
  monthFigures,
  allColonyChoices,
  colonyFigures,
  standardPriceNow,
};

async function section<T>(read: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return { ok: false };
  }
}

const isLine = (r: QueueReport) => r.severity === "urgent" || r.isLitter;

/** Urgent first, then newest; the id settles a tie so the order never wobbles. */
const lineOrder = (a: QueueReport, b: QueueReport) =>
  Number(b.severity === "urgent") - Number(a.severity === "urgent") ||
  Date.parse(b.at) - Date.parse(a.at) ||
  a.id.localeCompare(b.id);

/**
 * `visible`: the viewer's colonies (visibleColonyIds). Home is island-wide
 * (the route refuses a cat guardian); without it, Where to trap next fails
 * closed rather than ranking colonies for nobody in particular.
 */
export async function homeData(
  now: Date = new Date(),
  deps: Partial<HomeDeps> = {},
  visible?: Visible,
): Promise<HomeData> {
  const d: HomeDeps = { ...DEFAULT_DEPS, ...deps };
  const months = athensMonths(now);
  // Every cat once, shared by the sections that need it. A failure here
  // fails those sections, not the page.
  const catsOnce = d.loadTeamCats(now);
  catsOnce.catch(() => undefined); // read below inside each section's own try

  const [needs, toCheck, trapNext, head, month] = await Promise.all([
    section(async (): Promise<HomeNeeds> => {
      const [queue, issuesOpen, awaitingMatch] = await Promise.all([
        // Home no longer shows unfinished reports (SYC-519): skip reading them.
        d.listWelfareQueue({ drafts: false }),
        d.countOpenIssues(),
        d.countAwaitingMatch(),
      ]);
      const lines = queue.open.filter(isLine).sort(lineOrder);
      return {
        lines: lines.slice(0, HOME_LINES_LIMIT),
        linesTotal: lines.length,
        otherOpen: queue.open.length - lines.length,
        unchecked: queue.unchecked.reportsTotal,
        issuesOpen,
        awaitingMatch,
      };
    }),
    section(async (): Promise<HomeToCheck> => {
      const [likely, colour] = await Promise.all([d.listLikelyForReview(now), d.listColourCheck(now)]);
      return { earClips: likely.length, colour: colour.filter((c) => c.group === "check").length };
    }),
    section(async (): Promise<TrapNext> => {
      if (!visible) throw new Error("Where to trap next needs the viewer's colonies");
      const cats = await catsOnce;
      const [figures, colonies, priceEur] = await Promise.all([
        d.colonyFigures(visible, { island: true, cats }, now),
        d.allColonyChoices(visible),
        d.standardPriceNow(),
      ]);
      return {
        colonies: rankTrapNext(figures, new Map(colonies.map((c) => [c.id, c.name]))),
        colonyCount: colonies.length,
        noColony: toDo(cats.filter((c) => c.colonyId === null)).length,
        priceEur,
      };
    }),
    section(async () => headline(await catsOnce, now)),
    section(async () => {
      const cats = await catsOnce;
      const [nowFigures, lastFigures] = await Promise.all([
        d.monthFigures(months.now.from, months.now.to, cats),
        d.monthFigures(months.last.from, months.last.to, cats),
      ]);
      return { now: nowFigures, last: lastFigures };
    }),
  ]);

  return { needs, toCheck, trapNext, headline: head, month, at: now };
}
