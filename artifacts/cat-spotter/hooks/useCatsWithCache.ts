import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Cat } from '@workspace/api-client-react';
import { useOffline } from '@/context/OfflineContext';
import {
  CATALOGUE_QUERY_ROOT,
  catalogueParams,
  catalogueQueryKey,
  fetchWholeCatalogue,
  forgetRetiredCatalogues,
  readCachedCatalogue,
  writeCachedCatalogue,
} from '@/lib/catalogue';
import { LOAD_QUERY_OPTIONS } from '@/lib/loadTiming';

/**
 * The whole public cats list (every page, lib/catalogue.ts), backed by the
 * API when online and AsyncStorage when offline.
 *
 * SYC-508 (couldnt-load-try-again.md §3.1): `loadFailed` says the list is
 * empty because nothing could be loaded, not because there are no cats. It is
 * true only once the phone's saved copy has been read and had no cats, and the
 * request failed or the phone is offline. A saved empty list counts as
 * nothing saved, and an empty list is never saved.
 */
export function useCatsWithCache(lat?: number, lng?: number): {
  cats: Cat[];
  isLoading: boolean;
  isOffline: boolean;
  loadFailed: boolean;
  /** Try again: this screen's list, then every other screen's. Settles either way. */
  retry: () => Promise<void>;
} {
  const { isOnline } = useOffline();
  const queryClient = useQueryClient();
  const [cached, setCached] = useState<Cat[] | null>(null);
  const [cacheChecked, setCacheChecked] = useState(false);

  const params = catalogueParams(lat, lng);
  const queryKey = catalogueQueryKey(params);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchWholeCatalogue(params),
    enabled: isOnline,
    staleTime: 30_000,
    ...LOAD_QUERY_OPTIONS,
  });

  // Earlier builds cached exact positions under the old key (data spine
  // PR 6): delete them once, never read them.
  useEffect(() => {
    void forgetRetiredCatalogues(AsyncStorage).catch(() => {});
  }, []);

  // Persist fresh results for offline use. An empty list would later read as
  // "no cats" after a failed load, so it is never saved.
  useEffect(() => {
    if (query.data && query.data.length > 0) {
      void writeCachedCatalogue(AsyncStorage, query.data).catch(() => {});
    }
  }, [query.data]);

  // Load the cache when offline (or before the first fetch resolves). A read
  // that finds nothing, or throws, still counts as checked.
  useEffect(() => {
    if (!query.data) {
      void readCachedCatalogue(AsyncStorage)
        .then((cats) => {
          if (cats && cats.length > 0) setCached(cats);
        })
        .catch(() => {})
        .finally(() => setCacheChecked(true));
    }
  }, [query.data, isOnline]);

  const { refetch } = query;
  const keyHash = JSON.stringify(queryKey);
  const retry = useCallback(async () => {
    // refetch() runs even while the query is switched off for being offline.
    await refetch();
    // The other screens' lists (other positions) refresh too, without
    // fetching this one twice.
    await queryClient
      .invalidateQueries({
        queryKey: CATALOGUE_QUERY_ROOT,
        predicate: (q) => JSON.stringify(q.queryKey) !== keyHash,
      })
      .catch(() => {});
  }, [refetch, queryClient, keyHash]);

  const nothing = !query.data && cached === null;
  return {
    cats: query.data ?? cached ?? [],
    // Until the saved copy has been read, nothing is decided: a spinner, never
    // a flash of "no cats" or "couldn't load".
    isLoading: (isOnline && query.isLoading && !cached) || (nothing && !cacheChecked),
    isOffline: !isOnline,
    loadFailed: nothing && cacheChecked && (query.isError || !isOnline),
    retry,
  };
}
