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
