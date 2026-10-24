import React, { useEffect, useMemo, useState } from 'react';
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
import { fonts, fontSizes, radii, spacing, borderWidths } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { useLocation } from '@/hooks/useLocation';
import { useCatsWithCache } from '@/hooks/useCatsWithCache';
import { OfflineBanner } from '@/components/OfflineBanner';
import { CatCard } from '@/components/CatCard';
import { AppMap } from '@/components/AppMap';
import { DEFAULT_CELL_M, groupByCell } from '@/lib/cellShape';
import { NeedsHelpLink } from '@/components/report/NeedsHelpLink';
import { NotificationBell } from '@/components/NotificationBell';
import { Chip } from '@/components/purropolis';
import { photoSource, SYROS_CENTER } from '@/lib/urls';
import {
  catalogueEmptyKey,
  effectiveFilter,
  type CatalogueFilter,
} from '@/lib/spotted';
// Cats within NEARBY_KM count as "near me": one number for the whole app,
// shared with the "Find the cat" picker (SYC-119).
import { NEARBY_KM } from '@workspace/geo';
import {
  useGetProfile,
  getGetProfileQueryKey,
} from '@workspace/api-client-react';
import { decorative, spokenText } from '@/lib/a11yText';

/** How long the search box must be still before the map refits (SYC-573). */
export const MAP_SEARCH_SETTLE_MS = 400;

// Cat-alog filters (`CatalogueFilter`). The design also shows "Needs vet" /
// "Desexed" filters, but health status is not modelled on cats yet (tracked
// separately), so those two are deliberately absent rather than rendered as
// controls that do nothing.

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
  const [filter, setFilter] = useState<CatalogueFilter>('all');
  const [showMap, setShowMap] = useState(false);

  const profileQuery = useGetProfile(deviceId ?? '', {
    query: {
      enabled: !!deviceId && isOnline,
      queryKey: getGetProfileQueryKey(deviceId ?? ''),
    },
  });
  const profile = profileQuery.data;
  // Mirror Home's guard exactly: an older server can return a profile
  // without `spottedCatIds`, so stamps and the "Not spotted yet" chip must
  // depend on the array actually being present, not just on the profile
  // existing. Unknown is not zero.
  const hasCollectionData = Array.isArray(profile?.spottedCatIds);
  const spottedIds = useMemo(
    () => new Set(profile?.spottedCatIds ?? []),
    [profile?.spottedCatIds],
  );

  // Derived, not stored: if the profile goes away the chip disappears and
  // the list falls back to All; when it returns the choice is still there.
  const applied = effectiveFilter(filter, hasCollectionData);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cats.filter((c) => {
      if (q) {
        const haystack = [c.name, c.description, String(c.id)]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (applied === 'nearby') {
        // distanceKm is only present when the list was fetched with coords.
        return c.distanceKm != null && c.distanceKm <= NEARBY_KM;
      }
      if (applied === 'homed') return c.hasHome;
      if (applied === 'notSpotted') return !spottedIds.has(c.id);
      return true;
    });
  }, [cats, search, applied, spottedIds]);

  const emptyKey = catalogueEmptyKey({
    filter: applied,
    hasCoords: !!coords,
    catCount: cats.length,
    search,
  });

  // The map opens on the cats being shown, not on the phone (SYC-573): the
  // phone's position is only the dot. So the starting view is the island and
  // never depends on `coords`; the fit moves it once the cats are known.
  const initialRegion = {
    latitude: SYROS_CENTER.latitude,
    longitude: SYROS_CENTER.longitude,
    latitudeDelta: 0.06,
    longitudeDelta: 0.06,
  };

  // Typing refits the map only once it has settled: each refit pulls a new set
  // of tiles from openstreetmap.org.
  const [settledSearch, setSettledSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setSettledSearch(search.trim().toLowerCase()), MAP_SEARCH_SETTLE_MS);
    return () => clearTimeout(id);
  }, [search]);
  const fitKey = `${applied}|${settledSearch}`;

  // Web only: tapping a square shared by several cats narrows the strip to
  // them. It resets whenever the fit key changes (a chip or a settled search).
  const [strip, setStrip] = useState<{ forKey: string; ids: number[] } | null>(null);
  const stripIds = strip && strip.forKey === fitKey ? strip.ids : null;

  const filters: { key: CatalogueFilter; label: string }[] = [
    { key: 'all', label: t('filterAll') },
    { key: 'nearby', label: t('filterNearMe') },
    { key: 'homed', label: t('filterHasHome') },
    ...(hasCollectionData
      ? [{ key: 'notSpotted' as const, label: t('filterNotSpotted') }]
      : []),
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <View style={styles.titleBlock}>
            <Text
              role="heading"
              accessibilityLabel={spokenText(t('catalogTitle'))}
              style={[styles.title, { color: colors.foreground }]}
            >
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
              style={styles.clearHit}
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
              active={applied === f.key}
              onPress={() => setFilter(f.key)}
            />
          ))}
        </ScrollView>
      </View>

      <OfflineBanner />

      {/* SYC-42: quiet, never the biggest thing on screen (spec §4.1). */}
      {showMap && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
          <NeedsHelpLink />
        </View>
      )}

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
          {filtered.length === 0 && emptyKey === 'filterNotSpottedAllDone' && (
            <View
              style={[styles.mapMessage, { backgroundColor: colors.card }]}
              pointerEvents="none"
            >
              <Text style={styles.emptyIcon} allowFontScaling={false} {...decorative}>
                🐾
              </Text>
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                {t(emptyKey)}
              </Text>
            </View>
          )}
          <AppMap
            fitKey={fitKey}
            latitude={initialRegion.latitude}
            longitude={initialRegion.longitude}
            latitudeDelta={initialRegion.latitudeDelta}
            longitudeDelta={initialRegion.longitudeDelta}
            showsUserLocation
            markerBorderColor={colors.primary}
            // Data spine PR 6 (spec §6.2): each cat is somewhere in its
            // published cell, drawn as that cell. Cats sharing a cell share
            // one drawn area; tapping it opens the first of them.
            areas={groupByCell(filtered).map((group) => {
              const shared = group.length > 1;
              return {
                id: `${group[0]!.lat},${group[0]!.lng}`,
                latitude: group[0]!.lat,
                longitude: group[0]!.lng,
                sizeMetres: group[0]!.locationCellM ?? DEFAULT_CELL_M,
                // "3 cats" on a shared square (decision D6); the map hides it
                // while the square is narrower than 40 px.
                label: shared ? t('catsInArea').replace('{n}', String(group.length)) : undefined,
                accessibilityLabel: shared
                  ? t('areaWithCats').replace('{n}', String(group.length))
                  : t('areaOfCat').replace('{name}', group[0]!.name),
                onPress: () => {
                  if (shared && Platform.OS === 'web') {
                    // D4: the web strip narrows to the cats in this square.
                    setStrip({ forKey: fitKey, ids: group.map((c) => c.id) });
                    return;
                  }
                  router.push({
                    pathname: '/cat/[id]',
                    params: { id: String(group[0]!.id) },
                  });
                },
              };
            })}
            stripAction={stripIds ? { label: t('mapShowAll'), onPress: () => setStrip(null) } : undefined}
            // On web, markers are the tappable strip under the map. On native
            // they would be photo pins at the cell centre, which the cell
            // replaces (spec §10.7: "drawn as that cell, never as a pin";
            // review of #95, finding 6), so native shows the cells only.
            markers={Platform.OS !== 'web' ? [] : filtered.filter((cat) => !stripIds || stripIds.includes(cat.id)).map((cat) => ({
              id: String(cat.id),
              latitude: cat.lat,
              longitude: cat.lng,
              title: cat.name,
              image: photoSource(cat.photoUrl),
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
          <Text style={styles.emptyIcon} allowFontScaling={false} {...decorative}>
            🐾
          </Text>
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            {t(emptyKey)}
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
              <CatCard
                cat={item}
                spotted={hasCollectionData ? spottedIds.has(item.id) : undefined}
              />
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // SYC-509: 44pt tap area around a 16pt icon; the negative margin keeps the layout.
  clearHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', margin: -14 },
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
  mapMessage: {
    position: 'absolute',
    top: spacing[3],
    left: spacing[4],
    right: spacing[4],
    zIndex: 1,
    // Android draws the native map above zIndex alone.
    elevation: 4,
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[4],
    borderRadius: radii.lg,
  },
});
