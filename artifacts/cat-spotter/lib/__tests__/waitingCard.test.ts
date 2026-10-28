import { describe, expect, it } from 'vitest';
import { FACT_IDS } from '../starterFacts';
import {
  chooseForResult,
  chooseForWait,
  emptyRecord,
  factProgress,
  isNudgeDue,
  nextSpotBringsNewFact,
  markTapped,
  settleWait,
  waitOutcomeForSend,
  shouldShowWaitingCard,
  visibleFacts,
  type ScheduleContext,
  type SettingsView,
  type Signals,
  type WaitChoice,
  type WaitingRecord,
} from '../waitingCard';

// SYC-48 / SYC-36, match-wait plan PR 1: starter-facts.md §9.1 and
// feeding-nudge.md §9.1, as pure functions. Test numbers are the specs'.

function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const LOADED: SettingsView = { loaded: true, linkOn: true, hiddenFacts: [], extraPhotosOn: false };
const NEVER_LOADED: SettingsView = { loaded: false, linkOn: false, hiddenFacts: [], extraPhotosOn: false };
const VISITOR: Signals = { status: 'known', hasClaimedCat: false, firstSpotDate: '2026-07-01' };

const ctx = (over: Partial<ScheduleContext> = {}): ScheduleContext => ({
  signedInRole: null,
  nudgeEnabled: true,
  today: '2026-07-10',
  random: seeded(),
  ...over,
});

/** One wait that reaches the match list, shown for `ms`. */
function spot(
  record: WaitingRecord,
  settings: SettingsView,
  c: ScheduleContext,
  sightingId: number,
  ms = 5000,
): { shown: WaitChoice; record: WaitingRecord } {
  const { choice, record: r } = chooseForWait(record, settings, c);
  return { shown: choice, record: settleWait(r!, choice, { kind: 'result', sightingId }, ms) };
}

/** A wait, then the match list opening. */
function spotAndResult(
  record: WaitingRecord,
  settings: SettingsView,
  c: ScheduleContext,
  sightingId: number,
  signals: Signals = VISITOR,
) {
  const w = spot(record, settings, c, sightingId);
  const r = chooseForResult(w.record, settings, signals, c, { sightingId, screen: 'matches' });
  return { shown: w.shown, show: r.show, record: r.record! };
}

describe('starter-facts.md §9.1', () => {
  it('1. a new phone: the nudge, fact 1 (with photo), fact 7, then a shuffled fact', () => {
    let r = emptyRecord();
    const shown: WaitChoice[] = [];
    for (let i = 1; i <= 4; i++) {
      const out = spotAndResult(r, LOADED, ctx(), i);
      shown.push(out.shown);
      r = out.record;
    }
    expect(shown[0]).toEqual({ kind: 'nudge', form: 'link', countable: true });
    expect(shown[1]).toEqual({ kind: 'fact', id: 'fact.earTip' });
    expect(shown[2]).toEqual({ kind: 'fact', id: 'fact.milk' });
    expect(shown[3]!.kind).toBe('fact');
    expect(['fact.earTip', 'fact.milk']).not.toContain((shown[3] as { id: string }).id);
  });

  it('1 (PR 1). with the nudge switched off in the code, a new phone starts with the ear tip', () => {
    const { choice } = chooseForWait(emptyRecord(), LOADED, ctx({ nudgeEnabled: false }));
    expect(choice).toEqual({ kind: 'fact', id: 'fact.earTip' });
  });

  it('2. no repeat until every shown fact is seen; a reshuffle never starts with the last one', () => {
    const c = ctx({ nudgeEnabled: false, random: seeded(7) });
    let r = emptyRecord();
    for (let round = 0; round < 3; round++) {
      const seen: string[] = [];
      for (let i = 0; i < FACT_IDS.length; i++) {
        const out = spot(r, LOADED, c, i + 1);
        const id = (out.shown as { id: string }).id;
        if (i === 0 && round > 0) expect(id).not.toBe(r.lastFactId);
        seen.push(id);
        r = out.record;
      }
      expect([...seen].sort()).toEqual([...FACT_IDS].sort());
    }
  });

  it('2. with only one fact switched on, it repeats', () => {
    const only: SettingsView = { ...LOADED, hiddenFacts: FACT_IDS.filter((f) => f !== 'fact.tortie') };
    let r = emptyRecord();
    for (let i = 0; i < 3; i++) {
      const out = spot(r, only, ctx({ nudgeEnabled: false }), i);
      expect(out.shown).toEqual({ kind: 'fact', id: 'fact.tortie' });
      r = out.record;
    }
  });

  it('2. with every fact switched off, the card is empty', () => {
    const none: SettingsView = { ...LOADED, hiddenFacts: [...FACT_IDS] };
    expect(chooseForWait(emptyRecord(), none, ctx({ nudgeEnabled: false })).choice).toEqual({ kind: 'empty' });
  });

  it('3. a fact on screen under 3 seconds isn\'t seen; it comes round again', () => {
    const c = ctx({ nudgeEnabled: false });
    const first = spot(emptyRecord(), LOADED, c, 1, 2999);
    expect(first.shown).toEqual({ kind: 'fact', id: 'fact.earTip' });
    expect(first.record.seenFacts).toEqual([]);
    expect(chooseForWait(first.record, LOADED, c).choice).toEqual({ kind: 'fact', id: 'fact.earTip' });
    const again = spot(first.record, LOADED, c, 2, 3000);
    expect(again.record.everSeen).toContain('fact.earTip');
  });

  it.each([[{ kind: 'notCat' } as const], [{ kind: 'failed' } as const], [{ kind: 'couldntCheck' } as const]])(
    '4. a wait ending %j marks nothing; the next wait shows the same item',
    (outcome) => {
      const c = ctx();
      const { choice, record } = chooseForWait(emptyRecord(), LOADED, c);
      const after = settleWait(record!, choice, outcome, 10_000);
      expect(after.nudgeCounted).toBe(false);
      expect(after.pendingResult).toBeNull();
      expect(chooseForWait(after, LOADED, c).choice).toEqual(choice);
    },
  );

  it('5. the card shows only while a sighting is being sent', () => {
    expect(shouldShowWaitingCard({ waiting: true })).toBe(true);
    expect(shouldShowWaitingCard({ waiting: false })).toBe(false);
  });

  it('6. a hidden fact never shows, including 1 and 7, and the rest still rotate', () => {
    const hidden: SettingsView = { ...LOADED, hiddenFacts: ['fact.earTip', 'fact.milk', 'fact.cost'] };
    const c = ctx({ nudgeEnabled: false });
    let r = emptyRecord();
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const out = spot(r, hidden, c, i);
      seen.add((out.shown as { id: string }).id);
      r = out.record;
    }
    expect(seen.has('fact.earTip') || seen.has('fact.milk') || seen.has('fact.cost')).toBe(false);
    expect(seen.size).toBe(FACT_IDS.length - 3);
  });

  it('6. before the switches have ever loaded, nothing is hidden (Samuel, plan Decision 4)', () => {
    const notYet: SettingsView = { loaded: false, linkOn: false, hiddenFacts: ['fact.earTip'], extraPhotosOn: false };
    expect(chooseForWait(emptyRecord(), notYet, ctx({ nudgeEnabled: false })).choice).toEqual({
      kind: 'fact',
      id: 'fact.earTip',
    });
  });

  it('8. an unreadable record: a fact, never the nudge, and nothing to save', () => {
    const out = chooseForWait(null, LOADED, ctx());
    expect(out.choice).toEqual({ kind: 'fact', id: 'fact.earTip' });
    expect(out.record).toBeNull();
  });

  it('a stored order drops ids that no longer exist and adds new ones', () => {
    const r: WaitingRecord = {
      ...emptyRecord(),
      everSeen: ['fact.earTip', 'fact.milk'],
      seenFacts: ['fact.earTip', 'fact.milk'],
      order: ['fact.gone', 'fact.tortie'],
    };
    const out = chooseForWait(r, LOADED, ctx({ nudgeEnabled: false }));
    expect(out.record!.order).not.toContain('fact.gone');
    expect([...out.record!.order].sort()).toEqual([...FACT_IDS].sort());
  });
});

describe('feeding-nudge.md §9.1 (the schedule; the screens come in PR 2)', () => {
  it('1. new phone, switches loaded, link on: the full nudge in the wait', () => {
    expect(chooseForWait(emptyRecord(), LOADED, ctx()).choice).toEqual({ kind: 'nudge', form: 'link', countable: true });
  });

  it('2. when the result arrives, the nudge moves to the match list and is counted', () => {
    const out = spotAndResult(emptyRecord(), LOADED, ctx(), 1);
    expect(out.show).toEqual({ kind: 'nudge', form: 'link' });
    expect(out.record.nudgeCounted).toBe(true);
    expect(out.record.nudgeCountedDay).toBe('2026-07-10');
  });

  it('2. also on naming a new cat', () => {
    const w = spot(emptyRecord(), LOADED, ctx(), 1);
    const r = chooseForResult(w.record, LOADED, VISITOR, ctx(), { sightingId: 1, screen: 'naming' });
    expect(r.show).toEqual({ kind: 'nudge', form: 'link' });
  });

  it('3. never on the no-cat screen, nothing counted', () => {
    const w = spot(emptyRecord(), LOADED, ctx(), 1);
    const r = chooseForResult(w.record, LOADED, VISITOR, ctx(), { sightingId: 1, screen: 'notCat' });
    expect(r.show).toBeNull();
    expect(r.record!.nudgeCounted).toBe(false);
  });

  it('4. a failed wait doesn\'t count the nudge; the next wait shows it again', () => {
    const c = ctx();
    const { choice, record } = chooseForWait(emptyRecord(), LOADED, c);
    const after = settleWait(record!, choice, { kind: 'failed' }, 9000);
    expect(chooseForWait(after, LOADED, c).choice.kind).toBe('nudge');
  });

  it('5. once counted, never again', () => {
    const r = spotAndResult(emptyRecord(), LOADED, ctx(), 1).record;
    expect(chooseForWait(r, LOADED, ctx()).choice.kind).toBe('fact');
  });

  it('6. on the day it is counted, no one-liner, even on a later spot', () => {
    let r = spotAndResult(emptyRecord(), LOADED, ctx(), 1).record;
    const later = spotAndResult(r, LOADED, ctx(), 2);
    expect(later.show).toBeNull();
    r = later.record;
    expect(r.lastLineDay).toBeNull();
  });

  it('7. the next Athens day: the first result shows the one-liner, a second spot doesn\'t; that wait shows a fact', () => {
    const r = spotAndResult(emptyRecord(), LOADED, ctx(), 1).record;
    const next = spotAndResult(r, LOADED, ctx({ today: '2026-07-11' }), 2);
    expect(next.shown.kind).toBe('fact');
    expect(next.show).toEqual({ kind: 'line' });
    expect(spotAndResult(next.record, LOADED, ctx({ today: '2026-07-11' }), 3).show).toBeNull();
  });

  it('8. a no-cat or failed first spot of the day doesn\'t use the one-liner up', () => {
    const r = spotAndResult(emptyRecord(), LOADED, ctx(), 1).record;
    const c = ctx({ today: '2026-07-11' });
    const { choice, record } = chooseForWait(r, LOADED, c);
    const notCat = settleWait(record!, choice, { kind: 'notCat' }, 9000);
    expect(spotAndResult(notCat, LOADED, c, 2).show).toEqual({ kind: 'line' });
  });

  it('10. no one-liner for a phone that has claimed a cat, or spotted for 21+ days; one at 20', () => {
    const r = spotAndResult(emptyRecord(), LOADED, ctx(), 1).record;
    const c = ctx({ today: '2026-07-21' });
    const claimed: Signals = { status: 'known', hasClaimedCat: true, firstSpotDate: '2026-07-10' };
    expect(spotAndResult(r, LOADED, c, 2, claimed).show).toBeNull();
    const day21: Signals = { status: 'known', hasClaimedCat: false, firstSpotDate: '2026-06-30' };
    expect(spotAndResult(r, LOADED, c, 2, day21).show).toBeNull();
    const day20: Signals = { status: 'known', hasClaimedCat: false, firstSpotDate: '2026-07-01' };
    expect(spotAndResult(r, LOADED, c, 2, day20).show).toEqual({ kind: 'line' });
  });

  it('10. a phone whose first spot is today (no date yet) counts as a visitor', () => {
    const r = spotAndResult(emptyRecord(), LOADED, ctx(), 1).record;
    const fresh: Signals = { status: 'known', hasClaimedCat: false, firstSpotDate: null };
    expect(spotAndResult(r, LOADED, ctx({ today: '2026-07-11' }), 2, fresh).show).toEqual({ kind: 'line' });
  });

  it('11. no one-liner when the switches have never loaded, or the signals are unknown', () => {
    const counted = spotAndResult(emptyRecord(), LOADED, ctx(), 1).record;
    const c = ctx({ today: '2026-07-11' });
    expect(spotAndResult(counted, NEVER_LOADED, c, 2).show).toBeNull();
    expect(spotAndResult(counted, LOADED, c, 2, { status: 'unknown' }).show).toBeNull();
  });

  it('12. no one-liner after a tap on Help feed a cat', () => {
    const r = markTapped(spotAndResult(emptyRecord(), LOADED, ctx(), 1).record);
    expect(spotAndResult(r, LOADED, ctx({ today: '2026-07-11' }), 2).show).toBeNull();
  });

  it('13. no one-liner when the donation link is switched off', () => {
    const r = spotAndResult(emptyRecord(), LOADED, ctx(), 1).record;
    expect(spotAndResult(r, { ...LOADED, linkOn: false }, ctx({ today: '2026-07-11' }), 2).show).toBeNull();
  });

  it('14. signed in as a cat guardian or team member: neither the nudge nor the one-liner', () => {
    for (const role of ['guardian', 'team'] as const) {
      const c = ctx({ signedInRole: role });
      expect(chooseForWait(emptyRecord(), LOADED, c).choice.kind).toBe('fact');
      const counted = spotAndResult(emptyRecord(), LOADED, ctx(), 1).record;
      expect(spotAndResult(counted, LOADED, { ...c, today: '2026-07-11' }, 2).show).toBeNull();
    }
  });

  it('15. a queued sighting (opened by localId) never shows the nudge or the one-liner', () => {
    const w = spot(emptyRecord(), LOADED, ctx(), 1);
    const r = chooseForResult(w.record, LOADED, VISITOR, ctx(), { sightingId: 1, localId: 'q1', screen: 'matches' });
    expect(r.show).toBeNull();
  });

  it('16. link off on purpose: the no-link form, counted; never loaded: the same form, not counted', () => {
    const off: SettingsView = { loaded: true, linkOn: false, hiddenFacts: [], extraPhotosOn: false };
    expect(chooseForWait(emptyRecord(), off, ctx()).choice).toEqual({ kind: 'nudge', form: 'noLink', countable: true });
    const a = spotAndResult(emptyRecord(), off, ctx(), 1);
    expect(a.show).toEqual({ kind: 'nudge', form: 'noLink' });
    expect(a.record.nudgeCounted).toBe(true);
    const b = spotAndResult(emptyRecord(), NEVER_LOADED, ctx(), 1);
    expect(b.show).toEqual({ kind: 'nudge', form: 'noLink' });
    expect(b.record.nudgeCounted).toBe(false);
  });

  it('17. a wiped record: a resident still gets no one-liner', () => {
    const resident: Signals = { status: 'known', hasClaimedCat: true, firstSpotDate: '2026-01-01' };
    const r = { ...emptyRecord(), nudgeCounted: true, nudgeCountedDay: '2026-07-01' };
    expect(spotAndResult(r, LOADED, ctx(), 1, resident).show).toBeNull();
  });

  it('another sighting\'s result screen shows nothing', () => {
    const w = spot(emptyRecord(), LOADED, ctx(), 1);
    expect(chooseForResult(w.record, LOADED, VISITOR, ctx(), { sightingId: 2, screen: 'matches' }).show).toBeNull();
  });

  it('switches that load between the wait and the result keep the wait\'s form, uncounted', () => {
    const w = spot(emptyRecord(), NEVER_LOADED, ctx(), 1);
    const r = chooseForResult(w.record, LOADED, VISITOR, ctx(), { sightingId: 1, screen: 'matches' });
    expect(r.show).toEqual({ kind: 'nudge', form: 'noLink' });
    expect(r.record!.nudgeCounted).toBe(false);
  });
});

// SYC-503: the "couldn't check" screen shows no nudge and uses up nothing.
describe("the couldn't-check screen (SYC-503)", () => {
  it('shows no nudge or line, even with a nudge carried from the wait', () => {
    const c = ctx();
    const w = spot(emptyRecord(), LOADED, c, 31);
    expect(w.record.pendingResult?.nudge).not.toBeNull();
    const r = chooseForResult(w.record, LOADED, VISITOR, c, { sightingId: 31, screen: 'couldntCheck' });
    expect(r.show).toBeNull();
    expect(r.record!.nudgeCounted).toBe(false);
  });
});

// SYC-503 (review finding 3): how a send ends, for the wait record.
describe('waitOutcomeForSend (SYC-503)', () => {
  it('a failed look-alike check is its own outcome, even if "is a cat"', () => {
    expect(waitOutcomeForSend({ sightingId: 4, isCatPhoto: true, matchCheck: 'failed' })).toEqual({
      kind: 'couldntCheck',
    });
  });
  it('a check that worked is a result, or not a cat', () => {
    expect(waitOutcomeForSend({ sightingId: 4, isCatPhoto: true, matchCheck: 'done' })).toEqual({
      kind: 'result',
      sightingId: 4,
    });
    expect(waitOutcomeForSend({ sightingId: 4, isCatPhoto: false })).toEqual({ kind: 'notCat' });
  });
  it('no answer is a failed send', () => {
    expect(waitOutcomeForSend(null)).toEqual({ kind: 'failed' });
  });
});

// SYC-772 (spec §3.2, §3.3, §3.5): progress counting, the "next spot brings a
// new fact" test, and unseen facts first.

// Copied from SIGN_OFF_FACT_IDS in lib/db/src/appSettings/shape.ts: the 9
// facts hidden until sign-off, so the card starts with 11 visible.
const SIGN_OFF_9: readonly string[] = [
  'fact.earTip',
  'fact.disease',
  'fact.backHome',
  'fact.vacuum',
  'fact.cost',
  'fact.leftovers',
  'fact.water',
  'fact.kittensAlone',
  'fact.colonyFemales',
];
const settings = (hidden: readonly string[] = SIGN_OFF_9): SettingsView => ({
  loaded: true,
  linkOn: true,
  hiddenFacts: hidden,
  extraPhotosOn: false,
});
const VISIBLE_11 = FACT_IDS.filter((id) => !SIGN_OFF_9.includes(id));
const rec = (everSeen: string[]): WaitingRecord => ({ ...emptyRecord(), everSeen });
const fact = (id: string): WaitChoice => ({ kind: 'fact', id });
// A fact added on the server (spec §5.3) can't exist until SYC-754, because
// visibleFacts reads FACT_IDS; the total is tied to it so it stays right then.

describe('factProgress', () => {
  it('first fact on a fresh phone reads 1 of 11 and walks from 0', () => {
    expect(VISIBLE_11).toHaveLength(11);
    expect(factProgress(emptyRecord(), settings(), fact('fact.milk')))
      .toEqual({ kind: 'count', n: 1, total: 11, walkFrom: 0 });
  });
  it('3 of 11 after two seen', () => {
    expect(factProgress(rec(['fact.milk', 'fact.litters']), settings(), fact('fact.hiss')))
      .toEqual({ kind: 'count', n: 3, total: 11, walkFrom: 2 });
  });
  it('a fact cut short (not in everSeen) keeps its number next wait', () => {
    const r = rec(['fact.milk', 'fact.litters']);
    const expected = { kind: 'count', n: 3, total: 11, walkFrom: 2 };
    expect(factProgress(r, settings(), fact('fact.hiss'))).toEqual(expected);
    // Shown for under SEEN_AFTER_MS, so it isn't marked seen.
    const settled = settleWait(r, fact('fact.hiss'), { kind: 'result', sightingId: 7 }, 2999);
    expect(factProgress(settled, settings(), fact('fact.hiss'))).toEqual(expected);
  });
  it('the last unseen fact reads 11 of 11', () => {
    const tenSeen = VISIBLE_11.filter((id) => id !== 'fact.purr');
    expect(factProgress(rec(tenSeen), settings(), fact('fact.purr')))
      .toEqual({ kind: 'count', n: 11, total: 11, walkFrom: 10 });
  });
  it('with all seen, a round-2 repeat reads done and adds nothing', () => {
    expect(factProgress(rec(VISIBLE_11), settings(), fact('fact.milk'))).toEqual({ kind: 'done', total: 11 });
  });
  it('a seen fact that is now hidden counts in neither number nor total', () => {
    expect(factProgress(rec(['fact.earTip', 'fact.milk']), settings(), fact('fact.hiss')))
      .toEqual({ kind: 'count', n: 2, total: 11, walkFrom: 1 });
  });
  it('a hidden seen fact shown again counts again', () => {
    expect(
      factProgress(rec(['fact.earTip', 'fact.milk']), settings(SIGN_OFF_9.filter((i) => i !== 'fact.earTip')), fact('fact.hiss')),
    ).toEqual({ kind: 'count', n: 3, total: 12, walkFrom: 2 });
  });
  it('the total is always visibleFacts(settings).length', () => {
    for (const hidden of [[], SIGN_OFF_9, FACT_IDS.slice(0, 18)]) {
      const p = factProgress(emptyRecord(), settings(hidden), fact(visibleFacts(settings(hidden))[0]!));
      expect(p && p.total).toBe(visibleFacts(settings(hidden)).length);
    }
  });
  it('null for: record null, settings not loaded, nudge, empty, fewer than 2 visible', () => {
    expect(factProgress(null, settings(), fact('fact.milk'))).toBeNull();
    expect(factProgress(emptyRecord(), { ...settings(), loaded: false }, fact('fact.milk'))).toBeNull();
    expect(factProgress(emptyRecord(), settings(), { kind: 'nudge', form: 'link', countable: true })).toBeNull();
    expect(factProgress(emptyRecord(), settings(), { kind: 'empty' })).toBeNull();
    expect(factProgress(emptyRecord(), settings(FACT_IDS.slice(1)), fact(FACT_IDS[0]!))).toBeNull();
  });
});

const CTX = { nudgeEnabled: true, signedInRole: null } as const;
const counted = (everSeen: string[]): WaitingRecord => ({ ...rec(everSeen), nudgeCounted: true });

describe('isNudgeDue', () => {
  it('true only when enabled, not counted and not signed in', () => {
    expect(isNudgeDue(emptyRecord(), CTX)).toBe(true);
    expect(isNudgeDue(emptyRecord(), { ...CTX, nudgeEnabled: false })).toBe(false);
    expect(isNudgeDue({ ...emptyRecord(), nudgeCounted: true }, CTX)).toBe(false);
    expect(isNudgeDue(emptyRecord(), { ...CTX, signedInRole: 'guardian' })).toBe(false);
  });
});

describe('nextSpotBringsNewFact', () => {
  it('true with an unseen visible fact and the nudge counted', () => {
    expect(nextSpotBringsNewFact(counted(['fact.milk']), settings(), CTX)).toBe(true);
  });
  it('false when the nudge is due', () => {
    expect(nextSpotBringsNewFact(rec(['fact.milk']), settings(), CTX)).toBe(false);
  });
  it('false when everything visible is in everSeen', () => {
    expect(nextSpotBringsNewFact(counted(VISIBLE_11), settings(), CTX)).toBe(false);
  });
  it('false for null record, settings not loaded, fewer than 2 visible', () => {
    expect(nextSpotBringsNewFact(null, settings(), CTX)).toBe(false);
    expect(nextSpotBringsNewFact(counted([]), { ...settings(), loaded: false }, CTX)).toBe(false);
    expect(nextSpotBringsNewFact(counted([]), settings(FACT_IDS.slice(1)), CTX)).toBe(false);
  });
  it('false right after settleWait marks the last unseen fact seen', () => {
    const before = counted(VISIBLE_11.filter((id) => id !== 'fact.purr'));
    const after = settleWait(before, fact('fact.purr'), { kind: 'result', sightingId: 7 }, 3000);
    expect(nextSpotBringsNewFact(after, settings(), CTX)).toBe(false);
  });
});

describe('chooseForWait: unseen first (spec §3.5)', () => {
  it("after a full round, un-hiding a fact makes it the next wait's fact", () => {
    // All 11 seen; a second round is partly through (4 of the 11 in seenFacts).
    const mid: WaitingRecord = {
      ...counted(VISIBLE_11),
      order: [...VISIBLE_11],
      seenFacts: VISIBLE_11.slice(0, 4),
      lastFactId: VISIBLE_11[3]!,
    };
    const unhidden = settings(SIGN_OFF_9.filter((id) => id !== 'fact.colonyFemales'));
    // Constant randoms put the new id at the very end, in the middle and at the start of the order.
    for (const value of [0.99, 0.5, 0]) {
      const { choice } = chooseForWait(mid, unhidden, ctx({ random: () => value }));
      expect(choice).toEqual({ kind: 'fact', id: 'fact.colonyFemales' });
    }
  });

  it('round 1 order is unchanged: a fresh record chooses what it did before', () => {
    // Expected values computed from the code before SYC-772 (seeded(), nudge counted).
    let r: WaitingRecord = { ...emptyRecord(), nudgeCounted: true };
    const c = ctx();
    const shown: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const w = spot(r, LOADED, c, i);
      shown.push((w.shown as { id: string }).id);
      r = w.record;
    }
    expect(shown).toEqual(['fact.earTip', 'fact.milk', 'fact.backHome', 'fact.hiss', 'fact.litters']);
  });

  it('never puts lastFactId first in a new round', () => {
    const all = visibleFacts(LOADED);
    const done: WaitingRecord = {
      ...counted(all),
      order: [...all],
      seenFacts: [...all],
      lastFactId: all[5]!,
    };
    for (let seed = 1; seed <= 20; seed++) {
      const { choice, record } = chooseForWait(done, LOADED, ctx({ random: seeded(seed) }));
      expect(choice).not.toEqual({ kind: 'fact', id: all[5] });
      expect(record!.seenFacts).toEqual([]);
    }
  });
});
