import { describe, expect, it } from "vitest";
import {
  FEW,
  MAX_PHONE_WAIT_MS,
  STILL_OPEN_MS,
  accuracyRow,
  launchMeasuresFrom,
  matchGroup,
  weekLabels,
  type LaunchRow,
  type LaunchWeek,
} from "./launchMeasures";
import { athensMidnight, parseRange, type Range } from "./range";

// SYC-795 Task 4 (launch measures spec §3–§4.5): the pure counting rules.
// Fixed dates only; nothing here reads a clock.

type Match = NonNullable<LaunchRow["match"]>;

const MATCH: Match = {
  choice: "suggested",
  suggestedRank: 1,
  missKind: null,
  comparedCount: 3,
  matcherFailed: false,
  noCatInAnyPhoto: false,
  teamAction: null,
  serverWaitMs: 1000,
  phoneWaitMs: 2000,
};

/** A resolved sighting taken from the first suggestion, unless told otherwise. */
function row(
  at: string,
  o: { deviceId?: string | null; resolved?: boolean; correctedByMove?: boolean; match?: Partial<Match> | null } = {},
): LaunchRow {
  return {
    at: new Date(at),
    deviceId: o.deviceId === undefined ? "dev-a" : o.deviceId,
    resolved: o.resolved ?? true,
    match: o.match === null ? null : { ...MATCH, ...o.match },
    correctedByMove: o.correctedByMove ?? false,
  };
}

const custom = (from: string, to: string, now: Date): Range => parseRange({ range: "custom", from, to }, now);

// Mondays at Syros midnight, November 2026 (UTC+2).
const MON = (d: number) => athensMidnight(2026, 11, d);
const NOVEMBER = [MON(9), MON(16), MON(23), MON(30)];
const LATE = new Date("2027-01-20T10:00:00Z");
// 9 Nov to 6 Dec 2026: four whole weeks.
const RANGE = custom("2026-11-09", "2026-12-06", LATE);

const weekAt = (r: { weeks: LaunchWeek[] }, monday: Date): LaunchWeek => {
  const w = r.weeks.find((x) => x.at.getTime() === monday.getTime());
  if (!w) throw new Error(`no week at ${monday.toISOString()}`);
  return w;
};

describe("constants", () => {
  it("are the spec's", () => {
    expect(FEW).toBe(20);
    expect(STILL_OPEN_MS).toBe(48 * 3_600_000);
    expect(MAX_PHONE_WAIT_MS).toBe(600_000);
  });
});

describe("weekLabels (§3)", () => {
  const labels = (launch: string | null, starts = NOVEMBER) => weekLabels(starts, launch).map((w) => w.label);

  it("a Tuesday launch: its week is Launch days, the next Monday's the baseline", () => {
    expect(labels("2026-11-17")).toEqual(["before_launch", "launch_days", "baseline", "after"]);
  });

  it("a Monday launch: that week is the baseline", () => {
    expect(labels("2026-11-16")).toEqual(["before_launch", "baseline", "after", "after"]);
  });

  it("no launch date: every week is before launch", () => {
    expect(labels(null)).toEqual(["before_launch", "before_launch", "before_launch", "before_launch"]);
  });

  it("a launch after the last week: every week is before launch", () => {
    expect(labels("2027-01-05")).toEqual(["before_launch", "before_launch", "before_launch", "before_launch"]);
  });

  it("the baseline is the first full week after launch, even when the range starts later", () => {
    expect(labels("2026-11-17", [MON(30), athensMidnight(2026, 12, 7)])).toEqual(["after", "after"]);
  });

  it("keeps each week's start", () => {
    expect(weekLabels(NOVEMBER, null).map((w) => w.at)).toEqual(NOVEMBER);
  });

  it("a launch date after now makes every week before launch in the report", () => {
    // Launch Fri 27 Nov; now Wed 25 Nov, inside that week.
    const now = new Date("2026-11-25T10:00:00Z");
    const r = launchMeasuresFrom([], custom("2026-11-09", "2026-11-25", now), "2026-11-27", now);
    expect(r.weeks.map((w) => w.label)).toEqual(["before_launch", "before_launch", "before_launch"]);
    expect(r.launchDate).toBe("2026-11-27");
  });
});

describe("matchGroup (§4.2, first rule wins)", () => {
  it("unresolved, though the app said no cat: Not finished", () => {
    expect(matchGroup(row("2026-11-17T10:00:00Z", { resolved: false, match: { noCatInAnyPhoto: true } }))).toBe("not_finished");
  });

  it("resolved, no cat, then a hand pick: No cat in the photo", () => {
    expect(matchGroup(row("2026-11-17T10:00:00Z", { match: { noCatInAnyPhoto: true, choice: "hand_pick", suggestedRank: null } }))).toBe("no_cat");
  });

  it("resolved with no match record: Other", () => {
    expect(matchGroup(row("2026-11-17T10:00:00Z", { match: null }))).toBe("other");
  });

  it("the three choices, then anything left", () => {
    expect(matchGroup(row("2026-11-17T10:00:00Z"))).toBe("suggested");
    expect(matchGroup(row("2026-11-17T10:00:00Z", { match: { choice: "hand_pick", suggestedRank: null } }))).toBe("hand_pick");
    expect(matchGroup(row("2026-11-17T10:00:00Z", { match: { choice: "new_cat", suggestedRank: null } }))).toBe("new_cat");
    expect(matchGroup(row("2026-11-17T10:00:00Z", { match: { choice: "unlabelled", suggestedRank: null } }))).toBe("other");
    expect(matchGroup(row("2026-11-17T10:00:00Z", { match: { choice: null, suggestedRank: null } }))).toBe("other");
    // Unknown (matcher failed) isn't "no cat".
    expect(matchGroup(row("2026-11-17T10:00:00Z", { match: { noCatInAnyPhoto: null } }))).toBe("suggested");
  });

  it("the six groups add up to the week's sightings, and the matcher-down marks are counted", () => {
    const rows = [
      row("2026-11-17T10:00:00Z", { resolved: false }),
      row("2026-11-17T11:00:00Z", { match: { noCatInAnyPhoto: true } }),
      row("2026-11-17T12:00:00Z"),
      row("2026-11-18T10:00:00Z", { match: { choice: "hand_pick", suggestedRank: null, matcherFailed: true, serverWaitMs: null } }),
      row("2026-11-18T11:00:00Z", { match: { choice: "new_cat", suggestedRank: null, matcherFailed: true, serverWaitMs: null } }),
      row("2026-11-18T12:00:00Z", { match: { choice: "new_cat", suggestedRank: null } }),
      row("2026-11-19T10:00:00Z", { match: null }),
      row("2026-11-19T11:00:00Z", { match: { choice: "unlabelled", suggestedRank: null } }),
    ];
    const w = weekAt(launchMeasuresFrom(rows, RANGE, null, LATE), MON(16));
    expect(w.sightings).toBe(8);
    expect(w.groups).toEqual({ not_finished: 1, no_cat: 1, suggested: 1, hand_pick: 1, new_cat: 2, other: 2 });
    expect(Object.values(w.groups).reduce((a, b) => a + b, 0)).toBe(w.sightings);
    expect(w.matcherDownInHandOrNew).toBe(2);
  });
});

describe("accuracyRow (§4.3)", () => {
  const s = (o: Parameters<typeof row>[1]) => accuracyRow(row("2026-11-17T10:00:00Z", o));

  it("the first suggestion, moved by the team since: corrected, and only that", () => {
    expect(s({ correctedByMove: true })).toBe("corrected");
  });

  it("the first suggestion on a cat since merged (the loader leaves merge moves out): right first time", () => {
    expect(s({ correctedByMove: false })).toBe("right_first");
  });

  it("a lower suggestion", () => {
    expect(s({ match: { suggestedRank: 2 } })).toBe("right_lower");
    expect(s({ match: { suggestedRank: 3 } })).toBe("right_lower");
  });

  it("hand picks by why the matcher missed", () => {
    const hand = { choice: "hand_pick" as const, suggestedRank: null };
    expect(s({ match: { ...hand, missKind: "matcher_miss" } })).toBe("missed_compared");
    expect(s({ match: { ...hand, missKind: "distance_miss", comparedCount: 2 } })).toBe("missed_far");
    expect(s({ match: { ...hand, missKind: "distance_miss", comparedCount: 0 } })).toBe("missed_nothing");
    expect(s({ match: { ...hand, missKind: null, comparedCount: 0 } })).toBe("missed_nothing");
  });

  it("isn't counted when the matcher failed, for a new cat, or with no match record", () => {
    expect(s({ match: { matcherFailed: true } })).toBeNull();
    expect(s({ match: { choice: "hand_pick", suggestedRank: null, matcherFailed: true, missKind: "distance_miss" } })).toBeNull();
    expect(s({ match: { choice: "new_cat", suggestedRank: null } })).toBeNull();
    expect(s({ match: { choice: "unlabelled", suggestedRank: null } })).toBeNull();
    expect(s({ match: null })).toBeNull();
  });

  it("the week's rows, the checked figure and the corrections (Ruling 2)", () => {
    const rows = [
      // Checked as right, then moved: corrected, checked but not right.
      row("2026-11-17T10:00:00Z", { correctedByMove: true, match: { teamAction: "looks_right" } }),
      // Checked as right.
      row("2026-11-17T11:00:00Z", { match: { teamAction: "looks_right" } }),
      // Moved without a check: still checked (a correction is a verdict), not right.
      row("2026-11-17T12:00:00Z", { correctedByMove: true }),
      // Nobody checked.
      row("2026-11-17T13:00:00Z", { match: { suggestedRank: 2 } }),
      // A hand pick checked as right isn't a suggestion.
      row("2026-11-17T14:00:00Z", { match: { choice: "hand_pick", suggestedRank: null, missKind: "matcher_miss", teamAction: "looks_right" } }),
    ];
    const w = weekAt(launchMeasuresFrom(rows, RANGE, null, LATE), MON(16));
    expect(w.accuracy).toEqual({ right_first: 1, right_lower: 1, corrected: 2, missed_compared: 1, missed_far: 0, missed_nothing: 0 });
    expect(w.checked).toEqual({ right: 1, total: 3 });
    expect(w.corrected).toBe(2);
    expect(w.suggestionsTaken).toBe(4);
  });
});

describe("sightings and spotters (§4.1)", () => {
  it("a deleted spotter's sighting counts as a sighting, not a spotter", () => {
    const rows = [
      row("2026-11-17T10:00:00Z", { deviceId: "dev-a" }),
      row("2026-11-18T10:00:00Z", { deviceId: "dev-a" }),
      row("2026-11-18T11:00:00Z", { deviceId: "dev-b" }),
      row("2026-11-18T12:00:00Z", { deviceId: null }),
    ];
    const r = launchMeasuresFrom(rows, RANGE, null, LATE);
    const w = weekAt(r, MON(16));
    expect(w.sightings).toBe(4);
    expect(w.spotters).toBe(2);
    expect(r.sightings).toBe(4);
    expect(r.spotters).toBe(2);
    expect(r.withoutSpotter).toBe(1);
  });

  it("returning spotters count only after launch, from sightings since launch", () => {
    const rows = [
      row("2026-11-10T10:00:00Z", { deviceId: "dev-c" }), // before launch
      row("2026-11-17T10:00:00Z", { deviceId: "dev-a" }),
      row("2026-11-24T10:00:00Z", { deviceId: "dev-a" }),
      row("2026-11-24T11:00:00Z", { deviceId: "dev-c" }),
      row("2026-11-24T12:00:00Z", { deviceId: "dev-b" }),
      row("2026-12-01T10:00:00Z", { deviceId: "dev-b" }),
      row("2026-12-01T11:00:00Z", { deviceId: "dev-a" }),
    ];
    const r = launchMeasuresFrom(rows, RANGE, "2026-11-16", LATE);
    expect(r.weeks.map((w) => w.returning)).toEqual([0, 0, 1, 2]);
    // With no launch date, nobody is returning.
    expect(launchMeasuresFrom(rows, RANGE, null, LATE).weeks.map((w) => w.returning)).toEqual([0, 0, 0, 0]);
  });

  it("the launch week's sightings after launch count as earlier sightings for the baseline", () => {
    const rows = [row("2026-11-19T10:00:00Z", { deviceId: "dev-a" }), row("2026-11-24T10:00:00Z", { deviceId: "dev-a" })];
    const r = launchMeasuresFrom(rows, RANGE, "2026-11-18", LATE);
    expect(weekAt(r, MON(16)).label).toBe("launch_days");
    expect(weekAt(r, MON(16)).returning).toBe(0);
    expect(weekAt(r, MON(23)).returning).toBe(1);
  });

  it("a sighting before the range seeds returning but is never counted", () => {
    // Range 30 Nov – 6 Dec; the loader adds dev-a's sighting from 20 Nov (since launch, before the range).
    const range = custom("2026-11-30", "2026-12-06", LATE);
    const rows = [row("2026-11-20T10:00:00Z", { deviceId: "dev-a" }), row("2026-12-01T10:00:00Z", { deviceId: "dev-a" })];
    const r = launchMeasuresFrom(rows, range, "2026-11-16", LATE);
    expect(r.weeks).toHaveLength(1);
    expect(r.weeks[0]).toMatchObject({ sightings: 1, spotters: 1, returning: 1 });
    expect(r.sightings).toBe(1);
  });

  it("a sighting after the range (fetched for the follow-up) is never counted", () => {
    const range = custom("2026-11-16", "2026-11-22", LATE);
    const rows = [row("2026-11-20T10:00:00Z"), row("2026-11-24T10:00:00Z")];
    const r = launchMeasuresFrom(rows, range, null, LATE);
    expect(r.weeks).toHaveLength(1);
    expect(r.weeks[0]!.sightings).toBe(1);
    expect(r.sightings).toBe(1);
    expect(r.weeks[0]!.followUp).toEqual({ eligible: 1, cameBack: 1 });
  });

  it("a first week starting before the range counts only the range's sightings, as Coverage does", () => {
    // Range starts Wed 18 Nov; the week starts Mon 16 Nov.
    const range = custom("2026-11-18", "2026-11-22", LATE);
    const rows = [row("2026-11-17T10:00:00Z"), row("2026-11-19T10:00:00Z")];
    const r = launchMeasuresFrom(rows, range, null, LATE);
    expect(r.weeks.map((w) => w.at)).toEqual([MON(16)]);
    expect(r.weeks[0]!.sightings).toBe(1);
  });
});

describe("follow-up (§4.5)", () => {
  it("another sighting within 7 days counts, after 8 doesn't; a deleted spotter isn't eligible", () => {
    const rows = [
      row("2026-11-10T10:00:00Z", { deviceId: "dev-a" }),
      row("2026-11-16T10:00:00Z", { deviceId: "dev-a", resolved: false }), // 6 days later: came back
      row("2026-11-10T11:00:00Z", { deviceId: "dev-b" }),
      row("2026-11-18T11:00:00Z", { deviceId: "dev-b", resolved: false }), // 8 days later: didn't
      row("2026-11-11T10:00:00Z", { deviceId: "dev-c" }),
      row("2026-11-18T10:00:00Z", { deviceId: "dev-c", resolved: false }), // exactly 7 days: came back
      row("2026-11-12T10:00:00Z", { deviceId: null }),
      row("2026-11-12T11:00:00Z", { deviceId: "dev-d", resolved: false }), // not finished: not eligible
    ];
    const w = weekAt(launchMeasuresFrom(rows, RANGE, null, LATE), MON(9));
    expect(w.followUp).toEqual({ eligible: 3, cameBack: 2 });
  });

  it("a second sighting at the same moment isn't coming back", () => {
    const rows = [row("2026-11-10T10:00:00Z", { deviceId: "dev-a" }), row("2026-11-10T10:00:00Z", { deviceId: "dev-a" })];
    expect(weekAt(launchMeasuresFrom(rows, RANGE, null, LATE), MON(9)).followUp).toEqual({ eligible: 2, cameBack: 0 });
  });

  it("the last 7 days are still open, and Not finished for 48 hours after a week ends", () => {
    // Thu 26 Nov 2026, 14:00 on Syros.
    const now = new Date("2026-11-26T12:00:00Z");
    const r = launchMeasuresFrom([], custom("2026-11-09", "2026-11-26", now), null, now);
    expect(r.weeks.map((w) => w.at)).toEqual([MON(9), MON(16), MON(23)]);
    // Week of 9 Nov ended 16 Nov, more than 7 days ago.
    expect(r.weeks[0]!.stillOpen).toEqual({ notFinished: false, followUp: false });
    // Week of 16 Nov ended 23 Nov: within 7 days, but more than 48 hours ago.
    expect(r.weeks[1]!.stillOpen).toEqual({ notFinished: false, followUp: true });
    expect(r.weeks[2]!.stillOpen).toEqual({ notFinished: true, followUp: true });
  });

  it("Not finished stays open until exactly 48 hours after the week ends", () => {
    const end = MON(23);
    const at = (ms: number) => launchMeasuresFrom([], custom("2026-11-16", "2026-11-22", LATE), null, new Date(end.getTime() + ms)).weeks[0]!.stillOpen.notFinished;
    expect(at(STILL_OPEN_MS - 1)).toBe(true);
    expect(at(STILL_OPEN_MS)).toBe(false);
  });
});

describe("match wait (§4.4)", () => {
  const week = (rows: LaunchRow[]) => weekAt(launchMeasuresFrom(rows, RANGE, null, LATE), MON(16));
  const waits = (pairs: [number | null, number | null][], extra: Partial<Match> = {}) =>
    pairs.map(([server, phone], i) => row(`2026-11-17T1${i}:00:00Z`, { match: { serverWaitMs: server, phoneWaitMs: phone, ...extra } }));

  it("typical and slow end, nearest rank", () => {
    const w = week(waits([[3000, 3000], [1000, 1000], [2000, 2000]]));
    expect(w.wait).toEqual({ phoneP50: 2000, phoneP90: 3000, serverP50: 2000, matcherDown: 0, noPhoneWait: 0, overTen: 0 });
  });

  it("nearest rank on an even count takes the lower middle", () => {
    const w = week(waits([[1000, 4000], [2000, 1000], [3000, 3000], [4000, 2000]]));
    expect(w.wait.phoneP50).toBe(2000);
    expect(w.wait.serverP50).toBe(2000);
    expect(w.wait.phoneP90).toBe(4000);
  });

  it("an empty week has no figures", () => {
    expect(week([]).wait).toEqual({ phoneP50: null, phoneP90: null, serverP50: null, matcherDown: 0, noPhoneWait: 0, overTen: 0 });
  });

  it("matcher down with no first wait counts in Matcher down only", () => {
    const w = week([...waits([[1000, 1000]]), row("2026-11-18T10:00:00Z", { match: { matcherFailed: true, serverWaitMs: null, phoneWaitMs: null } })]);
    expect(w.wait).toEqual({ phoneP50: 1000, phoneP90: 1000, serverP50: 1000, matcherDown: 1, noPhoneWait: 0, overTen: 0 });
  });

  it("a later failed resend (matcher_failed flipped) keeps its first wait in the figures, not in Matcher down (Ruling 4)", () => {
    const w = week(waits([[1500, 2500]], { matcherFailed: true }));
    expect(w.wait).toEqual({ phoneP50: 2500, phoneP90: 2500, serverP50: 1500, matcherDown: 0, noPhoneWait: 0, overTen: 0 });
  });

  it("a server wait with no phone wait counts in No phone wait", () => {
    const w = week(waits([[1000, null], [3000, 2000]]));
    expect(w.wait).toEqual({ phoneP50: 2000, phoneP90: 2000, serverP50: 1000, matcherDown: 0, noPhoneWait: 1, overTen: 0 });
  });

  it("a phone wait over 10 minutes goes to Over ten, never into the figures", () => {
    const w = week(waits([[1000, 700_000], [2000, 2000], [3000, MAX_PHONE_WAIT_MS]]));
    expect(w.wait).toEqual({ phoneP50: 2000, phoneP90: MAX_PHONE_WAIT_MS, serverP50: 2000, matcherDown: 0, noPhoneWait: 0, overTen: 1 });
    const only = week(waits([[1000, 700_000]]));
    expect(only.wait.phoneP50).toBeNull();
    expect(only.wait.phoneP90).toBeNull();
    expect(only.wait.overTen).toBe(1);
  });

  it("no match record: neither timed nor matcher down", () => {
    expect(week([row("2026-11-17T10:00:00Z", { match: null })]).wait).toEqual({ phoneP50: null, phoneP90: null, serverP50: null, matcherDown: 0, noPhoneWait: 0, overTen: 0 });
  });

  it("phone wait recorded from the earliest sighting that has one", () => {
    const rows = [
      row("2026-11-10T10:00:00Z", { match: { phoneWaitMs: null } }),
      row("2026-11-12T10:00:00Z", { match: { phoneWaitMs: 900 } }),
      row("2026-11-11T10:00:00Z", { match: { phoneWaitMs: 800 } }),
    ];
    expect(launchMeasuresFrom(rows, RANGE, null, LATE).phoneWaitFrom).toEqual(new Date("2026-11-11T10:00:00Z"));
    expect(launchMeasuresFrom([row("2026-11-10T10:00:00Z", { match: { phoneWaitMs: null } })], RANGE, null, LATE).phoneWaitFrom).toBeNull();
  });
});

describe("the baseline week, for any range (Ruling 5)", () => {
  it("a range starting after the baseline still gives the baseline's own counts", () => {
    // Launch Mon 16 Nov; the range is 30 Nov – 6 Dec. The loader adds the baseline week's rows.
    const range = custom("2026-11-30", "2026-12-06", LATE);
    const rows = [
      row("2026-11-17T10:00:00Z", { deviceId: "dev-a" }),
      row("2026-11-18T10:00:00Z", { deviceId: "dev-b", resolved: false }),
      row("2026-11-19T10:00:00Z", { deviceId: "dev-a" }),
      row("2026-12-01T10:00:00Z", { deviceId: "dev-a" }),
    ];
    const r = launchMeasuresFrom(rows, range, "2026-11-16", LATE);
    expect(r.weeks.map((w) => w.at)).toEqual([MON(30)]);
    expect(r.weeks[0]!.sightings).toBe(1);
    expect(r.sightings).toBe(1);
    expect(r.baseline).toMatchObject({ at: MON(16), label: "baseline", sightings: 3, spotters: 2, returning: 0 });
    expect(r.baseline!.groups).toMatchObject({ not_finished: 1, suggested: 2 });
    // dev-a's 17 Nov came back on the 19th; the 19th didn't (1 Dec is 12 days on).
    expect(r.baseline!.followUp).toEqual({ eligible: 2, cameBack: 1 });
  });

  it("a range ending before the baseline still gives it", () => {
    const range = custom("2026-11-09", "2026-11-15", LATE);
    const r = launchMeasuresFrom([row("2026-11-24T10:00:00Z")], range, "2026-11-18", LATE);
    expect(r.baseline).toMatchObject({ at: MON(23), sightings: 1 });
  });

  it("the baseline inside the range is that week's entry", () => {
    const rows = [row("2026-11-24T10:00:00Z"), row("2026-11-25T10:00:00Z", { deviceId: "dev-b" })];
    const r = launchMeasuresFrom(rows, RANGE, "2026-11-17", LATE);
    expect(r.baseline).toEqual(weekAt(r, MON(23)));
    expect(r.baseline!.sightings).toBe(2);
  });

  it("a range starting mid-way through the baseline still gives the whole week", () => {
    const range = custom("2026-11-25", "2026-12-06", LATE);
    const rows = [row("2026-11-24T10:00:00Z"), row("2026-11-26T10:00:00Z")];
    const r = launchMeasuresFrom(rows, range, "2026-11-17", LATE);
    expect(weekAt(r, MON(23)).sightings).toBe(1);
    expect(r.baseline).toMatchObject({ at: MON(23), sightings: 2 });
  });

  it("is null with no launch date, a future one, or before the baseline week starts", () => {
    expect(launchMeasuresFrom([], RANGE, null, LATE).baseline).toBeNull();
    expect(launchMeasuresFrom([], RANGE, "2027-03-01", LATE).baseline).toBeNull();
    // Launch Tue 17 Nov; now Fri 20 Nov: the baseline starts 23 Nov.
    const now = new Date("2026-11-20T10:00:00Z");
    expect(launchMeasuresFrom([], custom("2026-11-09", "2026-11-20", now), "2026-11-17", now).baseline).toBeNull();
  });
});

describe("Launch days counts only from launch (Ruling 8)", () => {
  it("a Wednesday launch leaves that week's Monday and Tuesday out of every figure", () => {
    // Launch Wed 18 Nov: Syros midnight is 17 Nov 22:00 UTC.
    const rows = [
      row("2026-11-16T10:00:00Z", { deviceId: "dev-test", match: { serverWaitMs: 9000, phoneWaitMs: 9000 } }),
      row("2026-11-17T21:59:00Z", { deviceId: "dev-test", match: { choice: "hand_pick", suggestedRank: null, missKind: "matcher_miss" } }),
      row("2026-11-17T22:00:00Z", { deviceId: "dev-a", match: { serverWaitMs: 1000, phoneWaitMs: 2000 } }),
    ];
    const r = launchMeasuresFrom(rows, RANGE, "2026-11-18", LATE);
    const w = weekAt(r, MON(16));
    expect(w.label).toBe("launch_days");
    expect(w.sightings).toBe(1);
    expect(w.spotters).toBe(1);
    expect(w.groups).toEqual({ not_finished: 0, no_cat: 0, suggested: 1, hand_pick: 0, new_cat: 0, other: 0 });
    expect(w.accuracy).toMatchObject({ right_first: 1, missed_compared: 0 });
    expect(w.suggestionsTaken).toBe(1);
    expect(w.wait).toMatchObject({ phoneP50: 2000, serverP50: 1000 });
    expect(w.followUp.eligible).toBe(1);
    // Testing days still count as testing everywhere else: the period total keeps Coverage's.
    expect(r.sightings).toBe(3);
  });
});

describe("what leaves the module", () => {
  it("holds counts and week dates, never a device", () => {
    const rows = [row("2026-11-17T10:00:00Z", { deviceId: "dev-secret-zz" })];
    const r = launchMeasuresFrom(rows, RANGE, "2026-11-16", LATE);
    expect(JSON.stringify(r)).not.toContain("dev-secret-zz");
    expect(r.workedOutAt).toEqual(LATE);
  });
});
