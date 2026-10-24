import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { type Cat } from '@workspace/api-client-react';
import { catalogueQueryKey, fetchWholeCatalogue } from '@/lib/catalogue';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { catDisplayName } from '@/lib/catDisplayName';

const SNAPSHOT_KEY = 'cat-spotter/ownership-snapshot';

interface OwnershipSnapshotEntry {
  name: string;
  hasHome: boolean;
}

type Snapshot = Record<string, OwnershipSnapshotEntry>;

/**
 * In-app "[Name] now has a home!" notice. Real Expo push delivery covers
 * devices with a registered push token, but pushes can be missed (permission
 * denied, simulators, Expo Go limits), so on app open we also compare the
 * catalog's ownership state against the last snapshot this device saw; a cat
 * that gained an owner (or was renamed while owned) since then triggers a
 * tappable banner that opens the cat's detail screen. The device's own
 * claims are excluded.
 *
 * Mounted via BannerStack in app/_layout.tsx, which owns positioning
 * (safe-area offset, stacking with the other banners).
 */
export function OwnershipNoticeBanner() {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();
  const { isOnline } = useOffline();
  const { ownedCatIds, isReady } = useDevice();

  const [notice, setNotice] = useState<{ catId: number; name: string } | null>(
    null,
  );
  const [checked, setChecked] = useState(false);

  // The whole catalogue, every page (lib/catalogue.ts), under the same key
  // as useCatsWithCache() so the two share one fetch.
  const query = useQuery({
    queryKey: catalogueQueryKey(),
    queryFn: () => fetchWholeCatalogue(),
    enabled: isOnline && isReady && !checked,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (checked || !query.data) return;
    setChecked(true);
    const cats: Cat[] = query.data;

    (async () => {
      const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
      let prev: Snapshot | null = null;
      if (raw) {
        try {
          prev = JSON.parse(raw) as Snapshot;
        } catch {
          prev = null;
        }
      }

      const next: Snapshot = {};
      for (const cat of cats) {
        next[String(cat.id)] = {
          name: cat.name,
          hasHome: cat.hasHome,
        };
      }
      await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(next));

      // First run: nothing to compare against.
      if (!prev) return;

      for (const cat of cats) {
        if (ownedCatIds.includes(cat.id)) continue; // own claims
        const before = prev[String(cat.id)];
        if (!before) continue; // never seen this cat before
        // Snapshots written before the owner-name removal stored `ownerName`
        // instead of `hasHome`; treat those as homed to avoid a false
        // "now has a home!" banner right after the app update.
        const beforeHasHome =
          before.hasHome ??
          !!(before as { ownerName?: string | null }).ownerName;
        const newlyClaimed = !beforeHasHome && cat.hasHome;
        const renamedWhileOwned = cat.hasHome && before.name !== cat.name;
        if (newlyClaimed || renamedWhileOwned) {
          setNotice({ catId: cat.id, name: catDisplayName(cat, t) });
          return; // one banner at a time is enough
        }
      }
    })();
  }, [checked, query.data, ownedCatIds]);

  if (!notice) return null;

  const open = () => {
    const { catId } = notice;
    setNotice(null);
    router.push({ pathname: '/cat/[id]', params: { id: String(catId) } });
  };

  return (
    <Pressable
      onPress={open}
      style={[
        styles.banner,
        {
          backgroundColor: colors.primary,
          shadowColor: '#000',
        },
      ]}
    >
      <Feather name="home" size={16} color={colors.primaryForeground} />
      <Text style={[styles.text, { color: colors.primaryForeground }]}>
        {t('hasHomeToast').replace('{name}', notice.name)}
      </Text>
      <Pressable
        onPress={() => setNotice(null)}
        accessibilityRole="button"
        accessibilityLabel={t('homeScreenNudgeDismissLabel')}
        style={styles.closeHit}
      >
        <Feather name="x" size={16} color={colors.primaryForeground} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // SYC-509: 44pt tap area around the 16pt close icon; the negative margins keep the row height without covering the text beside it.
  closeHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginVertical: -14, marginHorizontal: -4 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    // SYC-128: at least a 44px tap target (was 42px with one line of text).
    minHeight: 44,
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
});
