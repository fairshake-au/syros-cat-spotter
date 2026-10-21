/**
 * SYC-42 Slice 1, Samuel's 2 Oct 2026 change: "This cat needs help" is three
 * screens (Where → How bad → Before you send), never one scrolling page.
 * These pin the step rules; the screens themselves are tested in
 * components/__tests__/ReportWizard.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import {
  INITIAL_FLOW,
  canAdvance,
  clearCat,
  draftReady,
  flowBack,
  flowNext,
  startFlow,
  type ReportFlow,
} from '../reportFlow';

const here = { latitude: 37.444, longitude: 24.942 };
const photo = { uri: 'file:///p.jpg', base64: 'AAAA' };

describe('reportFlow', () => {
  it('runs Where → How bad → Before you send', () => {
    let f: ReportFlow = { ...INITIAL_FLOW, coords: here };
    expect(f.step).toBe(1);
    f = flowNext(f);
    expect(f.step).toBe(2);
    f = flowNext({ ...f, severity: 'urgent' });
    expect(f.step).toBe(3);
    // There is no step 4: Send is the last action.
    expect(flowNext(f).step).toBe(3);
  });

  it('screen 1 needs a location before Next; screen 2 needs a severity', () => {
    expect(canAdvance(INITIAL_FLOW)).toBe(false);
    expect(flowNext(INITIAL_FLOW).step).toBe(1);
    const two: ReportFlow = { ...INITIAL_FLOW, coords: here, step: 2 };
    expect(canAdvance(two)).toBe(false);
    expect(flowNext(two).step).toBe(2);
    expect(canAdvance({ ...two, severity: 'attention' })).toBe(true);
  });

  it('S4 (review of #55): a pin that only sits on the no-GPS default needs moving before Next', () => {
    expect(canAdvance({ ...INITIAL_FLOW, coords: here, pinIsDefault: true })).toBe(false);
    expect(canAdvance({ ...INITIAL_FLOW, coords: here, pinIsDefault: false })).toBe(true);
  });

  it('a photo is never required (nothing blocks a report)', () => {
    expect(canAdvance({ ...INITIAL_FLOW, coords: here, photo: null })).toBe(true);
  });

  it('back keeps everything entered', () => {
    const three: ReportFlow = {
      step: 3,
      photo,
      coords: here,
      severity: 'urgent',
      isLitter: true,
      note: 'by the bakery',
    };
    const two = flowBack(three);
    expect(two).toEqual({ ...three, step: 2 });
    const one = flowBack(two);
    expect(one).toEqual({ ...three, step: 1 });
    expect(flowBack(one).step).toBe(1);
  });

  it('the draft is ready once location and severity are both set (spec §4.2)', () => {
    expect(draftReady({ ...INITIAL_FLOW, coords: here })).toBe(false);
    expect(draftReady({ ...INITIAL_FLOW, severity: 'urgent' })).toBe(false);
    expect(draftReady({ ...INITIAL_FLOW, coords: here, severity: 'urgent' })).toBe(true);
  });

  it('from the Spot screen with a photo and a place, the flow opens on screen 2', () => {
    const f = startFlow({ photo, coords: here });
    expect(f.step).toBe(2);
    expect(f.photo).toEqual(photo);
    expect(f.coords).toEqual(here);
    // Back still reaches screen 1 to change either.
    expect(flowBack(f).step).toBe(1);
  });

  it('from the cat page or the map (no handoff), it opens on screen 1', () => {
    expect(startFlow(null).step).toBe(1);
    expect(startFlow({ photo }).step).toBe(1);
  });
});

describe('SYC-42 Slice 3: reporterEmail', () => {
  it('sends an address only when they chose "Yes, keep me updated" and it looks like one', async () => {
    const { INITIAL_FLOW: F, reporterEmail } = await import('../reportFlow');
    expect(reporterEmail({ ...F, email: 'a@b.org' })).toBeNull();
    expect(reporterEmail({ ...F, wantsUpdates: true, email: ' a@b.org ' })).toBe('a@b.org');
    expect(reporterEmail({ ...F, wantsUpdates: true, email: 'not an address' })).toBeNull();
    expect(reporterEmail({ ...F, wantsUpdates: true, email: 'a@b.org, c@d.org' })).toBeNull();
    expect(reporterEmail({ ...F, wantsUpdates: true, email: '' })).toBeNull();
  });
});

describe('SYC-42 Slice 3: the email screen (Samuel, 15 Oct 2026)', () => {
  it('with it: where → how bad → email → before you send; the email screen never holds anyone up', async () => {
    const { INITIAL_FLOW: F, flowNext: next, screenAt } = await import('../reportFlow');
    let f: ReportFlow = { ...F, coords: { latitude: 37.44, longitude: 24.94 } };
    expect(screenAt(f.step, true)).toBe('where');
    f = next(f, true);
    expect(screenAt(f.step, true)).toBe('howBad');
    f = next({ ...f, severity: 'urgent' }, true);
    expect(screenAt(f.step, true)).toBe('email');
    f = next(f, true);
    expect(screenAt(f.step, true)).toBe('beforeSend');
    expect(f.step).toBe(4);
    expect(next(f, true).step).toBe(4);
  });

  it('without it: the three screens, unchanged', async () => {
    const { screenAt } = await import('../reportFlow');
    expect([1, 2, 3].map((n) => screenAt(n as 1 | 2 | 3, false))).toEqual(['where', 'howBad', 'beforeSend']);
  });
});

describe('SYC-504: the report knows the cat', () => {
  const tigris = { id: 7, name: 'Tigris', photoUrl: '/api/photos/ph-1' };

  it('startFlow keeps the handoff cat; with none, the cat is null', () => {
    expect(startFlow({ cat: tigris }).cat).toEqual(tigris);
    expect(startFlow({ cat: tigris }).step).toBe(1);
    expect(startFlow(null).cat).toBeNull();
    expect(startFlow({ coords: here }).cat).toBeNull();
  });

  it('clearCat sets the cat to none and touches nothing else', () => {
    const f: ReportFlow = { ...startFlow({ cat: tigris, coords: here }), severity: 'urgent', note: 'limping' };
    const cleared = clearCat(f);
    expect(cleared.cat).toBeNull();
    expect({ ...cleared, cat: tigris }).toEqual(f);
  });

  it('the cat survives Next and Back; once cleared it stays cleared through both', () => {
    let f: ReportFlow = startFlow({ cat: tigris, coords: here });
    f = flowNext(f);
    expect(f.cat).toEqual(tigris);
    f = flowBack(f);
    expect(f.cat).toEqual(tigris);
    f = clearCat(f);
    f = flowNext(f);
    expect(f.cat).toBeNull();
    f = flowBack(f);
    expect(f.cat).toBeNull();
  });
});
