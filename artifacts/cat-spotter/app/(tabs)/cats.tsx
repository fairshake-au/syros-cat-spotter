import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import colorsConst from '@/constants/colors';
import { fonts, fontSizes, radii, spacing, borderWidths } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { useLocation } from '@/hooks/useLocation';
import { useCatsWithCache } from '@/hooks/useCatsWithCache';
import { OfflineBanner } from '@/components/OfflineBanner';
import { CatCard } from '@/components/CatCard';
import { AppMap } from '@/components/AppMap';
import { NotificationBell } from '@/components/NotificationBell';
import { Chip } from '@/components/purropolis';
import { absoluteUrl, SYROS_CENTER } from '@/lib/urls';
import {
  useGetProfile,
  getGetProfileQueryKey,
} from '@workspace/api-client-react';

/** CatCard's own corner radius — the lock overlay has to match it exactly. */
const catCardRadius = colorsConst.radius;

/**
 * Cat-alog filters. `owned` and `nearby` are computed from data we actually
 * have. The design also shows "Needs vet" / "Desexed" filters, but health
 * status is not modelled on cats yet (tracked separately), so those two are
 * deliberately absent rather than rendered as controls that do nothing.
 */
type FilterKey = 'all' | 'nearby' | 'homed';

/** Cats within this radius count as "near me". */
const NEARBY_KM = 1.5;

export default function CatalogScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { coords } = useLocation();
  const { cats, isLoading } = useCatsWithCache(
    coords?.latitude,
    coords?.longitude,
  );
  const { deviceId } = useDevice();
  const { isOnline } = useOffline();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [showMap, setShowMap] = useState(false);

  const profileQuery = useGetProfile(deviceId ?? '', {
    query: {
      enabled: !!deviceId && isOnline,
      queryKey: getGetProfileQueryKey(deviceId ?? ''),
    },
  });
  const profile = profileQuery.data;
  // Mirror Home's guard exactly: an older server can return a profile
  // without `spottedCatIds`, so locks must depend on the array actually
  // being present, not just on the profile existing.
  const hasCollectionData = Array.isArray(profile?.spottedCatIds);
  const spottedIds = useMemo(
    () => new Set(profile?.spottedCatIds ?? []),
    [profile?.spottedCatIds],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cats.filter((c) => {
      if (q) {
        const haystack = [c.name, c.description, String(c.id)]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filter === 'nearby') {
        // distanceKm is only present when the list was fetched with coords.
        return c.distanceKm != null && c.distanceKm <= NEARBY_KM;
      }
      if (filter === 'homed') return !!c.ownerName;
      return true;
    });
  }, [cats, search, filter]);

  const initialRegion = useMemo(
    () => ({
      latitude: coords?.latitude ?? SYROS_CENTER.latitude,
      longitude: coords?.longitude ?? SYROS_CENTER.longitude,
      latitudeDelta: 0.06,
      longitudeDelta: 0.06,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coords === null],
  );

  const filters: { key: FilterKey; label: string }[] = [
    { key: 'all', label: t('filterAll') },
    { key: 'nearby', label: t('filterNearMe') },
    { key: 'homed', label: t('filterHasHome') },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <View style={styles.titleBlock}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t('catalogTitle')}
            </Text>
            <Text style={[styles.count, { color: colors.mutedForeground }]}>
              {t('catalogCount').replace('{n}', String(cats.length))}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => setShowMap((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={showMap ? t('viewList') : t('viewMap')}
              style={[
                styles.toggle,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              <Feather
                name={showMap ? 'list' : 'map'}
                size={16}
                color={colors.foreground}
              />
              <Text style={[styles.toggleText, { color: colors.foreground }]}>
                {showMap ? t('viewList') : t('viewMap')}
              </Text>
            </Pressable>
            <NotificationBell />
          </View>
        </View>

        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('catalogSearchPlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {search.length > 0 && (
            <Pressable
              onPress={() => setSearch('')}
              accessibilityRole="button"
              accessibilityLabel={t('clear')}
            >
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {filters.map((f) => (
            <Chip
              key={f.key}
              label={f.label}
              active={filter === f.key}
              onPress={() => setFilter(f.key)}
            />
          ))}
        </ScrollView>
      </View>

      <OfflineBanner />

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : showMap ? (
        // AppMap pins its marker strip to the bottom of its own box, so the box
        // has to stop above the tab bar or the strip hides behind it.
        <View
          style={{
            flex: 1,
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 100 : 90),
          }}
        >
          <AppMap
            key={coords ? 'located' : 'default'}
            latitude={initialRegion.latitude}
            longitude={initialRegion.longitude}
            latitudeDelta={initialRegion.latitudeDelta}
            longitudeDelta={initialRegion.longitudeDelta}
            showsUserLocation
            markerBorderColor={colors.primary}
            markers={filtered.map((cat) => ({
              id: String(cat.id),
              latitude: cat.lat,
              longitude: cat.lng,
              title: cat.name,
              imageUrl: absoluteUrl(cat.photoUrl),
              onPress: () =>
                router.push({
                  pathname: '/cat/[id]',
                  params: { id: String(cat.id) },
                }),
            }))}
          />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon} allowFontScaling={false}>
            🐾
          </Text>
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            {filter === 'nearby' && !coords
              ? t('filterNeedsLocation')
              : cats.length === 0
                ? t('noCats')
                : t('noCatsSearch')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => String(c.id)}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={{
            padding: spacing[3],
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 110 : 100),
          }}
          renderItem={({ item }) => (
            <View style={styles.gridItem}>
              <CatCard cat={item} />
              {/* Decorative only. An interactive overlay here would swallow
                  the card's own tap and strand the user — tapping a locked
                  cat must still open its profile. */}
              {hasCollectionData && !spottedIds.has(item.id) && (
                <View style={styles.lockOverlay} pointerEvents="none">
                  <Text style={styles.lockIcon} allowFontScaling={false}>
                    🔒
                  </Text>
                  <Text style={styles.lockText}>{t('homeSpotToUnlock')}</Text>
                </View>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[3],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  titleBlock: { flexShrink: 1 },
  title: { fontSize: 23, fontFamily: fonts.displayBold },
  count: { fontSize: fontSizes.xs, fontFamily: fonts.body, marginTop: 2 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: borderWidths.thin,
  },
  toggleText: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.xs },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: radii.pill,
    borderWidth: borderWidths.thin,
    paddingHorizontal: spacing[4],
    paddingVertical: Platform.OS === 'web' ? 10 : 9,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSizes.sm,
    fontFamily: fonts.body,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  chipRow: { gap: spacing[2], paddingRight: spacing[4] },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    padding: spacing[6],
  },
  emptyIcon: { fontSize: 40, opacity: 0.5 },
  empty: {
    fontSize: fontSizes.sm,
    fontFamily: fonts.body,
    textAlign: 'center',
  },
  row: { gap: spacing[3], marginBottom: spacing[3] },
  gridItem: { flex: 1, position: 'relative' },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(27,42,56,0.72)',
    // Match CatCard's own corner radius, not the DS `lg` step, or the card
    // shows through at the corners.
    borderRadius: catCardRadius,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  lockIcon: { fontSize: 30 },
  lockText: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.sm,
    color: '#fff',
    textAlign: 'center',
  },
});
