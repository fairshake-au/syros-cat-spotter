import { useQuery } from '@tanstack/react-query';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { getKeepSafe } from '@/lib/keepSafe';

export const KEEP_SAFE_QUERY_ROOT = ['keep-safe'] as const;

/**
 * This phone's "keep my spots safe" state (SYC-3), from one cached query that
 * Settings and the Home Screen card share. Needs a connection and a device id,
 * never a username: a spotter restored without one must still see Settings
 * (review of #109). Callers narrow it further with `enabled`.
 */
export function useKeepSafeState(opts: { enabled?: boolean } = {}) {
  const { deviceId } = useDevice();
  const { isOnline } = useOffline();
  return useQuery({
    queryKey: [...KEEP_SAFE_QUERY_ROOT, deviceId],
    queryFn: () => getKeepSafe(deviceId!),
    enabled: (opts.enabled ?? true) && !!deviceId && isOnline,
  });
}
