import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, getAppSettings, getSpotterSignals } from '@workspace/api-client-react';
import { useDevice } from '@/context/DeviceContext';
import {
  APP_SETTINGS_STORAGE_KEY,
  emptySettingsState,
  isRefusal,
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
 * connection comes back (not on every network wobble), after a claim, after a
 * phone's first send, and whenever the device id changes. One fetch at a
 * time. The last answers are kept on the phone, so a phone that has been
 * online once knows them offline.
 *
 * Every change starts from the latest values (a ref), never from the copy a
 * render happened to capture, so a slow answer can't save over a newer one.
 * Signals belong to one device id: when the id changes ("Delete my data", a
 * restore) they are forgotten at once, in memory and on the phone.
 *
 * A refusal from the server (401, 403 never bound, 410 deleted, 429) means
 * "unknown": no one-liner. A failure without an answer, or a 5xx, keeps the
 * last answer. A successful claim counts at once (`feeding-nudge.md` §3.2).
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
  const storedRef = useRef(stored);
  const deviceRef = useRef(deviceId);
  deviceRef.current = deviceId;
  const inFlight = useRef<Promise<void> | null>(null);

  /** Apply a change to the latest values, then show and save the result. */
  const update = useCallback((change: (prev: StoredSettings) => StoredSettings) => {
    const next = change(storedRef.current);
    if (next === storedRef.current) return;
    storedRef.current = next;
    setStored(next);
    AsyncStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  // The last answers, read once; they never replace an answer already fetched.
  useEffect(() => {
    AsyncStorage.getItem(APP_SETTINGS_STORAGE_KEY)
      .then((raw) => {
        const saved = parseStoredSettings(raw);
        if (!saved) return;
        const now = storedRef.current;
        const merged: StoredSettings = {
          settings: now.settings.loaded ? now.settings : saved.settings,
          donateHost: now.settings.loaded ? now.donateHost : saved.donateHost,
          signalsFor: now.signalsFor ?? saved.signalsFor,
          signals: now.signalsFor ? now.signals : saved.signals,
        };
        storedRef.current = merged;
        setStored(merged);
      })
      .catch(() => undefined);
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const res = await getAppSettings();
        update((prev) => ({ ...prev, ...settingsFromResponse(res) }));
      } catch {
        // No answer, or a server error: keep what we had.
      }
      const id = deviceRef.current;
      if (!id) return;
      let signals: Signals | null = null;
      try {
        signals = signalsFromResponse(await getSpotterSignals(id));
      } catch (err) {
        if (err instanceof ApiError && isRefusal(err.status)) signals = { status: 'unknown' };
      }
      if (signals && deviceRef.current === id) {
        const answer = signals;
        update((prev) => ({ ...prev, signalsFor: id, signals: answer }));
      }
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, [update]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // A new device id: forget the old one's signals at once, then ask again.
  useEffect(() => {
    update((prev) =>
      prev.signalsFor !== null && prev.signalsFor !== deviceId
        ? { ...prev, signalsFor: null, signals: { status: 'unknown' } }
        : prev,
    );
    void refreshRef.current();
  }, [deviceId, update]);

  // A claim: ask again (the claim already counts locally, below).
  const ownedCount = ownedCatIds.length;
  const firstOwned = useRef(true);
  useEffect(() => {
    if (firstOwned.current) {
      firstOwned.current = false;
      return;
    }
    void refreshRef.current();
  }, [ownedCount]);

  // Foreground, and the connection coming back (not every change of signal
  // strength: NetInfo reports those too).
  useEffect(() => {
    let connected: boolean | null = null;
    const appState = AppState.addEventListener?.('change', (s) => {
      if (s === 'active') void refreshRef.current();
    });
    const net = NetInfo.addEventListener((state) => {
      const now = state.isConnected === true;
      if (connected === false && now) void refreshRef.current();
      connected = now;
    });
    return () => {
      appState?.remove?.();
      net();
    };
  }, []);

  const noteSent = useCallback(() => {
    const id = deviceRef.current;
    const now = storedRef.current;
    if (now.signalsFor === id && now.signals.status === 'known') {
      update((prev) => ({ ...prev, signals: signalsAfterFirstSend(prev.signals, athensDay(Date.now())) }));
    } else {
      // A brand-new phone binds on its first send, so its signals can only be
      // read after it: ask now (feeding-nudge.md §3.2).
      void refreshRef.current();
    }
  }, [update]);

  const value = useMemo<AppSettingsValue>(() => {
    // Only this device's signals count; another identity's are "unknown".
    let signals: Signals = stored.signalsFor === deviceId ? stored.signals : { status: 'unknown' };
    if (signals.status === 'known' && ownedCount > 0) signals = { ...signals, hasClaimedCat: true };
    return { settings: stored.settings, donateHost: stored.donateHost, signals, noteSent };
  }, [stored, deviceId, ownedCount, noteSent]);

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings(): AppSettingsValue {
  return useContext(AppSettingsContext);
}
