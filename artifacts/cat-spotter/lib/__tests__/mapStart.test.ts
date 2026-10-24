/**
 * SYC-166 slice 4 (spec photo-location-from-library.md §9 test 5, plan
 * "Slice 4"): the map always has a start. A library photo with no usable phone
 * position starts in Ermoupoli; SYC-308 gives the camera the same fallback.
 */
import { describe, expect, it } from 'vitest';
import { ERMOUPOLI } from '../island';
import {
  MAP_START_WAIT_MS,
  canCheckForMatches,
  isSpotterMove,
  mapStartHintKey,
  needsHelpCoords,
  nextMapStart,
  resolveMapStart,
  type MapStartInput,
  type ReadyMapStart,
} from '../mapStart';

const SYROS_FIX = { latitude: 37.4392, longitude: 24.9381 };
const MUNICH = { latitude: 48.137, longitude: 11.575 };

function phone(over: Partial<MapStartInput['phone']> = {}): MapStartInput['phone'] {
  return { coords: null, denied: false, loading: true, ...over };
}

describe('resolveMapStart: a library photo', () => {
  it('starts at the phone when the phone is on Syros', () => {
    expect(
      resolveMapStart({ source: 'library', phone: phone({ coords: SYROS_FIX, loading: false }), waitedMs: 0 }),
    ).toEqual({ status: 'ready', coords: SYROS_FIX, origin: 'phone' });
  });

  it('starts in Ermoupoli when the phone is in Munich', () => {
    expect(
      resolveMapStart({ source: 'library', phone: phone({ coords: MUNICH, loading: false }), waitedMs: 0 }),
    ).toEqual({ status: 'ready', coords: ERMOUPOLI, origin: 'town' });
  });

  it('starts in Ermoupoli when location is refused', () => {
    expect(
      resolveMapStart({ source: 'library', phone: phone({ denied: true, loading: false }), waitedMs: 0 }),
    ).toEqual({ status: 'ready', coords: ERMOUPOLI, origin: 'town' });
  });

  it('waits up to 4 seconds for a phone still searching, then starts in Ermoupoli', () => {
    expect(MAP_START_WAIT_MS).toBe(4000);
    expect(resolveMapStart({ source: 'library', phone: phone(), waitedMs: 3999 })).toEqual({
      status: 'waiting',
    });
    expect(resolveMapStart({ source: 'library', phone: phone(), waitedMs: 4000 })).toEqual({
      status: 'ready',
      coords: ERMOUPOLI,
      origin: 'town',
    });
  });

  it('gives a copy of Ermoupoli, so the screen cannot move the town itself', () => {
    const start = resolveMapStart({ source: 'library', phone: phone({ denied: true }), waitedMs: 0 });
    expect(start.status === 'ready' && start.coords).not.toBe(ERMOUPOLI);
  });
});

describe('resolveMapStart: the camera and live view (SYC-308)', () => {
  for (const source of ['camera', 'live'] as const) {
    it(`${source}: starts at the phone, wherever it is`, () => {
      expect(
        resolveMapStart({ source, phone: phone({ coords: SYROS_FIX, loading: false }), waitedMs: 0 }),
      ).toEqual({ status: 'ready', coords: SYROS_FIX, origin: 'phone' });
      expect(
        resolveMapStart({ source, phone: phone({ coords: MUNICH, loading: false }), waitedMs: 0 }),
      ).toEqual({ status: 'ready', coords: MUNICH, origin: 'phone' });
    });

    it(`${source}: refused location starts in Ermoupoli`, () => {
      expect(
        resolveMapStart({ source, phone: { coords: null, denied: true, loading: false }, waitedMs: 0 }),
      ).toEqual({ status: 'ready', coords: ERMOUPOLI, origin: 'town' });
    });

    it(`${source}: still searching after the wait starts in Ermoupoli`, () => {
      expect(
        resolveMapStart({ source, phone: phone(), waitedMs: MAP_START_WAIT_MS }),
      ).toEqual({ status: 'ready', coords: ERMOUPOLI, origin: 'town' });
    });

    it(`${source}: still searching before the wait waits`, () => {
      expect(
        resolveMapStart({ source, phone: phone({ denied: false }), waitedMs: 0 }),
      ).toEqual({ status: 'waiting' });
    });
  }
});

describe('nextMapStart: what replaces a start', () => {
  const town: ReadyMapStart = { status: 'ready', coords: { ...ERMOUPOLI }, origin: 'town' };
  const atPhone: ReadyMapStart = { status: 'ready', coords: SYROS_FIX, origin: 'phone' };

  it('takes the first ready start, and stays empty while waiting', () => {
    expect(nextMapStart(null, { status: 'waiting' }, false)).toBeNull();
    expect(nextMapStart(null, town, false)).toBe(town);
  });

  it('moves an Ermoupoli start to a late phone fix on Syros before the spotter touches the map', () => {
    expect(nextMapStart(town, atPhone, false)).toBe(atPhone);
  });

  it('does not move an Ermoupoli start once the spotter has touched the map', () => {
    expect(nextMapStart(town, atPhone, true)).toBe(town);
  });

  it('never replaces a start that came from the phone', () => {
    const later: ReadyMapStart = { status: 'ready', coords: { latitude: 37.45, longitude: 24.92 }, origin: 'phone' };
    expect(nextMapStart(atPhone, later, false)).toBe(atPhone);
    expect(nextMapStart(atPhone, town, false)).toBe(atPhone);
  });

  it('keeps the current start when the answer is still Ermoupoli or waiting', () => {
    expect(nextMapStart(town, { ...town, coords: { ...ERMOUPOLI } }, false)).toBe(town);
    expect(nextMapStart(town, { status: 'waiting' }, false)).toBe(town);
  });
});

describe('isSpotterMove: the map reporting its own start is not a touch', () => {
  it('ignores the echo of the start (the native map reports its first region)', () => {
    expect(isSpotterMove(ERMOUPOLI, { ...ERMOUPOLI })).toBe(false);
    expect(
      isSpotterMove(ERMOUPOLI, { latitude: ERMOUPOLI.latitude + 0.000001, longitude: ERMOUPOLI.longitude }),
    ).toBe(false);
  });

  it('counts a drag of a few metres as a touch', () => {
    expect(
      isSpotterMove(ERMOUPOLI, { latitude: ERMOUPOLI.latitude + 0.00005, longitude: ERMOUPOLI.longitude }),
    ).toBe(true);
    expect(
      isSpotterMove(ERMOUPOLI, { latitude: ERMOUPOLI.latitude, longitude: ERMOUPOLI.longitude - 0.00005 }),
    ).toBe(true);
  });
});

describe('the line under the map, and the button', () => {
  it('says "started in Ermoupoli" only for a town start', () => {
    expect(mapStartHintKey({ status: 'ready', coords: ERMOUPOLI, origin: 'town' })).toBe('mapStartedInTown');
    expect(mapStartHintKey({ status: 'ready', coords: SYROS_FIX, origin: 'phone' })).toBe(
      'confirmLocationHint',
    );
    expect(mapStartHintKey(null)).toBe('confirmLocationHint');
  });

  it('enables "Check for matches" once the start is ready, not while waiting', () => {
    expect(canCheckForMatches({ status: 'waiting' })).toBe(false);
    expect(canCheckForMatches(null)).toBe(false);
    expect(canCheckForMatches({ status: 'ready', coords: ERMOUPOLI, origin: 'town' })).toBe(true);
    expect(canCheckForMatches({ status: 'ready', coords: SYROS_FIX, origin: 'phone' })).toBe(true);
  });
});

describe('needsHelpCoords: the place handed to "This cat needs help" (review M1)', () => {
  const town: ReadyMapStart = { status: 'ready', coords: { ...ERMOUPOLI }, origin: 'town' };
  const atPhone: ReadyMapStart = { status: 'ready', coords: SYROS_FIX, origin: 'phone' };
  const dragged = { latitude: 37.4401, longitude: 24.9412 };

  it('is nothing while the map sits on an Ermoupoli start the spotter has not moved', () => {
    expect(needsHelpCoords(town, { ...ERMOUPOLI }, false)).toBeUndefined();
  });

  it('is the pin once the spotter has moved the map', () => {
    expect(needsHelpCoords(town, dragged, true)).toEqual(dragged);
  });

  it('is the pin for a start from the phone, moved or not', () => {
    expect(needsHelpCoords(atPhone, SYROS_FIX, false)).toEqual(SYROS_FIX);
  });

  it('is nothing with no pin', () => {
    expect(needsHelpCoords(null, null, false)).toBeUndefined();
  });
});
