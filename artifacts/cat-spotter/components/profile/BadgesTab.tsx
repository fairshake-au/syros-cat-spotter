import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { ProgressBar } from '@/components/purropolis';
import { earnedCount, type BadgeView } from '@/lib/badgeProgress';
import { BADGE_IDS } from '@/lib/i18n';
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

  const earned = views.filter((v) => v.earned);
  const still = views.filter((v) => !v.earned);
  const listStyle = [styles.list, { backgroundColor: colors.card, borderColor: colors.border }];

  return (
    <View style={styles.wrap}>
      <Text testID="profile-badges-count" style={[sharedStyles.body, { color: subtle }]}>
        {t('profileBadgesEarned')
          .replace('{earned}', String(earnedCount(views)))
          .replace('{total}', String(total))}
      </Text>

      {earned.length > 0 && (
        <View style={styles.group}>
          <Text style={[sharedStyles.eyebrow, { color: subtle }]}>{t('profileBadgesEarnedList')}</Text>
          <View style={listStyle}>
            {earned.map((v, i) => (
              <View
                key={v.id}
                testID={`badge-row-${v.id}`}
                style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
              >
                <BadgeMedal id={v.id} earned size={44} />
                <View style={styles.text}>
                  <Text style={[styles.name, { color: colors.foreground }]}>{t(`badge_${v.id}`)}</Text>
                  <Text style={[sharedStyles.body, { color: subtle }]}>{t(`badge_${v.id}_desc`)}</Text>
                </View>
                <Feather name="check" size={20} color={colors.success} accessibilityLabel={t('profileBadgesEarnedList')} />
              </View>
            ))}
          </View>
        </View>
      )}

      {still.length > 0 && (
        <View style={styles.group}>
          <Text style={[sharedStyles.eyebrow, { color: subtle }]}>{t('profileBadgesStill')}</Text>
          <View style={listStyle}>
            {still.map((v, i) => (
              <View
                key={v.id}
                testID={`badge-row-${v.id}`}
                style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
              >
                <BadgeMedal id={v.id} earned={false} size={44} />
                <View style={[styles.text, { gap: 4 }]}>
                  <View style={styles.nameLine}>
                    <Text style={[styles.name, styles.flex, { color: colors.foreground }]}>
                      {t(`badge_${v.id}`)}
                    </Text>
                    {v.value !== null && (
                      <Text testID={`badge-progress-${v.id}`} style={[sharedStyles.body, { color: subtle }]}>
                        {(v.stat === 'points' ? t('profileBadgeProgressPoints') : t('profileBadgeCount'))
                          .replace('{value}', String(v.value))
                          .replace('{goal}', String(v.goal))
                          .replace('{earned}', String(v.value))
                          .replace('{total}', String(v.goal))}
                      </Text>
                    )}
                  </View>
                  <Text style={[sharedStyles.body, { color: subtle }]}>{t(`badge_${v.id}_desc`)}</Text>
                  {v.value !== null && <ProgressBar value={v.value} max={v.goal} />}
                </View>
              </View>
            ))}
          </View>
        </View>
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
  name: { fontFamily: fonts.bodyBold, fontSize: fontSizes.md },
});
