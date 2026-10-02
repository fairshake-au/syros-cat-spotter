import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { customFetch } from '@workspace/api-client-react';
import type { GuidanceLanguage } from '@workspace/welfare-guidance';
import { useLanguage } from '@/context/LanguageContext';
import {
  builtInGuidance,
  loadGuidance,
  refreshGuidance,
  type LoadedGuidance,
} from '@/lib/welfareGuidanceCache';

/**
 * The injured-cat advice and vet list for the reader's language (SYC-42 plan
 * items 1.10, 1.14). Starts with the copy built into the app, so something
 * correct is on screen instantly and with no signal; then the last saved
 * version; then the server's, if it can be reached.
 */
export function useWelfareGuidance(): LoadedGuidance {
  const { language } = useLanguage();
  const lang = language as GuidanceLanguage;
  const [guidance, setGuidance] = useState<LoadedGuidance>(() => builtInGuidance(lang));

  useEffect(() => {
    let cancelled = false;
    setGuidance(builtInGuidance(lang));
    (async () => {
      const saved = await loadGuidance(lang, AsyncStorage);
      if (!cancelled) setGuidance(saved);
      const fresh = await refreshGuidance(lang, AsyncStorage, (l) =>
        customFetch(`/api/welfare/guidance?lang=${l}`, { responseType: 'json' }),
      );
      if (!cancelled && fresh) setGuidance(fresh);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lang]);

  return guidance;
}
