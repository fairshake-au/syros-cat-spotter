import { wholePct } from "../dashboard/colonyFigures";
import { MARK_COLOUR } from "./marks";
import { barChart, lineChart, tableFor, type BarPart, type LineSeries, type TableColumn, type TableSpec } from "../reports/charts";
import {
  FEW,
  type AccuracyRow,
  type LaunchMeasures,
  type LaunchWeek,
  type MatchGroup,
  type WeekLabel,
} from "../reports/launchMeasures";
import { athensMidnight, dayWords, parseRange, rangeQuery, type Range } from "../reports/range";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { INSIGHTS, NO_SPOTTER, back, isoDay, methodNote, nothing, plural, rangeBar } from "./reportPages";

// The Launch measures report (SYC-795; launch measures spec §2–§5). Server
// drawn, no scripts, like the other reports. The counting is in
// reports/launchMeasures.ts; this only lays it out.
//
// - Every percentage has its count beside it ("62% · 31 of 50"). Under FEW
//   (20) behind a percentage, the count stays and the percentage goes:
//   "Too few to compare" (§2).
// - Differences read "+12 on baseline" and "−3 points on baseline", always
//   against the baseline week the report carries (never the first week
//   shown), and with no colour: without targets a rise isn't automatically
//   good (§2).
// - Spotters are counts. Nothing here can name a device: LaunchMeasures
//   holds none.
// - The page's own range, "Since launch" (Ruling in the plan): this report's
//   default and one extra link on its range bar. RangeKey and parseRange, and
//   the other reports' bars, are untouched.

const PATH = `${INSIGHTS}/launch`;

// ─── The range ──────────────────────────────────────────────────────────

export type LaunchRange = Range & { sinceLaunch: boolean };

/** Launch day's Syros midnight, or null for no date or one that isn't a real YYYY-MM-DD. */
function launchStart(launchDate: string | null): Date | null {
  const m = launchDate === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(launchDate);
  return m ? athensMidnight(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/**
 * The range a request asks for. With no `range`, or `range=since`, and a launch
 * that has happened: from Syros midnight of launch day to now, "Since launch".
 * Otherwise the usual rules (parseRange), so no date or a future one is the
 * last 3 months.
 */
export function launchRange(q: unknown, now: Date, launchDate: string | null): LaunchRange {
  const key = q !== null && typeof q === "object" ? (q as Record<string, unknown>)["range"] : undefined;
  const launch = launchStart(launchDate);
  if ((key === undefined || key === "since") && launch !== null && launch.getTime() <= now.getTime()) {
    return {
      key: "custom",
      from: launch,
      to: now,
      label: "Since launch",
      dates: { from: isoDay(launch), to: isoDay(now) },
      sinceLaunch: true,
    };
  }
  return { ...parseRange(key === "since" ? {} : q, now), sinceLaunch: false };
}

/** The address query that keeps the range: `range=since` for Since launch, else the shared one. */
export const launchRangeQuery = (r: LaunchRange): string => (r.sinceLaunch ? "range=since" : rangeQuery(r));

// ─── The words ──────────────────────────────────────────────────────────

const PERIOD: Record<WeekLabel, string> = {
  before_launch: "Before launch (testing)",
  launch_days: "Launch days",
  baseline: "Baseline (first full week after launch)",
  after: "After launch",
};

const GROUP_WORD: Record<MatchGroup, string> = {
  not_finished: "Not finished",
  no_cat: "No cat in the photo",
  suggested: "Matched to a suggested cat",
  hand_pick: "Matched to a cat they found themselves",
  new_cat: "A new cat",
  other: "Other or not recorded",
};
const GROUPS: readonly MatchGroup[] = ["not_finished", "no_cat", "suggested", "hand_pick", "new_cat", "other"];

const ACCURACY_WORD: Record<AccuracyRow, string> = {
  right_first: "Right first time",
  right_lower: "Right, lower down",
  corrected: "Suggested, then corrected",
  missed_compared: "Missed, though compared",
  missed_far: "Missed, too far away",
  missed_nothing: "Missed, nothing to compare",
};
const ACCURACY: readonly AccuracyRow[] = ["right_first", "right_lower", "corrected", "missed_compared", "missed_far", "missed_nothing"];

const TOO_FEW = "Too few to compare";
const STILL_OPEN = "Still open";
const NOT_ENOUGH = "Not enough checked yet";
const NOT_RECORDED = "not recorded yet";
/** §2: every section repeats the dashboard's promise. */
const PROMISE = '<p class="hint">Spotters are counted, never named or ranked.</p>';

// ─── Small figures ──────────────────────────────────────────────────────

/** A share of `whole`, as a whole per cent, or null for none. */
const pctOf = (part: number, whole: number): number | null => (whole === 0 ? null : wholePct(part, whole));

/** "62% · 31 of 50"; under FEW the count alone with the reason; "–" for none. */
function share(part: number, whole: number, open = false): string {
  if (open) return `${STILL_OPEN} · ${part} of ${whole}`;
  if (whole === 0) return "–";
  return whole < FEW ? `${part} of ${whole} · ${TOO_FEW}` : `${wholePct(part, whole)}% · ${part} of ${whole}`;
}

/** The share as a number for a spreadsheet: blank when too few, still open or none. */
const csvShare = (part: number, whole: number, open = false): number | "" => (open || whole < FEW ? "" : (pctOf(part, whole) ?? ""));

/** A count or share is only comparable with enough behind it. */
const comparable = (whole: number, open = false): boolean => !open && whole >= FEW;

const signedNumber = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

/** Only the baseline and the weeks after it are set against the baseline (§2): Launch days and testing weeks aren't. */
const setAgainstBaseline = (w: LaunchWeek): boolean => w.label === "baseline" || w.label === "after";

/** "+12 on baseline"; "Baseline" on the baseline week itself; "" with no baseline, or for Launch days and testing weeks. */
function countDiff(w: LaunchWeek, b: LaunchWeek | null, pick: (x: LaunchWeek) => number): string {
  if (b === null || !setAgainstBaseline(w)) return "";
  if (w.label === "baseline") return "Baseline";
  const d = pick(w) - pick(b);
  return d === 0 ? "Same as baseline" : `${signedNumber(d)} on baseline`;
}

/** "−3 points on baseline", when both shares have enough behind them; "" for Launch days and testing weeks. */
function pointsDiff(mine: { pct: number | null; ok: boolean }, base: { pct: number | null; ok: boolean } | null, w: LaunchWeek): string {
  if (base === null || !setAgainstBaseline(w)) return "";
  if (w.label === "baseline") return "Baseline";
  if (!mine.ok || !base.ok || mine.pct === null || base.pct === null) return "";
  const d = mine.pct - base.pct;
  return d === 0 ? "Same as baseline" : `${signedNumber(d)} ${Math.abs(d) === 1 ? "point" : "points"} on baseline`;
}

// Whole tenths of a second, with no toFixed (positions.source.test.ts keeps that for positions).
const tenths = (ms: number): number => Math.round(ms / 100);
const seconds = (ms: number): number => tenths(ms) / 10;
const secondsText = (ms: number): string => `${Math.floor(tenths(ms) / 10)}.${tenths(ms) % 10}`;

// ─── The figures behind each measure ────────────────────────────────────

/** Matched to a known cat: suggested plus hand pick, of groups 2 to 6 (everything but Not finished). */
const matchedParts = (w: LaunchWeek) => ({
  part: w.groups.suggested + w.groups.hand_pick,
  whole: GROUPS.filter((g) => g !== "not_finished").reduce((n, g) => n + w.groups[g], 0),
});

const accuracyParts = (w: LaunchWeek) => ({
  part: w.accuracy.right_first,
  whole: ACCURACY.reduce((n, a) => n + w.accuracy[a], 0),
});

const followShare = (w: LaunchWeek) => ({ part: w.followUp.cameBack, whole: w.followUp.eligible });

/** A comparison point for a share. */
const point = (p: { part: number; whole: number }, open = false) => ({ pct: pctOf(p.part, p.whole), ok: comparable(p.whole, open) });

// ─── The tables ─────────────────────────────────────────────────────────

const col = (key: string, label: string, numeric = false): TableColumn => (numeric ? { key, label, numeric: true } : { key, label });

/** Not recorded yet / none: what a week's blank phone wait means. */
function phoneCell(ms: number | null, w: LaunchWeek, r: LaunchMeasures, forCsv: boolean): string | number {
  if (ms !== null) return forCsv ? seconds(ms) : secondsText(ms);
  if (forCsv) return "";
  return r.phoneWaitFrom === null || w.at.getTime() < r.phoneWaitFrom.getTime() ? NOT_RECORDED : "–";
}

/**
 * The five tables. `forCsv`: numbers stay numbers, dates are YYYY-MM-DD, there
 * is a Baseline column (yes or empty), and no difference columns.
 *
 * When the baseline week isn't in the range, its own figures still lead every
 * table (and spreadsheet, flagged baseline=yes), so the differences can be read
 * against them. The charts show only the range's weeks.
 */
export function launchTables(
  r: LaunchMeasures,
  forCsv = false,
): { weeks: TableSpec; matched: TableSpec; accuracy: TableSpec; wait: TableSpec; followUp: TableSpec } {
  const b = r.baseline;
  const head = (): TableColumn[] => [
    col("week", "Week starting"),
    col("period", "Part of launch"),
    ...(forCsv ? [col("baseline", "Baseline")] : []),
  ];
  const lead = (w: LaunchWeek): Record<string, string> => ({
    week: forCsv ? isoDay(w.at) : dayWords(w.at),
    period: PERIOD[w.label],
    ...(forCsv ? { baseline: w.label === "baseline" ? "yes" : "" } : {}),
  });
  const diffCols = (cols: TableColumn[]): TableColumn[] => (forCsv ? [] : cols);
  const shown: LaunchWeek[] = b !== null && !r.weeks.some((w) => w.label === "baseline") ? [b, ...r.weeks] : r.weeks;

  const weeks: TableSpec = {
    caption: "Sightings and spotters per week",
    columns: [
      ...head(),
      col("sightings", "Sightings", true),
      col("spotters", "Spotters", true),
      col("returning", "Returning spotters", true),
      ...diffCols([col("vs_sightings", "Sightings against baseline"), col("vs_spotters", "Spotters against baseline")]),
    ],
    rows: shown.map((w) => ({
      ...lead(w),
      sightings: w.sightings,
      spotters: w.spotters,
      returning: w.returning,
      ...(forCsv ? {} : { vs_sightings: countDiff(w, b, (x) => x.sightings), vs_spotters: countDiff(w, b, (x) => x.spotters) }),
    })),
  };

  const matched: TableSpec = {
    caption: "Share matched, by week",
    columns: [
      ...head(),
      col("sightings", "Sightings", true),
      ...GROUPS.map((g) => col(g, GROUP_WORD[g], true)),
      col("matched", "Matched to a known cat", true),
      ...diffCols([col("vs_matched", "Matched against baseline")]),
      col("matcher_down", "Of which the matcher was down", true),
      ...(forCsv ? [col("still_open", "Not finished still open")] : []),
    ],
    rows: shown.map((w) => {
      const m = matchedParts(w);
      return {
        ...lead(w),
        sightings: w.sightings,
        ...Object.fromEntries(
          GROUPS.map((g) => {
            const open = g === "not_finished" && w.stillOpen.notFinished;
            return [g, forCsv ? w.groups[g] : share(w.groups[g], w.sightings, open)];
          }),
        ),
        matched: forCsv ? csvShare(m.part, m.whole) : share(m.part, m.whole),
        ...(forCsv
          ? { still_open: w.stillOpen.notFinished ? "yes" : "" }
          : { vs_matched: pointsDiff(point(m), b ? point(matchedParts(b)) : null, w) }),
        matcher_down: w.matcherDownInHandOrNew,
      };
    }),
  };

  const accuracy: TableSpec = {
    caption: "Matching accuracy, by week",
    columns: [
      ...head(),
      ...ACCURACY.map((a) => col(a, ACCURACY_WORD[a], true)),
      col("right_share", "Right first time (share of all six)", true),
      ...diffCols([col("vs_right", "Right first time against baseline")]),
      col("checked", "Checked: share right", true),
      col("team_corrected", "Corrected by the team (share of suggestions taken)", true),
    ],
    rows: shown.map((w) => {
      const a = accuracyParts(w);
      const checkedWhole = w.checked.total;
      return {
        ...lead(w),
        ...Object.fromEntries(ACCURACY.map((k) => [k, w.accuracy[k]])),
        right_share: forCsv ? csvShare(a.part, a.whole) : share(a.part, a.whole),
        ...(forCsv ? {} : { vs_right: pointsDiff(point(a), b ? point(accuracyParts(b)) : null, w) }),
        checked: forCsv
          ? csvShare(w.checked.right, checkedWhole)
          : checkedWhole < FEW
            ? NOT_ENOUGH
            : share(w.checked.right, checkedWhole),
        team_corrected: forCsv ? csvShare(w.corrected, w.suggestionsTaken) : share(w.corrected, w.suggestionsTaken),
      };
    }),
  };

  const wait: TableSpec = {
    caption: "Match wait, by week (seconds)",
    columns: [
      ...head(),
      col("phone_p50", "Wait on the phone, typical", true),
      col("phone_p90", "Wait on the phone, slow end", true),
      col("server_p50", "Server's part, typical", true),
      col("matcher_down", "Matcher down or timed out", true),
      col("no_phone_wait", "Sightings with no phone wait", true),
    ],
    rows: shown.map((w) => ({
      ...lead(w),
      phone_p50: phoneCell(w.wait.phoneP50, w, r, forCsv),
      phone_p90: phoneCell(w.wait.phoneP90, w, r, forCsv),
      server_p50: w.wait.serverP50 === null ? (forCsv ? "" : "–") : forCsv ? seconds(w.wait.serverP50) : secondsText(w.wait.serverP50),
      matcher_down: forCsv ? w.wait.matcherDown : share(w.wait.matcherDown, w.sightings),
      // Ruling 7: sightings saved for later, sent before the update, or over 10 minutes.
      no_phone_wait: w.wait.noPhoneWait + w.wait.overTen,
    })),
  };

  const followUp: TableSpec = {
    caption: "Sent another sighting within 7 days, by week",
    columns: [
      ...head(),
      col("eligible", "Finished sightings", true),
      col("came_back", "Spotter sent another within 7 days", true),
      col("share", "Share", true),
      ...diffCols([col("vs_follow", "Against baseline")]),
      ...(forCsv ? [col("still_open", "Still open")] : []),
    ],
    rows: shown.map((w) => {
      const f = followShare(w);
      return {
        ...lead(w),
        eligible: f.whole,
        came_back: f.part,
        share: forCsv ? csvShare(f.part, f.whole, w.stillOpen.followUp) : share(f.part, f.whole, w.stillOpen.followUp),
        ...(forCsv
          ? { still_open: w.stillOpen.followUp ? "yes" : "" }
          : { vs_follow: pointsDiff(point(f, w.stillOpen.followUp), b ? point(followShare(b), b.stillOpen.followUp) : null, w) }),
      };
    }),
  };

  return { weeks, matched, accuracy, wait, followUp };
}

// ─── The page ───────────────────────────────────────────────────────────

/** A headline share: the percentage greyed under FEW, the count always beside it. */
function headShare(part: number, whole: number, open = false): string {
  if (open) return `${esc(STILL_OPEN)} · ${part} of ${whole}`;
  if (whole === 0) return "–";
  if (whole < FEW) return `<span class="muted">${wholePct(part, whole)}%</span> · ${part} of ${whole} · ${esc(TOO_FEW)}`;
  return `${wholePct(part, whole)}% · ${part} of ${whole}`;
}

/**
 * One headline line. A real figure is drawn big; words in its place ("Still
 * open", "Not enough checked yet", "Too few to compare", "–") are plain text,
 * which wraps sensibly on a phone.
 */
function headline(label: string, shown: string, isFigure: boolean): string {
  return isFigure ? `<p class="hbig">${esc(label)}: <strong>${shown}</strong></p>` : `<p>${esc(label)}: ${shown}</p>`;
}
const isFigure = (whole: number, open = false) => !open && whole >= FEW;

const sum = (ws: readonly LaunchWeek[], f: (w: LaunchWeek) => number) => ws.reduce((n, w) => n + f(w), 0);

/** The line (neutral for a total, a mark colour for another) for a chart of one count per week. */
function weekly(ws: readonly LaunchWeek[], f: (w: LaunchWeek) => number | null): { at: Date; value: number }[] {
  return ws.flatMap((w) => {
    const v = f(w);
    return v === null ? [] : [{ at: w.at, value: v }];
  });
}

const GROUP_PART: Record<MatchGroup, Pick<BarPart, "colour" | "pattern">> = {
  not_finished: { colour: "rgba(27,42,56,0.55)", pattern: "solid" },
  no_cat: { colour: "rgba(27,42,56,0.55)", pattern: "dots" },
  suggested: { colour: MARK_COLOUR.sterilised, pattern: "solid" },
  hand_pick: { colour: MARK_COLOUR.probably, pattern: "hatch" },
  new_cat: { colour: MARK_COLOUR.not_known, pattern: "dots" },
  other: { colour: MARK_COLOUR.not_sterilised, pattern: "hatch" },
};

const downloadLink = (key: string, r: LaunchRange, words: string) =>
  `<p><a class="tap" href="${INSIGHTS}/${key}.csv?${launchRangeQuery(r)}" download>${esc(words)}</a></p>`;

export function renderLaunchPage(
  r: LaunchMeasures,
  o: { personName: string; range: LaunchRange; canExport: boolean; now: Date },
): string {
  const t = launchTables(r);
  const launch = launchStart(r.launchDate);
  const future = launch !== null && launch.getTime() > o.now.getTime();
  const lastThree = o.range.key === "3months";
  const notice =
    r.launchDate === null || launch === null
      ? `<p class="hint" id="launch-date">Launch date not set yet.${lastThree ? " Showing the last 3 months." : ""}</p>`
      : future
        ? `<p class="hint" id="launch-date">Launch is on ${esc(dayWords(launch))}.${lastThree ? " Showing the last 3 months." : ""}</p>`
        : "";

  // Headlines: the weeks since the baseline, or every week shown when launch hasn't happened.
  const since = r.weeks.filter((w) => w.label === "baseline" || w.label === "after");
  // Ruling 10: once launched, testing weeks never count; Launch days alone until a baseline week exists.
  const launched = launch !== null && !future;
  const head =
    since.length > 0 ? since
    : launched ? r.weeks.filter((w) => w.label === "launch_days")
    : r.weeks;
  const matched = { part: sum(head, (w) => matchedParts(w).part), whole: sum(head, (w) => matchedParts(w).whole) };
  const acc = { part: sum(head, (w) => accuracyParts(w).part), whole: sum(head, (w) => accuracyParts(w).whole) };
  const checked = { right: sum(head, (w) => w.checked.right), total: sum(head, (w) => w.checked.total) };
  const corrected = { part: sum(head, (w) => w.corrected), whole: sum(head, (w) => w.suggestionsTaken) };
  const closed = head.filter((w) => !w.stillOpen.followUp);
  const followOpen = head.length > 0 && head.every((w) => w.stillOpen.followUp);
  const follow = { part: sum(closed, (w) => followShare(w).part), whole: sum(closed, (w) => followShare(w).whole) };
  const lastWait = [...r.weeks].reverse().find((w) => w.wait.phoneP50 !== null || w.wait.serverP50 !== null);
  const draw = r.sightings > 0;
  // §2: the baseline week is marked on every chart, and so is the part-week of Launch days.
  const markers = r.weeks.flatMap((w) =>
    w.label === "baseline" ? [{ at: w.at, label: "Baseline" }] : w.label === "launch_days" ? [{ at: w.at, label: "Launch" }] : [],
  );

  const use =
    '<section id="use"><h2>Sightings and spotters</h2>' +
    `<p class="hbig"><strong>${r.sightings}</strong> ${r.sightings === 1 ? "sighting" : "sightings"}, from ` +
    `<strong>${r.spotters}</strong> ${r.spotters === 1 ? "spotter" : "spotters"}</p>` +
    PROMISE +
    '<p class="hint">A spotter here is a phone or browser. One person on two devices counts twice.</p>' +
    '<p class="hint">November is the quiet season on Syros. A drop may be the season, not the app.</p>' +
    (draw
      ? '<div class="chartbox">' +
        lineChart({
          title: "Sightings and spotters per week",
          markers,
          series: [
            { label: "Sightings", neutral: true, points: weekly(r.weeks, (w) => w.sightings) },
            { label: "Spotters", mark: "sterilised", points: weekly(r.weeks, (w) => w.spotters) },
          ] satisfies LineSeries[],
        }) +
        "</div>" +
        tableFor(t.weeks) +
        (o.canExport ? downloadLink("launch-use", o.range, "Download sightings and spotters as a spreadsheet (CSV)") : "")
      : "") +
    "</section>";

  const matchedSection =
    '<section id="matched"><h2>Share matched</h2>' +
    PROMISE +
    headline("Matched to a known cat", headShare(matched.part, matched.whole), isFigure(matched.whole)) +
    '<p class="hint">A suggested cat or one the spotter found, as a share of sightings that were finished.</p>' +
    (draw
      ? '<div class="chartbox">' +
        barChart({
          title: "Sightings per week, by what the spotter did",
          markers,
          bars: r.weeks.map((w) => ({
            at: w.at,
            parts: GROUPS.map((g) => ({ key: g, label: GROUP_WORD[g], value: w.groups[g], ...GROUP_PART[g] })),
          })),
        }) +
        "</div>" +
        tableFor(t.matched) +
        (o.canExport ? downloadLink("launch-matched", o.range, "Download the share matched as a spreadsheet (CSV)") : "")
      : "") +
    "</section>";

  const checkedHead =
    checked.total < FEW ? esc(NOT_ENOUGH) : `${wholePct(checked.right, checked.total)}% right · ${checked.right} of ${checked.total}`;
  const accuracySection =
    '<section id="accuracy"><h2>Matching accuracy</h2>' +
    PROMISE +
    headline("Right first time", headShare(acc.part, acc.whole), isFigure(acc.whole)) +
    headline("Checked", checkedHead, checked.total >= FEW) +
    headline("Corrected by the team", headShare(corrected.part, corrected.whole), isFigure(corrected.whole)) +
    `<p class="hint">${esc("The headline counts a suggestion nobody checked as right. The checked figure is the one to trust once it has enough behind it.")}</p>` +
    (draw ? tableFor(t.accuracy) + (o.canExport ? downloadLink("launch-accuracy", o.range, "Download the matching accuracy as a spreadsheet (CSV)") : "") : "") +
    "</section>";

  const phoneNote =
    r.phoneWaitFrom === null ? "Phone wait not recorded yet" : `Phone wait recorded from ${dayWords(r.phoneWaitFrom)}`;
  // A week with no value is left off the line: "not recorded yet" is never drawn as zero.
  const waitPoints = (f: (w: LaunchWeek) => number | null) => weekly(r.weeks, (w) => {
    const ms = f(w);
    return ms === null ? null : seconds(ms);
  });
  const waitSeries: LineSeries[] = [
    { label: "Phone, typical", mark: "sterilised", points: waitPoints((w) => w.wait.phoneP50) },
    { label: "Phone, slow end", mark: "not_sterilised", points: waitPoints((w) => w.wait.phoneP90) },
    { label: "Server, typical", neutral: true, points: waitPoints((w) => w.wait.serverP50) },
  ];
  const noPhone = sum(head, (w) => w.wait.noPhoneWait + w.wait.overTen);
  const down = sum(head, (w) => w.wait.matcherDown);
  const headSightings = sum(head, (w) => w.sightings);
  const waitSection =
    '<section id="wait"><h2>Match wait</h2>' +
    PROMISE +
    (lastWait
      ? `<p class="hbig">Latest week with waits (starting ${esc(dayWords(lastWait.at))}): ` +
        `phone ${lastWait.wait.phoneP50 === null ? esc(NOT_RECORDED) : `<strong>${secondsText(lastWait.wait.phoneP50)} s</strong> typical`}` +
        `${lastWait.wait.phoneP90 === null ? "" : `, ${secondsText(lastWait.wait.phoneP90)} s slow end`}` +
        `${lastWait.wait.serverP50 === null ? "" : `; server's part ${secondsText(lastWait.wait.serverP50)} s typical`}</p>`
      : "<p>No waits recorded in this period</p>") +
    `<p class="hint" id="phone-wait-from">${esc(phoneNote)}</p>` +
    `<p class="hint">Matcher down or timed out: ${esc(share(down, headSightings))}. ` +
    `${esc(plural(noPhone, "sighting", "sightings"))} with a server time but no phone wait: saved for later, sent before the update, or over 10 minutes.</p>` +
    (draw
      ? '<div class="chartbox">' +
        lineChart({ title: "Match wait per week, in seconds", series: waitSeries, markers }) +
        "</div>" +
        tableFor(t.wait) +
        (o.canExport ? downloadLink("launch-wait", o.range, "Download the match wait as a spreadsheet (CSV)") : "")
      : "") +
    "</section>";

  const followSection =
    '<section id="follow"><h2>Follow-card effect</h2>' +
    PROMISE +
    headline(
      "Sent another sighting within 7 days",
      followOpen ? esc(STILL_OPEN) : headShare(follow.part, follow.whole),
      !followOpen && isFigure(follow.whole),
    ) +
    `<p class="hint">${esc("The follow card isn't switched on yet. This is the 'before' figure it will be compared against.")}</p>` +
    `<p class="hint">${esc("A spotter's phone already follows a cat it matches, with no email (SYC-624).")}</p>` +
    `<p class="hint">${esc("Onboarding already offers \u201Ckeep my spots safe\u201D by email (SYC-524). What is measured is the effect of the reward-screen card on top of those.")}</p>` +
    (draw ? tableFor(t.followUp) + (o.canExport ? downloadLink("launch-follow", o.range, "Download the follow-up figures as a spreadsheet (CSV)") : "") : "") +
    "</section>";

  const lines = [
    "Counted by the day each cat was spotted. Sightings sent late are added to the week they were spotted, so recent weeks can still grow",
    NO_SPOTTER,
    "The Launch days row counts from launch day, so it can be lower than Coverage's figure for that week",
    "Weeks are Athens weeks. The baseline is the first full week (Monday to Sunday) that starts on or after the launch date; every later week is set against it, with no colour, because without targets a rise isn't automatically good",
    "A week with fewer than 20 sightings behind a percentage shows the count and greys the percentage",
    "Not finished is only fair 48 hours after a week ends, so the current week is Still open. That 48 hours is this report's rule, not something the app records",
    "Other or not recorded should be near zero. If it isn't, that is a fault worth a ticket",
    "Testers can't be marked, so any tester still active after launch is counted",
    "Matcher down or timed out is a share of sightings; a timeout is about 35 seconds and is left out of the typical wait",
    "Sightings with no phone wait are those saved for later, sent before the update, or over 10 minutes",
    "The headline counts a suggestion nobody checked as right. The checked figure is the one to trust once it has enough behind it",
    "The follow card isn't switched on yet. This is the 'before' figure it will be compared against",
  ];

  const body =
    rangeBar(PATH, o.range, "", {}, { key: "since", label: "Since launch", active: o.range.sinceLaunch }) +
    notice +
    (r.sightings === 0 ? nothing(PATH) : "") +
    use +
    matchedSection +
    accuracySection +
    waitSection +
    followSection +
    methodNote(o.range, r.workedOutAt, null, lines);
  return renderPage({ title: "Launch measures", active: "reports", personName: o.personName, beforeTitle: back, body, mainClass: "wide" });
}
