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
  nextSpotBringsNewFact as nextSpotBringsNewFactFor,
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
  /** SYC-186: the item was kept when sent live, so it is not "a spot saved for later". */
  keptAtSend?: boolean;
  screen: ResultScreen;
}): { show: ResultNudge; dismiss: () => void; help: () => void; nextSpotBringsNewFact: boolean } {
  const { settings, signals } = useAppSettings();
  const [show, setShow] = useState<ResultNudge>(null);
  // SYC-772 spec §3.3: whether the next wait would show a fact this phone hasn't seen.
  const [nextFact, setNextFact] = useState(false);
  const decided = useRef(false);
  // The latest values, read when the decision is made (once).
  const latest = useRef({ ...input, settings, signals });
  latest.current = { ...input, settings, signals };
  const { deviceId, sightingId } = input;

  useEffect(() => {
    // Decide once, as soon as the phone's id and the sighting are known. No
    // "still mounted" flag: in a development build React mounts twice, and
    // the first run's answer must still be shown (setShow after an unmount is
    // ignored by React).
    // One decision per mounted screen: a new result is a new /review screen
    // (expo-router pushes it), so a changed sighting here is never decided.
    if (decided.current || !deviceId || sightingId === null) return;
    decided.current = true;
    const { localId: itemId, keptAtSend, screen, settings: s, signals: g } = latest.current;
    // A spot kept at send is a live send: only one saved for later never shows the nudge.
    const localId = keptAtSend ? undefined : itemId;
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
      setShow(out.show);
      // From the same read, after any save: no second read, no extra save (spec §5.1).
      setNextFact(
        nextSpotBringsNewFactFor(out.record ?? record, s, { nudgeEnabled: NUDGE_ENABLED, signedInRole: null }),
      );
    })().catch(() => undefined);
  }, [deviceId, sightingId]);

  const dismiss = useCallback(() => setShow(null), []);

  const help = useCallback(() => {
    setShow(null);
    const id = latest.current.deviceId;
    // The phone's own browser, never a page inside the app (Apple 3.2.2(iv)).
    // The tap counts (no more daily reminders) only once the browser opened.
    Linking.openURL(feedLinkUrl())
      .then(async () => {
        if (!id) return;
        const record = await loadExistingWaitingRecord(AsyncStorage, id);
        if (record) await saveWaitingRecord(AsyncStorage, id, markTapped(record));
      })
      .catch(() => undefined);
  }, []);

  return { show, dismiss, help, nextSpotBringsNewFact: nextFact };
}
