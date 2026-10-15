import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { customFetch } from '@workspace/api-client-react';

const KEY = 'cat-spotter/reporter-email-on';

/**
 * Whether the report flow may offer "Shall we tell you what happens?"
 * (SYC-42 Slice 3). Only once the server says the "is this you?" email can
 * actually go (GET /api/reports/options), so nobody is promised a reply that
 * can't come. The last answer is remembered, so the box is there with no
 * signal too (email-capture.md §4.3: capture works offline); never shown
 * before the server has said yes once.
 */
export function useReporterEmailOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if ((await AsyncStorage.getItem(KEY)) === 'true' && !cancelled) setOn(true);
      } catch {
        // No storage: wait for the server.
      }
      const res = await customFetch<{ reporterEmail?: unknown }>('/api/reports/options', { responseType: 'json' });
      const next = res?.reporterEmail === true;
      if (!cancelled) setOn(next);
      await AsyncStorage.setItem(KEY, next ? 'true' : 'false').catch(() => undefined);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return on;
}
