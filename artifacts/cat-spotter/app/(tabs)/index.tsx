import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { useLocation } from '@/hooks/useLocation';
import { useCatsWithCache } from '@/hooks/useCatsWithCache';
import { OfflineBanner } from '@/components/OfflineBanner';
import { NotificationBell } from '@/components/NotificationBell';
import { CatCard } from '@/components/CatCard';
import { Avatar, StatTile } from '@/components/purropolis';
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
  const { deviceId } = useDevice();
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

  // The cat-alog total is authoritative from the server, but it can lag the
  // locally-cached list while offline — take whichever is larger so the
  // denominator is never smaller than the cats actually on screen.
  const totalCats = Math.max(profile?.totalCats ?? 0, cats.length);
  const spotted = profile?.catsSpotted ?? 0;
  const progress = totalCats > 0 ? spotted / totalCats : 0;

  const spottedIds = useMemo(
    () => new Set(profile?.spottedCatIds ?? []),
    [profile?.spottedCatIds],
  );

  // Nearby cats the user has not collected yet lead the strip — those are the
  // ones the design's "Spot to unlock" treatment is actually for.
  const nearby = useMemo(() => {
    const uncollected = cats.filter((c) => !spottedIds.has(c.id));
    const collected = cats.filter((c) => spottedIds.has(c.id));
    return [...uncollected, ...collected].slice(0, NEARBY_LIMIT);
  }, [cats, spottedIds]);

  const displayName =
    profile?.nickname ?? profile?.username ?? t('homeFallbackName');
  const streak = profile?.currentStreakDays ?? 0;

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
            { backgroundColor: palette.aegean600, paddingTop: insets.top + 14 },
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

          <View style={styles.progressBlock}>
            <View style={styles.progressLine}>
              <Text style={styles.progressValue}>{spotted}</Text>
              <Text style={styles.progressLabel}>
                {t('homeOfNCats').replace('{n}', String(totalCats))}
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(100, Math.round(progress * 100))}%`,
                    backgroundColor: palette.sun500,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        <OfflineBanner />

        {/* Stat tiles — every figure is server-derived. */}
        <View style={styles.tiles}>
          <View style={styles.tile}>
            <StatTile
              value={spotted}
              label={t('statSpotted')}
              tone="aegean"
            />
          </View>
          <View style={styles.tile}>
            <StatTile
              value={profile?.uniqueCatsDiscovered ?? 0}
              label={t('statFirstFinds')}
              tone="sun"
            />
          </View>
          <View style={styles.tile}>
            <StatTile
              value={profile?.badges.length ?? 0}
              label={t('statBadges')}
              tone="bougain"
            />
          </View>
        </View>

        {/* Nearby to collect */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
              {t('homeNearbyEyebrow')}
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
                  <CatCard cat={cat} />
                  {!spottedIds.has(cat.id) && (
                    <Pressable
                      style={styles.lockOverlay}
                      onPress={() => router.push('/spot')}
                      accessibilityRole="button"
                      accessibilityLabel={t('homeSpotToUnlock')}
                    >
                      <Text style={styles.lockIcon} allowFontScaling={false}>
                        🔒
                      </Text>
                      <Text style={styles.lockText}>
                        {t('homeSpotToUnlock')}
                      </Text>
                    </Pressable>
                  )}
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
  tile: { flex: 1 },
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
    textTransform: 'uppercase',
  },
  seeAll: { fontFamily: fonts.bodyBold, fontSize: fontSizes.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  gridItem: { width: '48%', position: 'relative' },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(27,42,56,0.72)',
    borderRadius: radii.lg,
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
  center: { paddingVertical: spacing[5], alignItems: 'center' },
  empty: {
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    textAlign: 'center',
    paddingVertical: spacing[5],
  },
});
