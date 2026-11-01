import { describe, expect, it } from "vitest";
import { launchRange, launchTables, renderLaunchPage } from "./launchPage";
import { csvOf } from "./reportPages";
import { FEW, type LaunchMeasures, type LaunchWeek } from "../reports/launchMeasures";
import { athensMidnight } from "../reports/range";

// SYC-795 Task 5: the Launch measures page, drawn from fixed figures, so no
// database is involved. Dates are fixed; nothing reads the clock.

const NOW = new Date("2026-11-20T10:00:00Z");
const monday = (day: number) => athensMidnight(2026, 11, day); // November 2026 Mondays: 2, 9, 16

const groups = (o: Partial<LaunchWeek["groups"]> = {}): LaunchWeek["groups"] => ({
  not_finished: 0, no_cat: 0, suggested: 0, hand_pick: 0, new_cat: 0, other: 0, ...o,
});
const accuracy = (o: Partial<LaunchWeek["accuracy"]> = {}): LaunchWeek["accuracy"] => ({
  right_first: 0, right_lower: 0, corrected: 0, missed_compared: 0, missed_far: 0, missed_nothing: 0, ...o,
});

const week = (at: Date, label: LaunchWeek["label"], o: Partial<LaunchWeek> = {}): LaunchWeek => ({
  at,
  label,
  stillOpen: { notFinished: false, followUp: false },
  sightings: 50,
  spotters: 12,
  returning: 5,
  groups: groups({ not_finished: 5, no_cat: 3, suggested: 31, hand_pick: 6, new_cat: 4, other: 1 }),
  matcherDownInHandOrNew: 2,
  accuracy: accuracy({ right_first: 20, right_lower: 6, corrected: 5, missed_compared: 3, missed_far: 2, missed_nothing: 2 }),
  checked: { right: 44, total: 50 },
  corrected: 5,
  suggestionsTaken: 31,
  wait: { phoneP50: 4200, phoneP90: 11_500, serverP50: 2100, matcherDown: 3, noPhoneWait: 4, overTen: 1 },
  followUp: { eligible: 40, cameBack: 10 },
  ...o,
});

const baseline = week(monday(2), "baseline");
const report = (o: Partial<LaunchMeasures> = {}): LaunchMeasures => ({
  weeks: [
    week(athensMidnight(2026, 10, 26), "launch_days", { sightings: 8, spotters: 3 }),
    baseline,
    week(monday(9), "after", { sightings: 62, spotters: 15 }),
    week(monday(16), "after", { sightings: 19, spotters: 4, stillOpen: { notFinished: true, followUp: true } }),
  ],
  baseline,
  sightings: 139,
  spotters: 30,
  withoutSpotter: 2,
  launchDate: "2026-10-28",
  phoneWaitFrom: monday(2),
  workedOutAt: NOW,
  ms: 5,
  ...o,
});

const o = (extra: Record<string, unknown> = {}) => ({
  personName: "Test",
  range: launchRange({}, NOW, "2026-10-28"),
  canExport: true,
  now: NOW,
  ...extra,
});

describe("the Launch measures page", () => {
  it("says the launch date isn't set, and shows the last 3 months, when there is none", () => {
    const html = renderLaunchPage(
      report({ launchDate: null, baseline: null, weeks: [week(monday(9), "before_launch")] }),
      o({ range: launchRange({}, NOW, null) }),
    );
    expect(html).toContain("Launch date not set yet. Showing the last 3 months.");
    expect(html).not.toContain("Baseline (first full week after launch)");
  });

  it("says when launch is still to come", () => {
    const html = renderLaunchPage(report({ launchDate: "2026-12-01", baseline: null }), o({ range: launchRange({}, NOW, "2026-12-01") }));
    expect(html).toContain("Launch is on 1 Dec 2026.");
  });

  it("opens on Since launch, with its own link on the range bar", () => {
    const html = renderLaunchPage(report(), o());
    expect(html).toContain("Since launch");
    expect(html).toContain('href="/api/team/insights/launch?range=since"');
    expect(html).toContain('aria-current="true">Since launch');
  });

  it("marks the baseline week and the Before launch and Launch days weeks", () => {
    const html = renderLaunchPage(report({ weeks: [week(monday(2), "baseline"), week(athensMidnight(2026, 10, 19), "before_launch"), week(athensMidnight(2026, 10, 26), "launch_days")] }), o());
    expect(html).toContain("Baseline (first full week after launch)");
    expect(html).toContain("Before launch (testing)");
    expect(html).toContain("Launch days");
  });

  it("writes a share as 62% · 31 of 50", () => {
    const t = launchTables(report({ weeks: [week(monday(2), "baseline", { sightings: 50, groups: groups({ suggested: 31, hand_pick: 19 }) })] }), false);
    expect(t.matched.rows[0]!["suggested"]).toBe("62% · 31 of 50");
  });

  it("greys a week of fewer than 20 sightings: the count, no percentage, Too few to compare", () => {
    expect(FEW).toBe(20);
    const t = launchTables(report({ weeks: [week(monday(9), "after", { sightings: 19, groups: groups({ suggested: 10, hand_pick: 9 }) })] }), false);
    expect(t.matched.rows[0]!["suggested"]).toBe("10 of 19 · Too few to compare");
    expect(t.matched.rows[0]!["suggested"]).not.toContain("%");
  });

  it("labels the current week's Not finished and follow-up as Still open", () => {
    const t = launchTables(report(), false);
    const last = t.matched.rows[3]!;
    expect(last["not_finished"]).toContain("Still open");
    expect(last["not_finished"]).not.toContain("%");
    expect(t.followUp.rows[3]!["share"]).toContain("Still open");
  });

  it("shows differences against the baseline, never against the first week shown", () => {
    const t = launchTables(report(), false);
    // Baseline is 50 sightings; the first row (8) is not it.
    expect(t.weeks.rows[2]!["vs_sightings"]).toBe("+12 on baseline");
    expect(t.weeks.rows[3]!["vs_sightings"]).toBe("−31 on baseline");
    expect(JSON.stringify(t.weeks.rows[1])).not.toContain("on baseline");
    const none = launchTables(report({ baseline: null }), false);
    expect(JSON.stringify(none.weeks.rows)).not.toContain("on baseline");
  });

  it("shows share differences in points", () => {
    const t = launchTables(
      report({ weeks: [baseline, week(monday(9), "after", { sightings: 50, groups: groups({ suggested: 20, hand_pick: 5, no_cat: 1, new_cat: 4, other: 20 }) })] }),
      false,
    );
    expect(t.matched.rows[1]!["vs_matched"]).toMatch(/^[+−]\d+ points on baseline$/);
  });

  it("gives Not enough checked yet below 20 checked", () => {
    const html = renderLaunchPage(report({ weeks: [week(monday(2), "baseline", { checked: { right: 10, total: 19 } })], baseline: week(monday(2), "baseline", { checked: { right: 10, total: 19 } }) }), o());
    expect(html).toContain("Not enough checked yet");
  });

  it("shows the checked figure once there are enough", () => {
    const t = launchTables(report(), false);
    expect(t.accuracy.rows[1]!["checked"]).toBe("88% · 44 of 50");
  });

  it("says the phone wait isn't recorded yet when it never has been, and from when otherwise", () => {
    const none = renderLaunchPage(report({ phoneWaitFrom: null }), o());
    expect(none).toContain("Phone wait not recorded yet");
    const from = renderLaunchPage(report(), o());
    expect(from).toContain("Phone wait recorded from 2 Nov 2026");
  });

  it("shows weeks before the phone wait as not recorded yet, never zero", () => {
    const t = launchTables(report({ phoneWaitFrom: monday(9), weeks: [week(monday(2), "baseline", { wait: { phoneP50: null, phoneP90: null, serverP50: 2000, matcherDown: 0, noPhoneWait: 20, overTen: 0 } })] }), false);
    expect(t.wait.rows[0]!["phone_p50"]).toBe("not recorded yet");
    expect(t.wait.rows[0]!["server_p50"]).toBe("2.0");
  });

  it("shows waits in seconds to one decimal, and the no-phone-wait count with the over-10-minute ones", () => {
    const t = launchTables(report(), false);
    expect(t.wait.rows[1]!["phone_p50"]).toBe("4.2");
    expect(t.wait.rows[1]!["phone_p90"]).toBe("11.5");
    expect(t.wait.rows[1]!["no_phone_wait"]).toBe(5);
    expect(t.wait.rows[1]!["matcher_down"]).toBe("6% · 3 of 50");
  });

  it("says what the no-phone-wait count covers, and the launch-days method note", () => {
    const html = renderLaunchPage(report(), o());
    expect(html).toContain("saved for later, sent before the update, or over 10 minutes");
    expect(html).toContain("The Launch days row counts from launch day, so it can be lower than Coverage&#39;s figure for that week.");
  });

  it("carries the page's fixed copy", () => {
    const html = renderLaunchPage(report(), o());
    for (const s of [
      "Counted by the day each cat was spotted. Sightings sent late are added to the week they were spotted, so recent weeks can still grow.",
      "Figures change as records are corrected",
      "A spotter here is a phone or browser. One person on two devices counts twice.",
      "November is the quiet season on Syros. A drop may be the season, not the app.",
      "The headline counts a suggestion nobody checked as right. The checked figure is the one to trust once it has enough behind it.",
      "The follow card isn&#39;t switched on yet. This is the &#39;before&#39; figure it will be compared against.",
      "SYC-624",
      "SYC-524",
      "Matcher down or timed out",
    ]) expect(html, s).toContain(s);
  });

  it("offers downloads only with export permission", () => {
    expect(renderLaunchPage(report(), o())).toContain("/api/team/insights/launch-use.csv?range=since");
    const html = renderLaunchPage(report(), o({ canExport: false }));
    expect(html).not.toContain(".csv");
  });

  it("leaves no device id anywhere", () => {
    const dirty = report({ weeks: [{ ...baseline, deviceId: "dev-abc-123" } as unknown as LaunchWeek] });
    (dirty as unknown as Record<string, unknown>)["deviceIds"] = ["dev-abc-123"];
    expect(renderLaunchPage(dirty, o())).not.toContain("dev-abc-123");
  });

  it("draws no script", () => {
    expect(renderLaunchPage(report(), o())).not.toContain("<script");
  });

  it("matches its snapshot", () => {
    expect(renderLaunchPage(report(), o())).toMatchSnapshot();
  });
});

describe("the spreadsheet tables", () => {
  const t = launchTables(report(), true);
  it("each has a baseline column and YYYY-MM-DD dates", () => {
    for (const spec of [t.weeks, t.matched, t.accuracy, t.wait, t.followUp]) {
      const csv = csvOf(spec);
      expect(csv.split("\n")[0]).toContain("Baseline");
      expect(csv).toMatch(/\n2026-11-02,/);
      expect(csv).not.toContain("Nov 2026");
    }
    expect(t.weeks.rows.map((r) => r["baseline"])).toEqual(["", "yes", "", ""]);
  });
  it("keeps the six accuracy counts apart from the team-corrected share", () => {
    expect(t.accuracy.rows[1]!["corrected"]).toBe(5);
    expect(t.accuracy.rows[1]!["team_corrected"]).toBe(16);
  });
  it("keeps numbers as numbers", () => {
    expect(t.wait.rows[1]!["phone_p50"]).toBe(4.2);
    expect(t.matched.rows[1]!["suggested"]).toBe(31);
  });
  it("matches its snapshot", () => {
    expect(Object.values(t).map((s) => csvOf(s)).join("\n---\n")).toMatchSnapshot();
  });
});

describe("launchRange", () => {
  it("opens on Since launch from Syros midnight of launch day", () => {
    const r = launchRange({}, NOW, "2026-10-28");
    expect(r.sinceLaunch).toBe(true);
    expect(r.label).toBe("Since launch");
    expect(r.from).toEqual(athensMidnight(2026, 10, 28));
    expect(r.to).toEqual(NOW);
  });
  it("range=since is the same", () => {
    expect(launchRange({ range: "since" }, NOW, "2026-10-28").sinceLaunch).toBe(true);
  });
  it("another range works as everywhere else", () => {
    const r = launchRange({ range: "all" }, NOW, "2026-10-28");
    expect(r.sinceLaunch).toBe(false);
    expect(r.key).toBe("all");
  });
  it("no date, or a future one, is the last 3 months", () => {
    expect(launchRange({}, NOW, null)).toMatchObject({ sinceLaunch: false, key: "3months" });
    expect(launchRange({}, NOW, "2026-12-01")).toMatchObject({ sinceLaunch: false, key: "3months" });
    expect(launchRange({ range: "since" }, NOW, null)).toMatchObject({ sinceLaunch: false, key: "3months" });
  });
});
