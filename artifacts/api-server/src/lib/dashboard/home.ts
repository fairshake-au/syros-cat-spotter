import { db, observationsTable, sightingsTable, welfareReportsTable } from "@workspace/db";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { listWelfareQueue, type QueueDraft, type QueueReport } from "../welfareQueue";
import { listLikelyForReview } from "../likelyReview";
import { listColourCheck } from "../colourCheck";
import { loadTeamCats, type TeamCat } from "../teamCatList";
import { areaFor, OFF_SYROS } from "../areas/namedAreas";
import { athensMonths } from "../athensTime";
import { allColonyChoices } from "../colonyCats";
import type { Visible } from "../guardianView";
import { headline, notSeenLately, type Headline } from "./countedCats";
import { standingRows } from "../resolve";
import type { VetVisitValue } from "../observations";

// The figures behind Home (SYC-396 spec §4; plan PR 2.1, Task 2.1.1).
// Worked out from the records on every request (§9.6). Each section is read
// on its own: one that fails comes back as `{ ok: false }` and the page says
// "This figure isn't available right now", while every other section still
// draws (§13). Home never holds response times, rankings or anything per
// person (D6): nothing here reads who did what.

export const HOME_NEEDS_LIMIT = 5; // rows shown per Needs-us section
export const HOME_PHOTOS = 4; // first photos per Cats-to-check list
export const DRAFT_WINDOW_HOURS = 24;
export const HOME_NOT_SEEN = 6; // Not-seen-lately cards shown

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
  /** Open reports, urgent first and then newest (the queue's own order), at most HOME_NEEDS_LIMIT. */
  reports: QueueReport[];
  /** Every open, checked report, so "See all N in the Queue" is honest. */
  reportsTotal: number;
  /** Reports accepted while the bot check was down: never missed (§4, plan review finding 1). */
  unchecked: number;
  /** "Started but not sent" in the last DRAFT_WINDOW_HOURS, newest first, at most HOME_NEEDS_LIMIT. */
  drafts: QueueDraft[];
  draftsTotal: number;
  /** "Report an issue" reports still open. */
  issuesOpen: number;
  /** Sightings held for the team to match ("Ask Syros Cats to match it"). 0 until something writes it. */
  awaitingMatch: number;
}

export interface CheckList {
  count: number;
  /** Up to HOME_PHOTOS small photo addresses, through the team photo route. */
  photos: string[];
}

export interface HomeToCheck {
  earClips: CheckList;
  colour: CheckList;
}

export interface NotSeenLately {
  /** Up to HOME_NOT_SEEN street cats, the most recently seen first: the ones that just went quiet. */
  cats: TeamCat[];
  total: number;
  /** Colony names by id, for the cards' colony line: only the colonies the viewer sees. */
  colonyNames: Record<number, string>;
}

/** A section's figures, or a note that they couldn't be worked out this time. */
export type Section<T> = { ok: true; value: T } | { ok: false };

export interface HomeData {
  needs: Section<HomeNeeds>;
  toCheck: Section<HomeToCheck>;
  notSeenLately: Section<NotSeenLately>;
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
};

async function section<T>(read: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return { ok: false };
  }
}

const small = (url: string) => `${url}/small`;

/**
 * `visible`: the viewer's colonies (visibleColonyIds), used only to name a
 * Not-seen-lately card's colony. Without it no colony is named (fails closed).
 */
export async function homeData(
  now: Date = new Date(),
  deps: Partial<HomeDeps> = {},
  visible?: Visible,
): Promise<HomeData> {
  const d: HomeDeps = { ...DEFAULT_DEPS, ...deps };
  const since = now.getTime() - DRAFT_WINDOW_HOURS * 3_600_000;
  const months = athensMonths(now);
  // Every cat once, shared by the sections that need it. A failure here
  // fails those sections, not the page.
  const catsOnce = d.loadTeamCats(now);
  catsOnce.catch(() => undefined); // read below inside each section's own try

  const [needs, toCheck, quiet, head, month] = await Promise.all([
    section(async (): Promise<HomeNeeds> => {
      const [queue, issuesOpen, awaitingMatch] = await Promise.all([
        d.listWelfareQueue(),
        d.countOpenIssues(),
        d.countAwaitingMatch(),
      ]);
      const recentDrafts = queue.drafts.filter((x) => new Date(x.startedAt).getTime() >= since);
      return {
        reports: queue.open.slice(0, HOME_NEEDS_LIMIT),
        reportsTotal: queue.open.length,
        unchecked: queue.unchecked.reportsTotal,
        drafts: recentDrafts.slice(0, HOME_NEEDS_LIMIT),
        draftsTotal: recentDrafts.length,
        issuesOpen,
        awaitingMatch,
      };
    }),
    section(async (): Promise<HomeToCheck> => {
      const [likely, colour] = await Promise.all([d.listLikelyForReview(now), d.listColourCheck(now)]);
      const toCheck = colour.filter((c) => c.group === "check");
      return {
        earClips: {
          count: likely.length,
          photos: likely
            .map((c) => c.evidence.find((e) => e.photoUrl)?.photoUrl ?? null)
            .filter((u): u is string => u !== null)
            .slice(0, HOME_PHOTOS)
            .map(small),
        },
        colour: {
          count: toCheck.length,
          photos: toCheck
            .map((c) => c.photoUrl)
            .filter((u): u is string => u !== null)
            .slice(0, HOME_PHOTOS)
            .map(small),
        },
      };
    }),
    section(async (): Promise<NotSeenLately> => {
      const [cats, colonies] = await Promise.all([catsOnce, visible ? d.allColonyChoices(visible) : Promise.resolve([])]);
      const all = notSeenLately(cats, now).sort(
        (a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0) || a.id - b.id,
      );
      return {
        cats: all.slice(0, HOME_NOT_SEEN),
        total: all.length,
        colonyNames: Object.fromEntries(colonies.map((c) => [c.id, c.name])),
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

  return { needs, toCheck, notSeenLately: quiet, headline: head, month, at: now };
}
