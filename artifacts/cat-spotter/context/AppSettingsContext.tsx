import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, getAppSettings, getSpotterSignals } from '@workspace/api-client-react';
import { useDevice } from '@/context/DeviceContext';
import {
  APP_SETTINGS_STORAGE_KEY,
  emptySettingsState,
  parseStoredSettings,
  settingsFromResponse,
  signalsAfterFirstSend,
  signalsFromResponse,
  type StoredSettings,
} from '@/lib/appSettings';
import { athensDay } from '@/lib/athensDay';
import type { SettingsView, Signals } from '@/lib/waitingCard';

/**
 * The match-wait switches and this phone's "resident" signals (SYC-36 /
 * SYC-48, match-wait plan PR 1).
 *
 * Fetched when the app starts, when it comes back to the foreground, when the
 * connection returns, after a claim and whenever the device id changes; the
 * last answers are kept on the phone, so a phone that has been online once
 * knows them offline. Everything about the phone is kept per device id and
 * starts again when the id changes ("Delete my data", a restore).
 *
 * A successful claim counts at once (`feeding-nudge.md` §3.2): this phone's
 * own list of claimed cats is read alongside the server's answer.
 */
interface AppSettingsValue {
  settings: SettingsView;
  /** The donation page's host, for "Opens {host} in your browser". */
  donateHost: string | null;
  signals: Signals;
  /** A send just came back: a phone with no first spot has one today. */
  noteSent: () => void;
}

const fallback: AppSettingsValue = {
  settings: emptySettingsState().settings,
  donateHost: null,
  signals: { status: 'unknown' },
  noteSent: () => undefined,
};

const AppSettingsContext = createContext<AppSettingsValue>(fallback);

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const { deviceId, ownedCatIds } = useDevice();
  const [stored, setStored] = useState<StoredSettings>(emptySettingsState);
  const deviceRef = useRef(deviceId);
  deviceRef.current = deviceId;

  const persist = useCallback((next: StoredSettings) => {
    setStored(next);
    AsyncStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  // The last answers, read once.
  useEffect(() => {
    AsyncStorage.getItem(APP_SETTINGS_STORAGE_KEY)
      .then((raw) => {
        const parsed = parseStoredSettings(raw);
        if (parsed) setStored((now) => (now.settings.loaded ? now : parsed));
      })
      .catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    let next: StoredSettings | null = null;
    try {
      const res = await getAppSettings();
      next = { ...stored, ...settingsFromResponse(res) };
    } catch {
      // Offline or a server error: keep what we had.
    }
    const id = deviceRef.current;
    if (id) {
      let signals: Signals | null = null;
      try {
        signals = signalsFromResponse(await getSpotterSignals(id));
      } catch (err) {
        // A refusal from the server (403 never bound, 410 deleted, 429) means
        // "unknown": no one-liner. No answer at all keeps the last one.
        if (err instanceof ApiError) signals = { status: 'unknown' };
      }
      if (signals && deviceRef.current === id) {
        next = { ...(next ?? stored), signalsFor: id, signals };
      }
    }
    if (next) persist(next);
  }, [persist, stored]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Start, device change, claim: ask again.
  useEffect(() => {
    void refreshRef.current();
  }, [deviceId, ownedCatIds.length]);

  // Foreground and reconnect: ask again.
  useEffect(() => {
    const appState = AppState.addEventListener?.('change', (s) => {
      if (s === 'active') void refreshRef.current();
    });
    const net = NetInfo.addEventListener((state) => {
      if (state.isConnected) void refreshRef.current();
    });
    return () => {
      appState?.remove?.();
      net();
    };
  }, []);

  const noteSent = useCallback(() => {
    if (stored.signalsFor !== deviceRef.current) return;
    const after = signalsAfterFirstSend(stored.signals, athensDay(Date.now()));
    if (after !== stored.signals) persist({ ...stored, signals: after });
  }, [persist, stored]);

  const value = useMemo<AppSettingsValue>(() => {
    // Only this device's signals count; another identity's are "unknown".
    let signals: Signals = stored.signalsFor === deviceId ? stored.signals : { status: 'unknown' };
    if (signals.status === 'known' && ownedCatIds.length > 0) signals = { ...signals, hasClaimedCat: true };
    return { settings: stored.settings, donateHost: stored.donateHost, signals, noteSent };
  }, [stored, deviceId, ownedCatIds.length, noteSent]);

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings(): AppSettingsValue {
  return useContext(AppSettingsContext);
}
