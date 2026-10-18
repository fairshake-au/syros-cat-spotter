import { db, sightingsTable, welfareReportsTable } from "@workspace/db";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { listWelfareQueue, type QueueDraft, type QueueReport } from "../welfareQueue";
import { listLikelyForReview } from "../likelyReview";
import { listColourCheck } from "../colourCheck";
import { loadTeamCats, type TeamCat } from "../teamCatList";
import { areaFor, OFF_SYROS } from "../areas/namedAreas";
import { athensMonths } from "../athensTime";

// The figures behind Home (SYC-396 spec §4; plan PR 2.1, Task 2.1.1).
// Worked out from the records on every request (§9.6). Each section is read
// on its own: one that fails comes back as `{ ok: false }` and the page says
// "This figure isn't available right now", while every other section still
// draws (§13). Home never holds response times, rankings or anything per
// person (D6): nothing here reads who did what.

export const HOME_NEEDS_LIMIT = 5; // rows shown per Needs-us section
export const HOME_PHOTOS = 4; // first photos per Cats-to-check list
export const DRAFT_WINDOW_HOURS = 24;

export interface MonthFigures {
  sightings: number;
  newCats: number;
  sterilisations: number;
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

/** A section's figures, or a note that they couldn't be worked out this time. */
export type Section<T> = { ok: true; value: T } | { ok: false };

export interface HomeData {
  needs: Section<HomeNeeds>;
  toCheck: Section<HomeToCheck>;
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
}

const DEFAULT_DEPS: HomeDeps = {
  listWelfareQueue,
  countOpenIssues,
  countAwaitingMatch,
  listLikelyForReview,
  listColourCheck,
  loadTeamCats,
  monthFigures,
};

async function section<T>(read: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return { ok: false };
  }
}

const small = (url: string) => `${url}/small`;

export async function homeData(now: Date = new Date(), deps: Partial<HomeDeps> = {}): Promise<HomeData> {
  const d: HomeDeps = { ...DEFAULT_DEPS, ...deps };
  const since = now.getTime() - DRAFT_WINDOW_HOURS * 3_600_000;
  const months = athensMonths(now);
  // Every cat once, shared by the sections that need it. A failure here
  // fails those sections, not the page.
  const catsOnce = d.loadTeamCats(now);
  catsOnce.catch(() => undefined); // read below inside each section's own try

  const [needs, toCheck, month] = await Promise.all([
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
    section(async () => {
      const cats = await catsOnce;
      const [nowFigures, lastFigures] = await Promise.all([
        d.monthFigures(months.now.from, months.now.to, cats),
        d.monthFigures(months.last.from, months.last.to, cats),
      ]);
      return { now: nowFigures, last: lastFigures };
    }),
  ]);

  return { needs, toCheck, month, at: now };
}
