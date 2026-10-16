import { describe, expect, it } from 'vitest';
import { FACT_IDS } from '../starterFacts';
import {
  chooseForResult,
  chooseForWait,
  emptyRecord,
  markTapped,
  settleWait,
  shouldShowWaitingCard,
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

  it.each([[{ kind: 'notCat' } as const], [{ kind: 'failed' } as const]])(
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
