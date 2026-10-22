import React from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getGetCatQueryKey, useGetCat, type Cat } from '@workspace/api-client-react';
import { useDevice } from '@/context/DeviceContext';
import { canSpotFromPage, nextHint, readHintParam, type HintEvent } from '@/lib/spotHint';

/**
 * The Spot screen's hint (SYC-574, design-review-fixes-oct22.md §2.2).
 *
 * - Reads the `for` route param, copies it into state, and clears the param
 *   at once with `router.setParams({ for: undefined })`, so the hint never
 *   comes back through the tab bar or the browser history.
 * - Leaving the tab drops it unless a photo is staged (`hasPhoto`).
 * - Loads the cat for the banner with the same query key as the cat page, so
 *   the page the spotter just left answers it, signal or not. A cat in care or
 *   one that has died drops the hint.
 *
 * Nothing here is ever sent with the sighting.
 */
export function useSpotHint(hasPhoto: boolean): {
  hintCatId: number | null;
  /** The hinted cat, once known. The banner shows only then. */
  hintCat: Cat | null;
  dispatch: (event: HintEvent) => void;
} {
  const router = useRouter();
  const params = useLocalSearchParams<{ for?: string }>();
  const [hintCatId, setHintCatId] = React.useState<number | null>(null);
  const dispatch = React.useCallback(
    (event: HintEvent) => setHintCatId((current) => nextHint(current, event)),
    [],
  );

  const raw = params.for;
  React.useEffect(() => {
    if (raw === undefined) return;
    const id = readHintParam(raw);
    if (id !== null) dispatch({ kind: 'arrive', catId: id });
    // Cleared even when it was not a cat id: nothing in the address revives it.
    try {
      router.setParams({ for: undefined });
    } catch {
      // The hint is already in state.
    }
  }, [raw, router, dispatch]);

  // Read at blur time, not when the effect was made.
  const hasPhotoRef = React.useRef(hasPhoto);
  hasPhotoRef.current = hasPhoto;
  useFocusEffect(
    React.useCallback(
      () => () => dispatch({ kind: 'leaveTab', hasPhoto: hasPhotoRef.current }),
      [dispatch],
    ),
  );

  const { deviceId, isReady, startupError } = useDevice();
  const deviceKnown = isReady || startupError !== null;
  const id = hintCatId ?? 0;
  const query = useGetCat(id, {
    query: {
      enabled: hintCatId !== null && deviceKnown,
      // The cat page's own key, so its answer is reused.
      queryKey: [...getGetCatQueryKey(id), deviceId],
    },
    request: deviceId !== null ? { headers: { 'X-Device-Id': deviceId } } : undefined,
  });
  const loaded = hintCatId !== null && query.data?.cat?.id === hintCatId ? query.data.cat : null;
  const unspottable = loaded !== null && !canSpotFromPage(loaded.lifeStatus);
  React.useEffect(() => {
    if (unspottable) dispatch({ kind: 'notSpottable' });
  }, [unspottable, dispatch]);

  return { hintCatId, hintCat: unspottable ? null : loaded, dispatch };
}
