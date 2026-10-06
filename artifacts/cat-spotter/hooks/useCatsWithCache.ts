import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { type Cat } from '@workspace/api-client-react';
import { useOffline } from '@/context/OfflineContext';
import {
  catalogueParams,
  catalogueQueryKey,
  fetchWholeCatalogue,
  forgetRetiredCatalogues,
  readCachedCatalogue,
  writeCachedCatalogue,
} from '@/lib/catalogue';

/**
 * The whole public cats list (every page, lib/catalogue.ts), backed by the
 * API when online and AsyncStorage when offline.
 */
export function useCatsWithCache(lat?: number, lng?: number): {
  cats: Cat[];
  isLoading: boolean;
  isOffline: boolean;
  refetch: () => void;
} {
  const { isOnline } = useOffline();
  const [cached, setCached] = useState<Cat[] | null>(null);

  const params = catalogueParams(lat, lng);

  const query = useQuery({
    queryKey: catalogueQueryKey(params),
    queryFn: () => fetchWholeCatalogue(params),
    enabled: isOnline,
    staleTime: 30_000,
  });

  // Earlier builds cached exact positions under the old key (data spine
  // PR 6): delete them once, never read them.
  useEffect(() => {
    void forgetRetiredCatalogues(AsyncStorage).catch(() => {});
  }, []);

  // Persist fresh results for offline use.
  useEffect(() => {
    if (query.data) {
      void writeCachedCatalogue(AsyncStorage, query.data).catch(() => {});
    }
  }, [query.data]);

  // Load the cache when offline (or before the first fetch resolves).
  useEffect(() => {
    if (!query.data) {
      void readCachedCatalogue(AsyncStorage)
        .then((cats) => {
          if (cats) setCached(cats);
        })
        .catch(() => {});
    }
  }, [query.data, isOnline]);

  return {
    cats: query.data ?? cached ?? [],
    isLoading: isOnline && query.isLoading && !cached,
    isOffline: !isOnline,
    refetch: () => void query.refetch(),
  };
}
