import { describe, expect, it } from 'vitest';
import {
  emptySettingsState,
  parseStoredSettings,
  settingsFromResponse,
  signalsAfterFirstSend,
  signalsFromResponse,
} from '../appSettings';

// SYC-36 / SYC-48 (match-wait plan PR 1): the phone's copy of the switches
// and its resident signals.

describe("the phone's copy of the switches", () => {
  it('before they ever load: no link, nothing hidden (Decision 4), signals unknown', () => {
    expect(emptySettingsState()).toEqual({
      settings: { loaded: false, linkOn: false, hiddenFacts: [], extraPhotosOn: false },
      donateHost: null,
      signalsFor: null,
      signals: { status: 'unknown' },
    });
  });

  it('reads the server\'s answer', () => {
    expect(settingsFromResponse({ feedNudge: { donateHost: 'syroscats.com' }, hiddenFacts: ['fact.cost'] })).toEqual({
      settings: { loaded: true, linkOn: true, hiddenFacts: ['fact.cost'], extraPhotosOn: false },
      donateHost: 'syroscats.com',
    });
    expect(settingsFromResponse({ feedNudge: null, hiddenFacts: [] }).settings.linkOn).toBe(false);
  });

  it('reads the signals', () => {
    expect(signalsFromResponse({ hasClaimedCat: false, firstSpotDate: '2026-07-01' })).toEqual({
      status: 'known',
      hasClaimedCat: false,
      firstSpotDate: '2026-07-01',
    });
  });

  it('a first send gives a phone with no first spot today\'s date, and nothing else changes', () => {
    const none = signalsFromResponse({ hasClaimedCat: false, firstSpotDate: null });
    expect(signalsAfterFirstSend(none, '2026-07-10')).toEqual({ ...none, firstSpotDate: '2026-07-10' });
    const some = signalsFromResponse({ hasClaimedCat: false, firstSpotDate: '2026-07-01' });
    expect(signalsAfterFirstSend(some, '2026-07-10')).toBe(some);
    expect(signalsAfterFirstSend({ status: 'unknown' }, '2026-07-10')).toEqual({ status: 'unknown' });
  });

  it('a stored copy round-trips; junk reads as nothing', () => {
    const s = { ...emptySettingsState(), settings: { loaded: true, linkOn: true, hiddenFacts: [], extraPhotosOn: true } };
    expect(parseStoredSettings(JSON.stringify(s))).toEqual(s);
    expect(parseStoredSettings('{nope')).toBeNull();
    expect(parseStoredSettings(JSON.stringify({ settings: {} }))).toBeNull();
    expect(parseStoredSettings(null)).toBeNull();
  });
});

describe('SYC-415: the extra-photos switch', () => {
  it('is on only when the server says extraPhotos: true', () => {
    expect(settingsFromResponse({ feedNudge: null, hiddenFacts: [], extraPhotos: true }).settings.extraPhotosOn).toBe(true);
    expect(settingsFromResponse({ feedNudge: null, hiddenFacts: [], extraPhotos: false }).settings.extraPhotosOn).toBe(false);
    expect(settingsFromResponse({ feedNudge: null, hiddenFacts: [] }).settings.extraPhotosOn).toBe(false);
  });

  it('is off before the switches ever load', () => {
    expect(emptySettingsState().settings.extraPhotosOn).toBe(false);
  });

  it('an old stored copy with no extraPhotosOn is still accepted, and reads as off', () => {
    const old = {
      settings: { loaded: true, linkOn: true, hiddenFacts: [] },
      donateHost: null,
      signalsFor: null,
      signals: { status: 'unknown' },
    };
    const parsed = parseStoredSettings(JSON.stringify(old));
    expect(parsed).not.toBeNull();
    expect(parsed!.settings.extraPhotosOn).toBe(false);
    expect(parsed!.settings.linkOn).toBe(true);
  });

  it('a stored copy with something odd in extraPhotosOn reads as off', () => {
    const odd = { ...emptySettingsState(), settings: { loaded: true, linkOn: false, hiddenFacts: [], extraPhotosOn: 'yes' } };
    expect(parseStoredSettings(JSON.stringify(odd))!.settings.extraPhotosOn).toBe(false);
  });
});
