import type { SettingsView, Signals } from './waitingCard';

/**
 * The phone's copy of the match-wait switches and its own "resident" signals
 * (SYC-36 / SYC-48, match-wait plan PR 1), as pure functions so they are
 * tested without React. The context (context/AppSettingsContext.tsx) fetches,
 * stores and refreshes them.
 */

export const APP_SETTINGS_STORAGE_KEY = 'catSpotters.appSettings.v1';

export interface StoredSettings {
  settings: SettingsView;
  donateHost: string | null;
  /** Whose signals these are; another device id's are never used. */
  signalsFor: string | null;
  signals: Signals;
}

/** Before the switches have ever loaded: no link, nothing hidden (Samuel,
 * plan Decision 4), signals unknown (so no one-liner). */
export function emptySettingsState(): StoredSettings {
  return {
    settings: { loaded: false, linkOn: false, hiddenFacts: [] },
    donateHost: null,
    signalsFor: null,
    signals: { status: 'unknown' },
  };
}

export function settingsFromResponse(res: {
  feedNudge: { donateHost: string } | null;
  hiddenFacts: string[];
}): Pick<StoredSettings, 'settings' | 'donateHost'> {
  return {
    settings: {
      loaded: true,
      linkOn: res.feedNudge !== null,
      hiddenFacts: Array.isArray(res.hiddenFacts) ? res.hiddenFacts.filter((x) => typeof x === 'string') : [],
    },
    donateHost: res.feedNudge?.donateHost ?? null,
  };
}

export function signalsFromResponse(res: { hasClaimedCat: boolean; firstSpotDate: string | null }): Signals {
  return {
    status: 'known',
    hasClaimedCat: res.hasClaimedCat === true,
    firstSpotDate: typeof res.firstSpotDate === 'string' ? res.firstSpotDate : null,
  };
}

/** A phone whose first spot just arrived has a first-spot day: today. */
export function signalsAfterFirstSend(signals: Signals, today: string): Signals {
  if (signals.status === 'known' && signals.firstSpotDate === null) {
    return { ...signals, firstSpotDate: today };
  }
  return signals;
}

/** The stored copy, or null if it's missing or not this shape. */
export function parseStoredSettings(raw: string | null): StoredSettings | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as StoredSettings;
    if (
      typeof v === 'object' && v !== null &&
      typeof v.settings?.loaded === 'boolean' &&
      typeof v.settings?.linkOn === 'boolean' &&
      Array.isArray(v.settings?.hiddenFacts) &&
      (v.signals?.status === 'known' || v.signals?.status === 'unknown')
    ) {
      return v;
    }
    return null;
  } catch {
    return null;
  }
}
