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
import { LoadFailed } from '@/components/LoadFailed';
import { LOAD_QUERY_OPTIONS, LOAD_TIMEOUT_MS } from '@/lib/loadTiming';
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
import { decorative, spokenText } from '@/lib/a11yText';

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
  const { deviceId, username, heldUsername } = useDevice();
  const { isOnline } = useOffline();
  const { coords } = useLocation();
  const { cats, isLoading, loadFailed, retry } = useCatsWithCache(
    coords?.latitude,
    coords?.longitude,
  );

  const profileQuery = useGetProfile(deviceId ?? '', {
    query: {
      enabled: !!deviceId && isOnline,
      queryKey: getGetProfileQueryKey(deviceId ?? ''),
      ...LOAD_QUERY_OPTIONS, // SYC-508 §2.4
    },
    request: { timeoutMs: LOAD_TIMEOUT_MS },
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
  // array actually being there. Ordering and stamps share this one flag so they
  // can never disagree about the same fact.
  const hasCollectionData = Array.isArray(profile?.spottedCatIds);

  // The cat-alog total is authoritative from the server, but it can lag the
  // locally-cached list while offline — take whichever is larger so the
  // denominator is never smaller than the cats actually on screen.
  const totalCats = Math.max(profile?.totalCats ?? 0, cats.length);
  const spotted = profile?.catsSpotted;
  // 'firstSpot' only when the profile loaded with its list; unknown stays a dash.
  const hero = homeHeroState(profile);
  // Unknown hero state (profile without its list, e.g. an out-of-date server)
  // shows a dash and no fill even if a bare count came through.
  const knownSpotted = hero === 'unknown' ? undefined : spotted;
  const progress =
    knownSpotted !== undefined && totalCats > 0 ? knownSpotted / totalCats : 0;

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
  // even when the profile fetch hasn't landed; a name held offline (SYC-506)
  // greets too.
  const displayName =
    profile?.nickname ?? profile?.username ?? username ?? heldUsername ?? t('homeFallbackName');
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
          <Text style={styles.heroPaw} allowFontScaling={false} {...decorative}>
            🐾
          </Text>
          <View style={styles.heroRow}>
            <Avatar name={displayName} size="md" ring />
            <View style={styles.heroGreeting}>
              <Text style={styles.heroHello}>{t('homeGreeting')}</Text>
              {/* SYC-509: the label keeps the wave emoji from being read aloud. */}
              <Text style={styles.heroName} numberOfLines={1} accessibilityLabel={spokenText(displayName) || displayName}>
                {displayName} 👋
              </Text>
            </View>
            <View style={styles.heroActions}>
              {streak > 0 && (
                <View style={styles.streakChip}>
                  <Text
                    style={styles.streakText}
                    accessibilityLabel={t('homeStreak').replace('{n}', String(streak))}
                  >
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
                variant="accent"
                size="lg"
                block
                wrapLabel
                onPress={() => router.push('/spot')}
              >
                {t('homeFirstSpotCta')}
              </Button>
            </View>
          ) : hero === 'unknown' && totalCats === 0 ? null : (
            // SYC-508: with nothing loaded, "— of 0 cats spotted" isn't true.
            <View style={styles.progressBlock}>
              <View style={styles.progressLine}>
                <Text style={styles.progressValue}>{knownSpotted ?? dash}</Text>
                <Text style={styles.progressLabel}>
                  {t('homeOfNCats').replace('{n}', String(totalCats))}
                </Text>
              </View>
              <View style={styles.progressTrack}>
                {knownSpotted !== undefined && (
                  <View
                    testID="home-progress-fill"
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
          // SYC-508 §3.2: the same words, now with Try again.
          <View style={styles.statsError}>
            <LoadFailed
              size="line"
              message={t('statsUnavailable')}
              retryLabel={`${t('tryAgain')}: ${t('statsUnavailable')}`}
              onRetry={() => profileQuery.refetch()}
              testID="home-stats-failed"
            />
          </View>
        )}

        {/* Stat tiles — every figure is server-derived. SYC-143: the group
            gives all three labels one size, stepped down only as far as the
            longest word (Greek "ΑΝΑΚΑΛΥΨΕΙΣ") needs to fit without breaking. */}
        {/* SYC-578 via SYC-508 §4.2: before the first spot the hero's own
            line is the one friendly line, so no 0 / 0 / 0. Unknown still
            shows dashes. */}
        {hero !== 'firstSpot' && (
          <StatTileGroup
            style={[styles.tiles, compactTiles && styles.tilesCompact]}
          >
            <View style={styles.tile}>
              <StatTile
                value={knownSpotted ?? dash}
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
        )}

        {/* Nearby to collect */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
              {/* "Nearby" only when the cats shown in the strip really are
                  close (the strip puts unspotted cats first, so judge
                  `nearby`, not the whole list); otherwise the strip is just
                  cats to look out for (stripHeadingKey). */}
              {/* SYC-143: capitals via displayUpperCase, not textTransform,
                  so Greek drops its accents. */}
              {displayUpperCase(t(stripHeadingKey(!!coords, nearby)))}
            </Text>
            <Pressable
              onPress={() => router.push('/cats')}
              accessibilityRole="button"
              style={styles.seeAllHit}
            >
              <Text style={[styles.seeAll, { color: colors.primary }]}>
                {t('seeAll')}
              </Text>
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : loadFailed ? (
            <LoadFailed
              size="line"
              onRetry={retry}
              retryLabel={`${t('tryAgain')}: ${t(stripHeadingKey(!!coords, nearby))}`}
              testID="home-cats-failed"
            />
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
    // SYC-509: solid white; the faded white was 3.7–4.0:1 on Aegean blue.
    color: palette.stone000,
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
    // SYC-509: solid white; the faded white was 3.7–4.0:1 on Aegean blue.
    color: palette.stone000,
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
    alignItems: 'center',
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
  // SYC-509: 44pt tall tap area; the negative margin keeps the heading row's height.
  seeAllHit: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end', marginVertical: -12 },
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
