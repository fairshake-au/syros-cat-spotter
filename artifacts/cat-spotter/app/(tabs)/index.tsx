import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, spacing } from '@/constants/theme';

import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { useLocation } from '@/hooks/useLocation';
import { useCatsWithCache } from '@/hooks/useCatsWithCache';
import { OfflineBanner } from '@/components/OfflineBanner';
import { NotificationBell } from '@/components/NotificationBell';
import { CatCard } from '@/components/CatCard';
import { Avatar, Button, StatTile, StatTileGroup } from '@/components/purropolis';
import { useBannerAreaReserve } from '@/lib/bannerArea';
import { displayUpperCase } from '@/lib/displayUpperCase';
import { homeHeroState, stripHeadingKey } from '@/lib/spotted';
import {
  useGetProfile,
  getGetProfileQueryKey,
} from '@workspace/api-client-react';

/** How many nearby cats the "collect" strip shows before "see all". */
const NEARBY_LIMIT = 4;

export default function HomeScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // SYC-128: room for any top banners showing, so they sit above the
  // greeting instead of on top of it (0 when there are none).
  const bannerReserve = useBannerAreaReserve();
  // SYC-143: on the narrowest phones (320px) three tiles leave the label
  // too little room, so tighten the tile padding and gaps there.
  const compactTiles = useWindowDimensions().width < 360;
  const { deviceId, username } = useDevice();
  const { isOnline } = useOffline();
  const { coords } = useLocation();
  const { cats, isLoading } = useCatsWithCache(
    coords?.latitude,
    coords?.longitude,
  );

  const profileQuery = useGetProfile(deviceId ?? '', {
    query: {
      enabled: !!deviceId && isOnline,
      queryKey: getGetProfileQueryKey(deviceId ?? ''),
    },
  });
  const profile = profileQuery.data;
  // The cats list is cached to AsyncStorage but the profile is not. Until a
  // profile has ever loaded we have cats and no stats, and everything derived
  // from the profile must read as absent rather than zero: "0 of 10" with every
  // card locked is a wrong answer that looks like a right one.
  //
  // React Query keeps the last successful payload while the query is disabled,
  // so going offline shows recent stats rather than blanking them. That is
  // deliberate — recently-true beats unknown, and the offline banner is already
  // on screen. Only a device that has never loaded a profile sees dashes.
  //
  // An older server can also return a profile *without* `spottedCatIds`, so
  // the presence of the profile is not enough — collection state gates on the
  // array actually being there. Ordering and locks share this one flag so they
  // can never disagree about the same fact.
  const hasCollectionData = Array.isArray(profile?.spottedCatIds);

  // The cat-alog total is authoritative from the server, but it can lag the
  // locally-cached list while offline — take whichever is larger so the
  // denominator is never smaller than the cats actually on screen.
  const totalCats = Math.max(profile?.totalCats ?? 0, cats.length);
  const spotted = profile?.catsSpotted;
  // 'firstSpot' only when the profile loaded with its list; unknown stays a dash.
  const hero = homeHeroState(profile);
  const progress =
    spotted !== undefined && totalCats > 0 ? spotted / totalCats : 0;

  const spottedIds = useMemo(
    () => new Set(profile?.spottedCatIds ?? []),
    [profile?.spottedCatIds],
  );

  // Cats the user has not spotted yet lead the strip — those are the ones to
  // look out for. Without stats we cannot tell spotted from not, so leave the
  // order alone.
  const nearby = useMemo(() => {
    if (!hasCollectionData) return cats.slice(0, NEARBY_LIMIT);
    const uncollected = cats.filter((c) => !spottedIds.has(c.id));
    const collected = cats.filter((c) => spottedIds.has(c.id));
    return [...uncollected, ...collected].slice(0, NEARBY_LIMIT);
  }, [cats, spottedIds, hasCollectionData]);

  // `username` comes from DeviceContext and survives offline, so greet by name
  // even when the profile fetch hasn't landed.
  const displayName =
    profile?.nickname ?? profile?.username ?? username ?? t('homeFallbackName');
  const streak = profile?.currentStreakDays ?? 0;
  const dash = '—';
  // A failed fetch while online is not the same as being offline — most likely
  // the device credential no longer matches. Say so instead of showing the same
  // empty state and letting the user assume their spots vanished.
  const statsError = isOnline && profileQuery.isError && profile === undefined;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + (Platform.OS === 'web' ? 110 : 100),
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Aegean hero */}
        <View
          style={[
            styles.hero,
            {
              backgroundColor: palette.aegean600,
              paddingTop: insets.top + bannerReserve + 14,
            },
          ]}
        >
          <Text style={styles.heroPaw} allowFontScaling={false}>
            🐾
          </Text>
          <View style={styles.heroRow}>
            <Avatar name={displayName} size="md" ring />
            <View style={styles.heroGreeting}>
              <Text style={styles.heroHello}>{t('homeGreeting')}</Text>
              <Text style={styles.heroName} numberOfLines={1}>
                {displayName} 👋
              </Text>
            </View>
            <View style={styles.heroActions}>
              {streak > 0 && (
                <View style={styles.streakChip}>
                  <Text style={styles.streakText}>
                    🔥 {t('homeStreak').replace('{n}', String(streak))}
                  </Text>
                </View>
              )}
              <NotificationBell />
            </View>
          </View>

          {hero === 'firstSpot' ? (
            <View style={styles.progressBlock}>
              <Text style={styles.firstSpotLine}>
                {t('homeFirstSpotLine').replace('{n}', String(totalCats))}
              </Text>
              <Button
                variant="primary"
                size="lg"
                block
                wrapLabel
                onPress={() => router.push('/spot')}
              >
                {t('homeFirstSpotCta')}
              </Button>
            </View>
          ) : (
            <View style={styles.progressBlock}>
              <View style={styles.progressLine}>
                <Text style={styles.progressValue}>{spotted ?? dash}</Text>
                <Text style={styles.progressLabel}>
                  {t('homeOfNCats').replace('{n}', String(totalCats))}
                </Text>
              </View>
              <View style={styles.progressTrack}>
                {spotted !== undefined && (
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.min(100, Math.round(progress * 100))}%`,
                        backgroundColor: palette.sun500,
                      },
                    ]}
                  />
                )}
              </View>
            </View>
          )}
        </View>

        <OfflineBanner />
        {statsError && (
          <Text style={[styles.statsError, { color: colors.mutedForeground }]}>
            {t('statsUnavailable')}
          </Text>
        )}

        {/* Stat tiles — every figure is server-derived. SYC-143: the group
            gives all three labels one size, stepped down only as far as the
            longest word (Greek "ΑΝΑΚΑΛΥΨΕΙΣ") needs to fit without breaking. */}
        <StatTileGroup
          style={[styles.tiles, compactTiles && styles.tilesCompact]}
        >
          <View style={styles.tile}>
            <StatTile
              value={spotted ?? dash}
              label={t('statSpotted')}
              tone="aegean"
              style={[styles.tileInner, compactTiles && styles.tileInnerCompact]}
            />
          </View>
          <View style={styles.tile}>
            <StatTile
              value={profile?.uniqueCatsDiscovered ?? dash}
              label={t('statFirstFinds')}
              tone="sun"
              style={[styles.tileInner, compactTiles && styles.tileInnerCompact]}
            />
          </View>
          <View style={styles.tile}>
            <StatTile
              value={profile?.badges?.length ?? dash}
              label={t('statBadges')}
              tone="bougain"
              style={[styles.tileInner, compactTiles && styles.tileInnerCompact]}
            />
          </View>
        </StatTileGroup>

        {/* Nearby to collect */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
              {/* "Nearby" only when the first cats really are close; otherwise
                  the strip is just cats to look out for (stripHeadingKey). */}
              {/* SYC-143: capitals via displayUpperCase, not textTransform,
                  so Greek drops its accents. */}
              {displayUpperCase(t(stripHeadingKey(!!coords, cats)))}
            </Text>
            <Pressable onPress={() => router.push('/cats')}>
              <Text style={[styles.seeAll, { color: colors.primary }]}>
                {t('seeAll')}
              </Text>
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : nearby.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              {t('noCats')}
            </Text>
          ) : (
            <View style={styles.grid}>
              {nearby.map((cat) => (
                <View key={cat.id} style={styles.gridItem}>
                  <CatCard
                    cat={cat}
                    spotted={hasCollectionData ? spottedIds.has(cat.id) : undefined}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[5],
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    overflow: 'hidden',
  },
  heroPaw: {
    position: 'absolute',
    right: -24,
    top: 24,
    fontSize: 130,
    opacity: 0.12,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  heroGreeting: { flexShrink: 1 },
  heroHello: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    color: 'rgba(255,255,255,0.82)',
  },
  heroName: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    color: '#fff',
    lineHeight: 24,
  },
  heroActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  streakChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  streakText: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.sm,
    color: '#fff',
  },
  progressBlock: { marginTop: spacing[5] },
  progressLine: { flexDirection: 'row', alignItems: 'baseline', gap: 9 },
  progressValue: {
    fontFamily: fonts.displayBold,
    fontSize: 42,
    color: '#fff',
    lineHeight: 46,
  },
  progressLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    color: 'rgba(255,255,255,0.88)',
    flexShrink: 1,
  },
  firstSpotLine: {
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    color: '#fff',
    marginBottom: spacing[3],
  },
  progressTrack: {
    marginTop: 11,
    height: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.24)',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 999 },
  tiles: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
  },
  // StatTile carries a 120px minWidth for standalone use; three across at 375px
  // would overflow, so let them shrink here.
  statsError: {
    fontFamily: fonts.body,
    fontSize: fontSizes['2xs'],
    textAlign: 'center',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
  },
  tile: { flex: 1, minWidth: 0 },
  // SYC-143: 12px side padding (DS default 16) leaves the label ~8px more
  // room per tile, so Greek labels stay closer to the design size on a phone.
  tileInner: { minWidth: 0, paddingHorizontal: spacing[3] },
  tilesCompact: { gap: spacing[2] },
  tileInnerCompact: { paddingHorizontal: spacing[2] },
  section: { paddingHorizontal: spacing[4], paddingTop: spacing[5] },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.4,
  },
  seeAll: { fontFamily: fonts.bodyBold, fontSize: fontSizes.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  gridItem: { width: '48%', position: 'relative' },
  center: { paddingVertical: spacing[5], alignItems: 'center' },
  empty: {
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    textAlign: 'center',
    paddingVertical: spacing[5],
  },
});
