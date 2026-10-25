import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useGetProfile,
  useGetLeaderboard,
  useGetLeaderboardWeek,
  getGetProfileQueryKey,
  getGetLeaderboardQueryKey,
  getGetLeaderboardWeekQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { useKeepSafeState } from '@/hooks/useKeepSafeState';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Button } from '@/components/purropolis';
import { ProfileHeader, type ProfileTab } from '@/components/profile/ProfileHeader';
import { MeTab } from '@/components/profile/MeTab';
import { BadgesTab } from '@/components/profile/BadgesTab';
import { SpottersTab } from '@/components/profile/SpottersTab';
import { NameNoteCard } from '@/components/profile/shared';
import { badgeViews } from '@/lib/badgeProgress';
import { leaderboardView } from '@/lib/leaderboardView';
import { formatRank } from '@/lib/formatRank';
import { homeHeroState } from '@/lib/spotted';

/**
 * SYC-628 (docs/specs/profile-tab-redesign.md): the spotter's Profile, in
 * three tabs (Me, Badges, Spotters). Settings moved to their own screen,
 * app/settings.tsx, behind the labelled button in the header.
 */
export default function ProfileScreen() {
  const colors = useColors();
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const { deviceId, username, heldUsername, nameNote, setNameNote, keepSafeOffer } = useDevice();
  const { isOnline } = useOffline();
  // "See all my badges" on the badge celebration opens this screen with ?tab=badges.
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<ProfileTab>(
    params.tab === 'badges' || params.tab === 'spotters' ? params.tab : 'me',
  );
  // Tab screens stay mounted and the param sticks, so it is used up once applied;
  // otherwise a second "See all my badges" would not change it and nothing would happen.
  useEffect(() => {
    if (params.tab === 'badges' || params.tab === 'spotters') {
      setTab(params.tab);
      router.setParams({ tab: undefined });
    }
  }, [params.tab]);
  // The tabs scroll with the header, so a new tab starts at the top: "See all"
  // sits at the bottom of Me and would otherwise land mid-list (review #1).
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [tab]);

  // Both queries pause offline. React Query keeps the last payload in memory,
  // so a profile loaded earlier stays on screen offline, as on Home (§8.1).
  const profileQuery = useGetProfile(deviceId ?? '', {
    query: {
      enabled: !!deviceId && isOnline,
      queryKey: getGetProfileQueryKey(deviceId ?? ''),
    },
  });
  const leaderboardQuery = useGetLeaderboard({
    query: {
      enabled: isOnline,
      queryKey: getGetLeaderboardQueryKey(),
    },
  });
  const weekQuery = useGetLeaderboardWeek({
    query: {
      enabled: isOnline,
      queryKey: getGetLeaderboardWeekQueryKey(),
    },
  });
  const keepSafe = useKeepSafeState();

  const profile = profileQuery.data;
  const loading = isOnline && profileQuery.isLoading && profile === undefined;
  // Online but the profile wouldn't load: most likely the device credential no
  // longer matches. Distinguish that from simply being offline.
  const statsError = isOnline && profileQuery.isError && profile === undefined;

  const hero = homeHeroState(profile);
  const views = badgeViews(profile);
  const board = leaderboardView(
    leaderboardQuery.data,
    profile ? { spotterCode: profile.spotterCode, points: profile.points } : undefined,
    (code) => `${t('spotter')} ${code}`,
  );

  const weekBoard = leaderboardView(
    weekQuery.data?.entries,
    profile ? { spotterCode: profile.spotterCode, points: profile.weekPoints } : undefined,
    (code) => `${t('spotter')} ${code}`,
  );

  const name =
    profile?.nickname || profile?.username || username || heldUsername || t('spotter');
  const rankLine =
    board.myRank !== null
      ? t('profileRankLine').replace('{rank}', formatRank(language, board.myRank))
      : null;

  // §8.8: only when keep-safe is known to be off, and never beside the
  // first-badge offer.
  const showSafeNudge =
    isOnline &&
    !!keepSafe.data &&
    !keepSafe.isError &&
    keepSafe.data.status === 'none' &&
    keepSafeOffer !== 'skipped-onboarding';

  const badgesState = views
    ? 'ready'
    : loading
      ? 'loading'
      : profile === undefined && !isOnline
        ? 'offline'
        : 'unknown';
  const boardState = (q: { data?: unknown; isError: boolean }) =>
    q.data ? 'ready' : !isOnline ? 'offline' : q.isError ? 'error' : 'loading';
  const spottersState = boardState(leaderboardQuery);
  const weekState = boardState(weekQuery);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          paddingBottom: insets.bottom + (Platform.OS === 'web' ? 110 : 100),
        }}
      >
        <ProfileHeader
          name={name}
          // Only when the name on show is the one held offline (review #9).
          nameNotSaved={!username && !!heldUsername && name === heldUsername}
          rankLine={rankLine}
          tab={tab}
          onTab={setTab}
        />

        {statsError && (
          <View testID="profile-stats-error" style={styles.statsError}>
            <Text style={[styles.statsErrorText, { color: colors.foreground }]}>
              {t('statsUnavailable')}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              style={styles.tap}
              onPress={() => profileQuery.refetch()}
            >
              {t('tryAgain')}
            </Button>
          </View>
        )}

        <View role="tabpanel" aria-label={tabLabel(tab, t)}>
          {/* The rename note doesn't wait for the profile to load (review #8). */}
          {tab === 'me' && !!nameNote && (
            <View style={styles.note}>
              <NameNoteCard
                note={nameNote}
                onChange={() => {
                  setNameNote(null);
                  router.push('/settings?editName=1');
                }}
                onDismiss={() => setNameNote(null)}
              />
            </View>
          )}
          {tab === 'me' &&
            (loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <>
                <MeTab
                  firstSpot={hero === 'firstSpot'}
                  spotted={hero === 'unknown' ? undefined : profile?.catsSpotted}
                  firstFinds={profile?.uniqueCatsDiscovered}
                  views={views}
                  streakDays={profile?.currentStreakDays ?? 0}
                  showSafeNudge={showSafeNudge}
                  onSeeAllBadges={() => setTab('badges')}
                />
              </>
            ))}
          {tab === 'badges' && <BadgesTab views={views} state={badgesState} />}
          {tab === 'spotters' && (
            <SpottersTab
              week={{
                rows: weekBoard.rows,
                summary: weekBoard.summary,
                state: weekState,
                endsAt: weekQuery.data?.endsAt,
                lastWeek: weekQuery.data?.lastWeek ?? [],
              }}
              allTime={{ rows: board.rows, summary: board.summary, state: spottersState }}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function tabLabel(tab: ProfileTab, t: (key: string) => string): string {
  if (tab === 'me') return t('profileTabMe');
  if (tab === 'badges') return t('statBadges');
  return t('profileTabSpotters');
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { paddingVertical: 60, alignItems: 'center' },
  note: { paddingHorizontal: spacing[4], paddingTop: spacing[4] },
  statsError: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
  },
  statsErrorText: { fontFamily: fonts.body, fontSize: fontSizes.xs },
  // SYC-509: 44px tap target for the small button.
  tap: { minHeight: 44 },
});
