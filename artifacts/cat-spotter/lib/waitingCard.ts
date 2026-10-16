import { athensDaysBetween } from './athensDay';
import { EAR_TIP_FACT, FACT_IDS, MILK_FACT } from './starterFacts';

/**
 * The waiting card's schedule (SYC-48 / SYC-36; starter-facts.md §3,
 * feeding-nudge.md §3; match-wait plan PR 1). Pure: no React, no storage, no
 * clock. The screen reads the phone's record, asks what a wait shows, tells
 * this module how the wait ended, and saves what comes back.
 *
 * What a wait shows, in order (starter-facts.md §3.2):
 *  1. the full feeding nudge, if it hasn't been counted and the spotter isn't
 *     signed in as a cat guardian or team member (from PR 2: NUDGE_ENABLED);
 *  2. the ear-tip explainer, if this phone hasn't seen it;
 *  3. the milk fact, if this phone hasn't seen it;
 *  4. the next fact in this phone's shuffled order.
 * Hidden facts are skipped as if seen. When every shown fact has been seen,
 * the order reshuffles and never starts with the fact seen last.
 */

/** On since match-wait PR 2, which brought the result screen that counts the
 * nudge (plan small call 1: without it, the nudge would repeat every spot). */
export const NUDGE_ENABLED = true;

/** A fact counts as seen after this long on screen (§3.3). */
export const SEEN_AFTER_MS = 3000;

/** A phone stops counting as a visitor's on its 21st day (feeding-nudge.md
 * §3.2, condition 3: day 20 shows, day 21 doesn't). */
export const VISITOR_DAYS = 21;

export type NudgeForm = 'link' | 'noLink';

export interface PendingResult {
  /** The live send that came back with a cat. */
  sightingId: number;
  /** The nudge shown in the wait, which moves to the result screen; null if
   * the wait showed a fact (the result screen may then show the one-liner). */
  nudge: NudgeForm | null;
  /** False when the nudge was shown only because settings never loaded. */
  countable: boolean;
}

export interface WaitingRecord {
  v: 1;
  nudgeCounted: boolean;
  nudgeCountedDay: string | null;
  lastLineDay: string | null;
  tapped: boolean;
  /** Facts seen in the current round. */
  seenFacts: string[];
  /** Facts ever seen, so the fixed start happens once. */
  everSeen: string[];
  order: string[];
  lastFactId: string | null;
  pendingResult: PendingResult | null;
}

export function emptyRecord(): WaitingRecord {
  return {
    v: 1,
    nudgeCounted: false,
    nudgeCountedDay: null,
    lastLineDay: null,
    tapped: false,
    seenFacts: [],
    everSeen: [],
    order: [],
    lastFactId: null,
    pendingResult: null,
  };
}

/** What the server's switches say, as far as this phone knows. `loaded` is
 * false until the phone has heard from the server at least once. */
export interface SettingsView {
  loaded: boolean;
  linkOn: boolean;
  hiddenFacts: readonly string[];
}

/** "Does this phone look like a resident's?" (feeding-nudge.md §3.2). Any
 * answer but a 200 from the server is 'unknown', which never nags. */
export type Signals =
  | { status: 'known'; hasClaimedCat: boolean; firstSpotDate: string | null }
  | { status: 'unknown' };

export interface ScheduleContext {
  /** Set once the app has guardian and team sign-in (SYC-384); null today. */
  signedInRole: null | 'guardian' | 'team';
  nudgeEnabled: boolean;
  /** Today's Athens day, 'YYYY-MM-DD'. */
  today: string;
  /** For the shuffle; tests pass a seeded one. */
  random: () => number;
}

export type WaitChoice =
  | { kind: 'nudge'; form: NudgeForm; countable: boolean }
  | { kind: 'fact'; id: string }
  /** Every fact is switched off: the card shows only "While we look…". */
  | { kind: 'empty' };

/** Facts this phone may show. Before the switches have ever loaded, nothing
 * is hidden (starter-facts.md §9; Samuel, plan Decision 4). */
export function visibleFacts(settings: SettingsView): string[] {
  const hidden = new Set(settings.loaded ? settings.hiddenFacts : []);
  return FACT_IDS.filter((id) => !hidden.has(id));
}

function shuffled(ids: readonly string[], random: () => number): string[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The record with its order repaired: ids that no longer exist or are
 * hidden dropped, new visible ids added at random places. */
function withRepairedOrder(record: WaitingRecord, visible: readonly string[], random: () => number): WaitingRecord {
  const keep = record.order.filter((id) => visible.includes(id));
  const missing = visible.filter((id) => !keep.includes(id));
  const order = [...keep];
  for (const id of shuffled(missing, random)) {
    order.splice(Math.floor(random() * (order.length + 1)), 0, id);
  }
  return { ...record, order };
}

/**
 * What the next wait shows, and the record to save straight away (it may
 * carry a repaired or reshuffled order; showing the same item again after a
 * failed wait is unaffected, because nothing is marked seen here).
 *
 * `record` null means the phone's record couldn't be read: show a fact, never
 * the nudge, and save nothing (starter-facts.md §3.4).
 */
export function chooseForWait(
  record: WaitingRecord | null,
  settings: SettingsView,
  ctx: ScheduleContext,
): { choice: WaitChoice; record: WaitingRecord | null } {
  const visible = visibleFacts(settings);

  if (record === null) {
    const id = visible.includes(EAR_TIP_FACT) ? EAR_TIP_FACT : visible[0];
    return { choice: id ? { kind: 'fact', id } : { kind: 'empty' }, record: null };
  }

  if (ctx.nudgeEnabled && !record.nudgeCounted && ctx.signedInRole === null) {
    return {
      choice: {
        kind: 'nudge',
        form: settings.loaded && settings.linkOn ? 'link' : 'noLink',
        // A nudge shown only because the switches never loaded isn't counted.
        countable: settings.loaded,
      },
      record,
    };
  }

  if (visible.length === 0) return { choice: { kind: 'empty' }, record };

  for (const first of [EAR_TIP_FACT, MILK_FACT]) {
    if (visible.includes(first) && !record.everSeen.includes(first)) {
      return { choice: { kind: 'fact', id: first }, record };
    }
  }

  let next = withRepairedOrder(record, visible, ctx.random);
  const seen = new Set(next.seenFacts);
  let id = next.order.find((f) => !seen.has(f));
  if (id === undefined) {
    // Every shown fact has been seen: a new round, never starting with the
    // fact seen last (unless it's the only one).
    let order = shuffled(visible, ctx.random);
    if (order.length > 1 && order[0] === next.lastFactId) {
      order = [...order.slice(1), order[0]!];
    }
    next = { ...next, order, seenFacts: [] };
    id = order[0]!;
  }
  return { choice: { kind: 'fact', id }, record: next };
}

export type WaitOutcome =
  /** Sent, and the server found a cat: the spotter goes to a result screen. */
  | { kind: 'result'; sightingId: number }
  /** Sent, but there's no cat in the photo. */
  | { kind: 'notCat' }
  /** A failed or refused send, "Save and send later", or nothing saved. */
  | { kind: 'failed' };

/**
 * The record after a wait ended. Only a wait that reached a result screen
 * changes anything (starter-facts.md §3.2): a fact counts as seen after 3
 * seconds on screen; a nudge is carried to the result screen, where it is
 * counted (feeding-nudge.md §3.3). Every live result leaves a `pendingResult`,
 * so the result screen knows it's a first result (for the one-liner).
 */
export function settleWait(
  record: WaitingRecord,
  shown: WaitChoice,
  outcome: WaitOutcome,
  shownMs: number,
): WaitingRecord {
  if (outcome.kind !== 'result') return { ...record, pendingResult: null };

  let next: WaitingRecord = { ...record };
  if (shown.kind === 'fact' && shownMs >= SEEN_AFTER_MS) {
    next = {
      ...next,
      seenFacts: next.seenFacts.includes(shown.id) ? next.seenFacts : [...next.seenFacts, shown.id],
      everSeen: next.everSeen.includes(shown.id) ? next.everSeen : [...next.everSeen, shown.id],
      lastFactId: shown.id,
    };
  }
  next.pendingResult = {
    sightingId: outcome.sightingId,
    nudge: shown.kind === 'nudge' ? shown.form : null,
    countable: shown.kind === 'nudge' ? shown.countable : false,
  };
  return next;
}

export type ResultScreen = 'matches' | 'naming' | 'notCat';

export interface ResultTarget {
  sightingId: number;
  /** Set when the screen shows a queued sighting matched in the background. */
  localId?: string;
  /** The screen the result opened on. */
  screen: ResultScreen;
}

/**
 * What the first result screen shows below everything (feeding-nudge.md
 * §3.2–3.3), and the record to save. Decided once, when the screen opens.
 *  - The nudge from the wait, with its buttons; counted here unless it was
 *    shown only because the switches never loaded.
 *  - Otherwise, maybe the visitor's one-liner: all six conditions of §3.2.
 * A queued sighting, the no-cat screen, or another sighting's screen shows
 * nothing.
 */
export function chooseForResult(
  record: WaitingRecord | null,
  settings: SettingsView,
  signals: Signals,
  ctx: ScheduleContext,
  target: ResultTarget,
): { show: { kind: 'nudge'; form: NudgeForm } | { kind: 'line' } | null; record: WaitingRecord | null } {
  if (record === null) return { show: null, record: null };
  const pending = record.pendingResult;
  if (target.localId !== undefined || !pending || pending.sightingId !== target.sightingId) {
    return { show: null, record };
  }
  const cleared: WaitingRecord = { ...record, pendingResult: null };
  if (target.screen === 'notCat') return { show: null, record: cleared };

  if (pending.nudge) {
    return {
      show: { kind: 'nudge', form: pending.nudge },
      record: pending.countable
        ? { ...cleared, nudgeCounted: true, nudgeCountedDay: ctx.today }
        : cleared,
    };
  }

  const visitor =
    signals.status === 'known' &&
    !signals.hasClaimedCat &&
    (signals.firstSpotDate === null ||
      athensDaysBetween(signals.firstSpotDate, ctx.today) < VISITOR_DAYS);
  const lineDue =
    ctx.nudgeEnabled &&
    record.nudgeCounted &&
    record.nudgeCountedDay !== null &&
    athensDaysBetween(record.nudgeCountedDay, ctx.today) > 0 &&
    record.lastLineDay !== ctx.today &&
    visitor &&
    !record.tapped &&
    settings.loaded &&
    settings.linkOn &&
    ctx.signedInRole === null;

  if (!lineDue) return { show: null, record: cleared };
  return { show: { kind: 'line' }, record: { ...cleared, lastLineDay: ctx.today } };
}

/** A tap on "Help feed a cat": no more daily reminders (§3.2, condition 4). */
export function markTapped(record: WaitingRecord): WaitingRecord {
  return { ...record, tapped: true };
}

/** Whether the card takes the map's place. Only while a sighting is being
 * SENT: an offline save never shows it (plan C7). */
export function shouldShowWaitingCard(state: { waiting: boolean }): boolean {
  return state.waiting;
}
