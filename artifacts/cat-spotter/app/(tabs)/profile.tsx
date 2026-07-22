import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useGetProfile,
  useGetLeaderboard,
  useUpdateProfile,
  getGetProfileQueryKey,
  getGetLeaderboardQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { OfflineBanner } from '@/components/OfflineBanner';
import { UsernameEditor } from '@/components/UsernameEditor';
import { BADGE_IDS, BADGE_ICONS, LANGUAGES } from '@/lib/i18n';

export default function ProfileScreen() {
  const colors = useColors();
  const { t, language, setLanguage } = useLanguage();
  const insets = useSafeAreaInsets();
  const { deviceId } = useDevice();
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
  const earned = new Set(profile?.badges ?? []);

  const queryClient = useQueryClient();
  const [nicknameDraft, setNicknameDraft] = React.useState('');
  const [nicknameSaved, setNicknameSaved] = React.useState(false);
  React.useEffect(() => {
    setNicknameDraft(profile?.nickname ?? '');
  }, [profile?.nickname]);
  const updateProfile = useUpdateProfile({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetProfileQueryKey(deviceId ?? ''), updated);
        queryClient.invalidateQueries({ queryKey: getGetLeaderboardQueryKey() });
        setNicknameSaved(true);
        setTimeout(() => setNicknameSaved(false), 2000);
      },
    },
  });
  const trimmedDraft = nicknameDraft.trim();
  const nicknameDirty = trimmedDraft !== (profile?.nickname ?? '');
  const saveNickname = () => {
    if (!deviceId || !nicknameDirty || updateProfile.isPending) return;
    updateProfile.mutate({
      deviceId,
      data: { nickname: trimmedDraft.length > 0 ? trimmedDraft : null },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t('tabProfile')}
        </Text>
      </View>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 20,
          paddingBottom: insets.bottom + (Platform.OS === 'web' ? 110 : 100),
        }}
      >
        {profileQuery.isLoading && isOnline ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <View
            style={[
              styles.pointsCard,
              { backgroundColor: colors.primary },
            ]}
          >
            {!!profile?.username && (
              <Text style={[styles.username, { color: colors.primaryForeground }]}>
                {profile.username}
              </Text>
            )}
            <Text style={[styles.pointsValue, { color: colors.primaryForeground }]}>
              {profile?.points ?? 0}
            </Text>
            <Text style={[styles.pointsLabel, { color: colors.primaryForeground }]}>
              {t('points')}
            </Text>
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: colors.primaryForeground }]}>
                  {profile?.totalSightings ?? 0}
                </Text>
                <Text style={[styles.statLabel, { color: colors.primaryForeground }]}>
                  {t('totalSightings')}
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: colors.primaryForeground }]}>
                  {profile?.catsSpotted ?? 0}
                </Text>
                <Text style={[styles.statLabel, { color: colors.primaryForeground }]}>
                  {t('catsSpotted')}
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: colors.primaryForeground }]}>
                  {profile?.uniqueCatsDiscovered ?? 0}
                </Text>
                <Text style={[styles.statLabel, { color: colors.primaryForeground }]}>
                  {t('uniqueCats')}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Username */}
        {isOnline && !!deviceId && (
          <UsernameEditor currentUsername={profile?.username ?? null} />
        )}

        {/* Nickname */}
        {isOnline && !!deviceId && (
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {t('nickname')}
            </Text>
            <View style={styles.nicknameRow}>
              <TextInput
                value={nicknameDraft}
                onChangeText={setNicknameDraft}
                placeholder={t('nicknamePlaceholder')}
                placeholderTextColor={colors.mutedForeground}
                maxLength={24}
                returnKeyType="done"
                onSubmitEditing={saveNickname}
                style={[
                  styles.nicknameInput,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                  },
                ]}
              />
              <Pressable
                onPress={saveNickname}
                disabled={!nicknameDirty || updateProfile.isPending}
                style={[
                  styles.saveBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: !nicknameDirty || updateProfile.isPending ? 0.5 : 1,
                  },
                ]}
              >
                {updateProfile.isPending ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.saveText, { color: colors.primaryForeground }]}>
                    {nicknameSaved ? t('saved') : t('save')}
                  </Text>
                )}
              </Pressable>
            </View>
            <Text style={[styles.nicknameHint, { color: colors.mutedForeground }]}>
              {t('nicknameHint')}
            </Text>
          </View>
        )}

        {/* Badges */}
        <View style={{ gap: 10 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {t('badges')}
          </Text>
          <View style={styles.badgeGrid}>
            {BADGE_IDS.map((id) => {
              const has = earned.has(id);
              return (
                <View
                  key={id}
                  style={[
                    styles.badge,
                    {
                      backgroundColor: has ? colors.secondary : colors.muted,
                      borderColor: has ? colors.primary : colors.border,
                      opacity: has ? 1 : 0.55,
                    },
                  ]}
                >
                  <Feather
                    name={(BADGE_ICONS[id] ?? 'award') as never}
                    size={20}
                    color={has ? colors.primary : colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.badgeName,
                      { color: has ? colors.foreground : colors.mutedForeground },
                    ]}
                    numberOfLines={1}
                  >
                    {t(`badge_${id}`)}
                  </Text>
                  <Text
                    style={[styles.badgeDesc, { color: colors.mutedForeground }]}
                    numberOfLines={2}
                  >
                    {t(`badge_${id}_desc`)}
                  </Text>
                </View>
              );
            })}
          </View>
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
                <View
                  key={entry.spotterCode}
                  style={[
                    styles.leaderRow,
                    {
                      backgroundColor: isMe ? colors.secondary : colors.card,
                      borderColor: isMe ? colors.primary : colors.border,
                    },
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
                        entry.nickname ??
                        `${t('spotter')} ${entry.spotterCode}`;
                      return isMe
                        ? entry.username || entry.nickname
                          ? `${displayName} (${t('you')})`
                          : t('you')
                        : displayName;
                    })()}
                  </Text>
                  <Text style={[styles.leaderPoints, { color: colors.primary }]}>
                    {entry.points} {t('points')}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 10 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  pointsCard: {
    borderRadius: 18,
    padding: 20,
    alignItems: 'center',
    gap: 2,
  },
  username: { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  pointsValue: { fontSize: 44, fontFamily: 'Inter_700Bold' },
  pointsLabel: { fontSize: 14, fontFamily: 'Inter_500Medium', opacity: 0.9 },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignSelf: 'stretch',
    marginTop: 16,
  },
  stat: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', opacity: 0.85 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  badgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  badge: {
    width: '47.5%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  badgeName: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  badgeDesc: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rank: { fontSize: 13, fontFamily: 'Inter_600SemiBold', width: 32 },
  leaderName: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium' },
  leaderPoints: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  nicknameRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  nicknameInput: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  saveBtn: {
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 76,
  },
  saveText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  nicknameHint: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  langRow: { flexDirection: 'row', gap: 10 },
  langBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  langText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
