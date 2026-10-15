import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppSettings } from '@/context/AppSettingsContext';
import { athensDay } from '@/lib/athensDay';
import { apiOrigin } from '@/lib/urls';
import {
  NUDGE_ENABLED,
  chooseForResult,
  markTapped,
  type NudgeForm,
  type ResultScreen,
} from '@/lib/waitingCard';
import { loadExistingWaitingRecord, saveWaitingRecord } from '@/lib/waitingCardStore';

export type ResultNudge = { kind: 'nudge'; form: NudgeForm } | { kind: 'line' } | null;

/** The counting address "Help feed a cat" opens (plan PR 1, /api/go/feed). */
export function feedLinkUrl(): string {
  return `${apiOrigin()}/api/go/feed`;
}

/**
 * The feeding nudge or the visitor's one-liner on the first result screen
 * (SYC-36; feeding-nudge.md §3.2–3.3; match-wait plan PR 2).
 *
 * Decided once, when the screen opens, from the phone's record: only for the
 * live send that just came back (its `pendingResult`), never for a queued
 * sighting matched later, never on the no-cat screen. Counted as it appears.
 * It stays until "Got it", "Help feed a cat", or leaving; a reload doesn't
 * bring it back, because the record's `pendingResult` is used up.
 */
export function useResultNudge(input: {
  deviceId: string | null;
  sightingId: number | null;
  localId?: string;
  screen: ResultScreen;
}): { show: ResultNudge; dismiss: () => void; help: () => void } {
  const { settings, signals } = useAppSettings();
  const [show, setShow] = useState<ResultNudge>(null);
  const decided = useRef(false);
  // The first values only: the decision is made once.
  const first = useRef({ ...input, settings, signals });

  useEffect(() => {
    if (decided.current) return;
    decided.current = true;
    const { deviceId, sightingId, localId, screen, settings: s, signals: g } = first.current;
    if (!deviceId || sightingId === null) return;
    let alive = true;
    void (async () => {
      const record = await loadExistingWaitingRecord(AsyncStorage, deviceId);
      if (!record) return;
      const out = chooseForResult(
        record,
        s,
        g,
        { signedInRole: null, nudgeEnabled: NUDGE_ENABLED, today: athensDay(Date.now()), random: Math.random },
        { sightingId, localId, screen },
      );
      if (out.record && out.record !== record) await saveWaitingRecord(AsyncStorage, deviceId, out.record);
      if (alive) setShow(out.show);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const dismiss = useCallback(() => setShow(null), []);

  const help = useCallback(() => {
    setShow(null);
    const deviceId = first.current.deviceId;
    if (deviceId) {
      void (async () => {
        const record = await loadExistingWaitingRecord(AsyncStorage, deviceId);
        if (record) await saveWaitingRecord(AsyncStorage, deviceId, markTapped(record));
      })().catch(() => undefined);
    }
    // The phone's own browser, never a page inside the app (Apple 3.2.2(iv)).
    Linking.openURL(feedLinkUrl()).catch(() => undefined);
  }, []);

  return { show, dismiss, help };
}
