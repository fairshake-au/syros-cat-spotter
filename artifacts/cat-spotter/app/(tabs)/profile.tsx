import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useGetProfile,
  useGetLeaderboard,
  getGetProfileQueryKey,
  getGetLeaderboardQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing, tracking } from '@/constants/theme';
import { useAppearance } from '@/context/AppearanceContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { OfflineBanner } from '@/components/OfflineBanner';
import { UsernameEditor } from '@/components/UsernameEditor';
import { KeepSafeSettings } from '@/components/keepSafe/KeepSafeSettings';
import { Avatar, Button, Card, StatTile } from '@/components/purropolis';
import { BADGE_IDS, BADGE_ICONS, LANGUAGES } from '@/lib/i18n';

const BADGE_TONES: { bg: string; fg: string }[] = [
  { bg: palette.sun100, fg: palette.sun700 },
  { bg: palette.bougain100, fg: palette.bougain700 },
  { bg: palette.aegean100, fg: palette.aegean800 },
  { bg: palette.olive100, fg: palette.olive700 },
];

export default function ProfileScreen() {
  const colors = useColors();
  const { appearance, setAppearance } = useAppearance();
  const { t, language, setLanguage } = useLanguage();
  const insets = useSafeAreaInsets();
  const { deviceId, username, heldUsername, nameNote, setNameNote } = useDevice();
  // SYC-506: "Change it" on the rename note opens the name editor.
  const [editRequest, setEditRequest] = useState(0);
  const { isOnline } = useOffline();

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

  const profile = profileQuery.data;
  // The profile is not cached locally, so offline (or mid-fetch) there are no
  // stats. Show an em dash rather than a plausible-looking zero.
  const dash = '\u2014';
  // Online but the profile wouldn't load — most likely the device credential no
  // longer matches. Distinguish that from simply being offline.
  const statsError = isOnline && profileQuery.isError && profile === undefined;
  // An older/mid-fetch profile can be missing `badges` entirely. Rendering
  // "0 of 7" and drawing every badge locked is the same plausible-wrong-zero
  // failure as the stat tiles \u2014 treat "no array" as unknown, not "none
  // earned".
  const hasBadgeData = Array.isArray(profile?.badges);
  const earned = new Set(hasBadgeData ? profile!.badges : []);
  const earnedCount = hasBadgeData
    ? BADGE_IDS.filter((id) => earned.has(id)).length
    : null;
  const streakDays = profile?.currentStreakDays ?? 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      {statsError && (
        <Text style={[styles.statsError, { color: colors.mutedForeground }]}>
          {t('statsUnavailable')}
        </Text>
      )}
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + (Platform.OS === 'web' ? 110 : 100),
        }}
      >
        {profileQuery.isLoading && isOnline ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <View
            style={[
              styles.hero,
              { backgroundColor: colors.primary, paddingTop: insets.top + 28 },
            ]}
          >
            <Text style={styles.heroPaw}>🐾</Text>
            <Avatar name={profile?.username || username || heldUsername || t('spotter')} ring size="xl" />
            {!!(profile?.username || username || heldUsername) && (
              <Text style={[styles.username, { color: colors.primaryForeground }]}>
                {profile?.username || username || heldUsername}
              </Text>
            )}
            {/* SYC-506: a name chosen offline, not on the server yet. */}
            {!username && !!heldUsername && (
              <Text style={[styles.heroSub, { color: colors.primaryForeground }]}>
                {t('nameNotSavedYet')}
              </Text>
            )}
            <View style={styles.heroSubRow}>
              <Text style={[styles.heroSub, { color: colors.primaryForeground }]}>
                {t('profileRole')}
              </Text>
              {streakDays > 0 && (
                <>
                  <Text style={[styles.heroSub, { color: colors.primaryForeground }]}>·</Text>
                  {/* A `sun`-toned Tag is built for the light page surface; on the
                      Aegean hero its amber-on-cream reads as unreadable mush.
                      Use the same translucent-white chip as the Home hero. */}
                  <View style={styles.streakChip}>
                    <Text style={styles.streakChipText}>
                      {`\u{1F525} ${t('profileStreak').replace('{n}', String(streakDays))}`}
                    </Text>
                  </View>
                </>
              )}
            </View>
          </View>
        )}

        <View style={{ padding: 16, gap: 20 }}>
          {/* Stat row */}
          <View style={styles.statsRow}>
            <StatTile
              value={profile?.catsSpotted ?? dash}
              label={t('catsSpotted')}
              tone="aegean"
              style={styles.statTile}
            />
            <StatTile
              value={profile?.uniqueCatsDiscovered ?? dash}
              label={t('profileFirstFinds')}
              tone="sun"
              style={styles.statTile}
            />
            <StatTile
              value={profile?.points ?? dash}
              label={t('points')}
              tone="olive"
              style={styles.statTile}
            />
          </View>

          {/* SYC-506: the background save gave this spotter another name. */}
          {!!nameNote && (
            <View
              style={[styles.nameNote, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.nameNoteText, { color: colors.foreground }]}>
                {t(nameNote.reason === 'taken' ? 'nameNoteTaken' : 'nameNoteRefused')
                  .replace('{from}', nameNote.from)
                  .replace('{to}', nameNote.to)}
              </Text>
              <View style={styles.nameNoteActions}>
                {isOnline && (
                  <Button
                    variant="primary"
                    size="sm"
                    onPress={() => {
                      setNameNote(null);
                      setEditRequest((n) => n + 1);
                    }}
                  >
                    {t('nameNoteChange')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onPress={() => setNameNote(null)}>
                  {t('nameNoteDismiss')}
                </Button>
              </View>
            </View>
          )}

          {/* Username: waits until a name held offline has been saved. */}
          {isOnline && !!deviceId && !heldUsername && (
            <UsernameEditor
              currentUsername={profile?.username ?? username ?? null}
              editRequest={editRequest}
            />
          )}

          {/* Badges */}
          <View style={{ gap: 10 }}>
            <View style={styles.badgeHeaderRow}>
              <Text
                style={[
                  styles.eyebrow,
                  {
                    color: colors.mutedForeground,
                    letterSpacing: fontSizes['2xs'] * tracking.wider,
                  },
                ]}
              >
                {`${t('badges')} · ${t('profileBadgeCount')
                  .replace(
                    '{earned}',
                    earnedCount === null ? dash : String(earnedCount),
                  )
                  .replace('{total}', String(BADGE_IDS.length))}`}
              </Text>
            </View>
            {/* Without a `badges` array we cannot tell earned from
                un-earned — rendering the grid would either draw every badge
                locked (asserting "you've earned nothing") or unlocked
                (asserting the opposite), both wrong. Omit it entirely until
                real data arrives. */}
            {hasBadgeData && (
              <View style={styles.badgeGrid}>
                {BADGE_IDS.map((id, index) => {
                  const has = earned.has(id);
                  const tone = BADGE_TONES[index % BADGE_TONES.length];
                  return (
                    <View key={id} style={styles.badgeCell}>
                      <View
                        style={[
                          styles.badgeIconTile,
                          { backgroundColor: has ? tone.bg : colors.muted, opacity: has ? 1 : 0.5 },
                        ]}
                      >
                        {has ? (
                          <Feather
                            name={(BADGE_ICONS[id] ?? 'award') as never}
                            size={26}
                            color={tone.fg}
                          />
                        ) : (
                          <Text style={styles.lockEmoji}>🔒</Text>
                        )}
                      </View>
                      <Text
                        style={[
                          styles.badgeName,
                          { color: has ? colors.foreground : colors.mutedForeground },
                        ]}
                        numberOfLines={1}
                      >
                        {t(`badge_${id}`)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Leaderboard */}
          {isOnline && (leaderboardQuery.data?.length ?? 0) > 0 && (
            <View style={{ gap: 10 }}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                {t('leaderboard')}
              </Text>
              {leaderboardQuery.data!.map((entry) => {
                const isMe =
                  !!profile?.spotterCode && entry.spotterCode === profile.spotterCode;
                return (
                  <Card
                    key={entry.spotterCode}
                    flat={!isMe}
                    padding={12}
                    style={[
                      styles.leaderRow,
                      isMe && { borderColor: colors.primary, borderWidth: 1.5 },
                    ]}
                  >
                    <Text style={[styles.rank, { color: colors.mutedForeground }]}>
                      #{entry.rank}
                    </Text>
                    <Text
                      style={[styles.leaderName, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {(() => {
                        const displayName =
                          entry.username ??
                          `${t('spotter')} ${entry.spotterCode}`;
                        return isMe
                          ? entry.username
                            ? `${displayName} (${t('you')})`
                            : t('you')
                          : displayName;
                      })()}
                    </Text>
                    <Text style={[styles.leaderPoints, { color: colors.primary }]}>
                      {entry.points} {t('points')}
                    </Text>
                  </Card>
                );
              })}
            </View>
          )}

          {/* SYC-3: Keep my spots safe, and Get your spots back */}
          <KeepSafeSettings />

          {/* Language */}
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {t('language')}
            </Text>
            <View style={styles.langRow}>
              {LANGUAGES.map((lang) => {
                const active = lang.code === language;
                return (
                  <Pressable
                    key={lang.code}
                    onPress={() => setLanguage(lang.code)}
                    style={[
                      styles.langBtn,
                      {
                        backgroundColor: active ? colors.primary : colors.card,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.langText,
                        {
                          color: active
                            ? colors.primaryForeground
                            : colors.foreground,
                        },
                      ]}
                    >
                      {lang.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Appearance */}
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {t('appearance')}
            </Text>
            <View
              style={[
                styles.appearanceRow,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              {(
                [
                  {
                    key: 'system',
                    label: t('appearanceSystem'),
                    icon: 'smartphone',
                  },
                  { key: 'light', label: t('appearanceLight'), icon: 'sun' },
                  { key: 'dark', label: t('appearanceDark'), icon: 'moon' },
                ] as const
              ).map((option) => {
                const active = option.key === appearance;
                return (
                  <Pressable
                    key={option.key}
                    testID={`appearance-${option.key}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={option.label}
                    onPress={() => setAppearance(option.key)}
                    style={[
                      styles.appearanceBtn,
                      {
                        backgroundColor: active ? colors.primary : 'transparent',
                      },
                    ]}
                  >
                    <Feather
                      name={option.icon}
                      size={16}
                      color={
                        active ? colors.primaryForeground : colors.mutedForeground
                      }
                    />
                    <Text
                      style={[
                        styles.appearanceText,
                        {
                          color: active
                            ? colors.primaryForeground
                            : colors.foreground,
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* SYC-63: always here, whether or not an email was ever given
              (email-capture §3.5). Existing styles only. */}
          <Pressable
            testID="delete-my-data-row"
            accessibilityRole="button"
            accessibilityLabel={t('deleteMyDataRow')}
            accessibilityHint={t('deleteMyDataRowHint')}
            onPress={() => router.push('/delete-my-data')}
            style={[
              styles.deleteRow,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                {t('deleteMyDataRow')}
              </Text>
              <Text style={[styles.deleteRowHint, { color: colors.mutedForeground }]}>
                {t('deleteMyDataRowHint')}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  nameNote: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  nameNoteText: { fontFamily: fonts.body, fontSize: fontSizes.sm, lineHeight: 20 },
  nameNoteActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  container: { flex: 1 },
  loadingBox: { paddingVertical: 60, alignItems: 'center' },
  hero: {
    alignItems: 'center',
    paddingBottom: spacing[6],
    paddingHorizontal: spacing[4],
    overflow: 'hidden',
  },
  heroPaw: {
    position: 'absolute',
    left: -10,
    bottom: -20,
    fontSize: 110,
    opacity: 0.12,
    transform: [{ rotate: '12deg' }],
  },
  username: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.xl,
    marginTop: spacing[2],
  },
  heroSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[1],
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  heroSub: {
    fontFamily: fonts.body,
    fontSize: fontSizes.xs,
    opacity: 0.85,
  },
  streakChip: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: spacing[3],
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  streakChipText: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes['2xs'],
    color: '#fff',
  },
  statsError: {
    fontFamily: fonts.body,
    fontSize: fontSizes['2xs'],
    textAlign: 'center',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  statTile: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes['2xs'],
    textTransform: 'uppercase',
  },
  badgeHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  badgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  badgeCell: {
    width: '21%',
    alignItems: 'center',
    gap: spacing[1],
  },
  badgeIconTile: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockEmoji: { fontSize: 20 },
  badgeName: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes['3xs'],
    textAlign: 'center',
  },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rank: { fontSize: 13, fontFamily: 'Inter_700Bold', width: 32 },
  leaderName: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  leaderPoints: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  langRow: { flexDirection: 'row', gap: 10 },
  langBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  langText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing[3],
    minHeight: 44,
  },
  deleteRowHint: { fontFamily: fonts.body, fontSize: fontSizes.xs },
  appearanceRow: {
    flexDirection: 'row',
    gap: spacing[1],
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing[1],
  },
  appearanceBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    borderRadius: radii.sm,
    paddingHorizontal: spacing[1],
  },
  appearanceText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes['3xs'],
    textAlign: 'center',
  },
});
