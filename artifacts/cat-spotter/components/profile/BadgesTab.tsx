import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { getGetProfileQueryKey, markBadgesSeen } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { BadgeCelebration } from '@/components/celebration/BadgeCelebration';
import { ProgressBar } from '@/components/purropolis';
import { earnedCount, type BadgeView } from '@/lib/badgeProgress';
import { BADGE_GROUPS, BADGE_IDS, type BadgeGroupId } from '@/lib/i18n';
import { BadgeMedal, sharedStyles, useSubtleText } from './shared';

/**
 * SYC-628 §3.3 / SYC-511: every badge with how to earn it; badges not yet
 * earned show how close the spotter is. "Earned" is only ever the server's
 * word (lib/badgeProgress).
 */
export function BadgesTab({
  views,
  state,
}: {
  views: BadgeView[] | null;
  /** Why `views` is null: still loading, never loaded offline, or an old server. */
  state: 'ready' | 'loading' | 'offline' | 'unknown';
}) {
  const colors = useColors();
  const subtle = useSubtleText();
  const { t } = useLanguage();
  const total = BADGE_IDS.length;
  const { deviceId } = useDevice();
  const { isOnline } = useOffline();
  const queryClient = useQueryClient();
  const [replay, setReplay] = useState<string | null>(null);

  // The tab is mounted only while it is showing, so a mount is a visit. Tell the
  // server the new badges were seen once per visit, then refresh the profile so
  // the "New" chips clear. Needs the badge list and a connection.
  const sentRef = useRef(false);
  const hasNew = !!views && views.some((v) => v.isNew);
  useEffect(() => {
    if (sentRef.current || !hasNew || !isOnline || !deviceId) return;
    sentRef.current = true;
    markBadgesSeen(deviceId)
      .then(() => queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey(deviceId) }))
      .catch(() => {
        // The chips simply show again on the next visit.
      });
  }, [hasNew, isOnline, deviceId, queryClient]);

  if (!views) {
    if (state === 'loading') {
      return (
        <View style={sharedStyles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    return (
      <View style={styles.wrap}>
        <Text testID="profile-badges-unknown" style={[sharedStyles.body, { color: subtle }]}>
          {state === 'offline'
            ? t('profileBadgesOffline')
            : t('profileBadgesEarned').replace('{earned}', '—').replace('{total}', String(total))}
        </Text>
      </View>
    );
  }

  const listStyle = [styles.list, { backgroundColor: colors.card, borderColor: colors.border }];
  const groups = (Object.keys(BADGE_GROUPS) as BadgeGroupId[])
    .map((group) => ({ group, items: views.filter((v) => v.group === group) }))
    .filter((g) => g.items.length > 0);

  return (
    <View style={styles.wrap}>
      <Text testID="profile-badges-count" style={[sharedStyles.body, { color: subtle }]}>
        {t('profileBadgesEarned')
          .replace('{earned}', String(earnedCount(views)))
          .replace('{total}', String(total))}
      </Text>

      {groups.map(({ group, items }) => (
        <View key={group} style={styles.group} testID={`badge-group-${group}`}>
          <Text
            accessibilityRole="header"
            style={[sharedStyles.eyebrow, { color: subtle }]}
          >
            {t(`profileBadgeGroup_${group}`)}
          </Text>
          <View style={listStyle}>
            {items.map((v, i) => {
              const showProgress = !v.earned && v.value !== null && v.goal !== null;
              const content = (
                <>
                  <BadgeMedal id={v.id} earned={v.earned} size={44} />
                  <View style={[styles.text, !v.earned && { gap: 4 }]}>
                    <View style={styles.nameLine}>
                      <Text style={[styles.name, styles.flex, { color: colors.foreground }]}>
                        {t(`badge_${v.id}`)}
                      </Text>
                      {v.isNew && (
                        <View
                          testID={`badge-new-${v.id}`}
                          style={[styles.newChip, { backgroundColor: colors.primary }]}
                        >
                          <Text style={[styles.newChipText, { color: colors.primaryForeground }]}>
                            {t('profileBadgeNew')}
                          </Text>
                        </View>
                      )}
                      {showProgress && (
                        <Text testID={`badge-progress-${v.id}`} style={[sharedStyles.body, { color: subtle }]}>
                          {(v.id === 'island_legend' ? t('profileBadgeProgressPoints') : t('profileBadgeCount'))
                            .replace('{value}', String(v.value))
                            .replace('{goal}', String(v.goal))
                            .replace('{earned}', String(v.value))
                            .replace('{total}', String(v.goal))}
                        </Text>
                      )}
                    </View>
                    <Text style={[sharedStyles.body, { color: subtle }]}>{t(`badge_${v.id}_desc`)}</Text>
                    {showProgress && <ProgressBar value={v.value as number} max={v.goal as number} />}
                  </View>
                  {v.earned && (
                    <Feather name="check" size={20} color={colors.success} accessibilityLabel={t('profileBadgesEarnedList')} />
                  )}
                </>
              );
              const rowStyle = [styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }];
              // Only an earned badge can be replayed.
              return v.earned ? (
                <Pressable
                  key={v.id}
                  testID={`badge-row-${v.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${t(`badge_${v.id}`)}. ${t(`badge_${v.id}_desc`)}`}
                  accessibilityHint={t('profileBadgeReplayHint')}
                  onPress={() => setReplay(v.id)}
                  style={rowStyle}
                >
                  {content}
                </Pressable>
              ) : (
                <View key={v.id} testID={`badge-row-${v.id}`} style={rowStyle}>
                  {content}
                </View>
              );
            })}
          </View>
        </View>
      ))}

      {replay !== null && (
        <BadgeCelebration
          quiet
          moment={{ kind: 'badges', badgeIds: [replay] }}
          views={views}
          onDone={() => setReplay(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing[4], gap: spacing[4] },
  group: { gap: spacing[2] },
  list: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  text: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] },
  flex: { flex: 1, minWidth: 0 },
  // Names wrap; never cut off (SYC-511).
  newChip: { borderRadius: 999, paddingHorizontal: spacing[2], paddingVertical: 2 },
  newChipText: { fontFamily: fonts.bodyBold, fontSize: fontSizes.xs },
  name: { fontFamily: fonts.bodyBold, fontSize: fontSizes.md },
});
