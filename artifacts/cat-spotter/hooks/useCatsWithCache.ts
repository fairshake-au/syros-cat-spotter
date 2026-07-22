import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useListCats, getListCatsQueryKey, type Cat } from '@workspace/api-client-react';
import { useOffline } from '@/context/OfflineContext';

const CACHE_KEY = 'cat-spotter/cats-cache';

/**
 * Cats list backed by the API when online and AsyncStorage when offline.
 */
export function useCatsWithCache(lat?: number, lng?: number): {
  cats: Cat[];
  isLoading: boolean;
  isOffline: boolean;
  refetch: () => void;
} {
  const { isOnline } = useOffline();
  const [cached, setCached] = useState<Cat[] | null>(null);

  const params =
    lat !== undefined && lng !== undefined ? { lat, lng } : undefined;

  const query = useListCats(params, {
    query: {
      enabled: isOnline,
      queryKey: getListCatsQueryKey(params),
      staleTime: 30_000,
    },
  });

  // Persist fresh results for offline use.
  useEffect(() => {
    if (query.data) {
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(query.data));
    }
  }, [query.data]);

  // Load the cache when offline (or before the first fetch resolves).
  useEffect(() => {
    if (!query.data) {
      AsyncStorage.getItem(CACHE_KEY).then((raw) => {
        if (raw) {
          try {
            setCached(JSON.parse(raw) as Cat[]);
          } catch {
            // ignore corrupt cache
          }
        }
      });
    }
  }, [query.data, isOnline]);

  return {
    cats: query.data ?? cached ?? [],
    isLoading: isOnline && query.isLoading && !cached,
    isOffline: !isOnline,
    refetch: query.refetch,
  };
}
