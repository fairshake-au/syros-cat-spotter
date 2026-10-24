import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { Button, ProgressBar, StatTile, StatTileGroup } from '@/components/purropolis';
import { earnedCount, nextBadge, type BadgeView } from '@/lib/badgeProgress';
import { BADGE_IDS } from '@/lib/i18n';
import { BadgeMedal, sharedStyles, useSubtleText } from './shared';

const dash = '—';

/**
 * SYC-628 §3.2: the Me tab. Counts (Home's three), the safety reminder while
 * keep-safe is off, the streak, and the badges panel.
 */
export function MeTab({
  firstSpot,
  spotted,
  firstFinds,
  views,
  streakDays,
  showSafeNudge,
  onSeeAllBadges,
}: {
  /** `homeHeroState(profile) === 'firstSpot'` */
  firstSpot: boolean;
  spotted: number | undefined;
  firstFinds: number | undefined;
  /** null: badge list unknown (not loaded, or an old server). */
  views: BadgeView[] | null;
  streakDays: number;
  showSafeNudge: boolean;
  onSeeAllBadges: () => void;
}) {
  const colors = useColors();
  const subtle = useSubtleText();
  const { t } = useLanguage();
  const earned = views ? earnedCount(views) : null;
  const next = views ? nextBadge(views) : null;
  const total = BADGE_IDS.length;
  const card = [sharedStyles.card, { backgroundColor: colors.card, borderColor: colors.border }];

  return (
    <View style={styles.wrap}>
      {firstSpot ? (
        <View testID="profile-first-spot" style={card}>
          <Text style={[sharedStyles.sectionTitle, { color: colors.foreground }]}>
            {t('profileFirstSpotTitle')}
          </Text>
          <Text style={[sharedStyles.body, { color: subtle }]}>{t('profileFirstSpotBody')}</Text>
          <Button variant="accent" block onPress={() => router.push('/spot')}>
            {t('profileSpotACat')}
          </Button>
        </View>
      ) : (
        <View style={styles.counts}>
          <StatTileGroup style={styles.tiles}>
            <View style={styles.tile}>
              <StatTile value={spotted ?? dash} label={t('statSpotted')} tone="aegean" style={styles.tileInner} />
            </View>
            <View style={styles.tile}>
              <StatTile value={firstFinds ?? dash} label={t('statFirstFinds')} tone="sun" style={styles.tileInner} />
            </View>
            <View style={styles.tile}>
              <StatTile value={earned ?? dash} label={t('statBadges')} tone="bougain" style={styles.tileInner} />
            </View>
          </StatTileGroup>
          {/* SYC-594: tucked under the tiles, not 20px away. */}
          <Text testID="profile-first-finds-hint" style={[styles.hint, { color: subtle }]}>
            {t('profileFirstFinds')}: {t('profileFirstFindsHint')}
          </Text>
        </View>
      )}

      {showSafeNudge && (
        <View
          testID="profile-safe-nudge"
          style={[styles.nudge, { backgroundColor: colors.warningSoft }]}
        >
          <Feather name="shield" size={20} color={colors.foreground} />
          <Text style={[styles.nudgeText, { color: colors.foreground }]}>
            <Text style={styles.bold}>{t('profileSafeNudge')}</Text> {t('profileSafeNudgeBody')}
          </Text>
          <Button variant="primary" size="sm" onPress={() => router.push('/keep-safe')}>
            {t('profileSafeNudgeAdd')}
          </Button>
        </View>
      )}

      {streakDays > 0 && (
        <View testID="profile-streak" style={[card, styles.row]}>
          <View style={[styles.streakIcon, { backgroundColor: palette.terra100 }]}>
            <Feather name="zap" size={22} color={palette.terra700} />
          </View>
          <View style={styles.flex}>
            <Text style={[sharedStyles.sectionTitle, { color: colors.foreground }]}>
              {t('profileStreak').replace('{n}', String(streakDays))}
            </Text>
            <Text style={[sharedStyles.body, { color: subtle }]}>{t('profileStreakBody')}</Text>
          </View>
        </View>
      )}

      {views && (
        <View testID="profile-badges-panel" style={card}>
          <View style={styles.panelHead}>
            <Text style={[sharedStyles.sectionTitle, { color: colors.foreground }]}>
              {t('statBadges')}
              <Text style={[styles.headCount, { color: subtle }]}>
                {` · ${t('profileBadgeCount')
                  .replace('{earned}', String(earned))
                  .replace('{total}', String(total))}`}
              </Text>
            </Text>
            <Pressable
              testID="profile-badges-see-all"
              accessibilityRole="button"
              onPress={onSeeAllBadges}
              style={styles.seeAll}
            >
              <Text style={[styles.seeAllText, { color: colors.primary }]}>{t('seeAll')}</Text>
            </Pressable>
          </View>

          {next ? (
            <View testID="profile-next-badge" style={styles.row}>
              <BadgeMedal id={next.id} earned={false} size={56} />
              <View style={[styles.flex, { gap: 4 }]}>
                <Text style={[sharedStyles.eyebrow, { color: subtle }]}>{t('profileNextBadge')}</Text>
                <Text style={[styles.nextName, { color: colors.foreground }]}>{t(`badge_${next.id}`)}</Text>
                <Text style={[sharedStyles.body, { color: subtle }]}>
                  {next.value === null
                    ? t(`badge_${next.id}_desc`)
                    : `${t(`badge_${next.id}_desc`)} · ${t('profileToGo').replace('{n}', String(next.goal - next.value))}`}
                </Text>
                {next.value !== null && <ProgressBar value={next.value} max={next.goal} />}
              </View>
            </View>
          ) : (
            <Text testID="profile-all-badges" style={[sharedStyles.body, { color: colors.foreground }]}>
              {t('profileAllBadges')}
            </Text>
          )}

          <Pressable
            testID="profile-badge-row"
            accessibilityRole="button"
            accessibilityLabel={t('profileBadgesRowLabel')
              .replace('{earned}', String(earned))
              .replace('{total}', String(total))}
            onPress={onSeeAllBadges}
            style={[styles.medalRow, { borderTopColor: colors.border }]}
          >
            {views.map((v) => (
              <BadgeMedal key={v.id} id={v.id} earned={v.earned} size={36} />
            ))}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing[4], gap: spacing[4] },
  counts: { gap: spacing[1] },
  tiles: { flexDirection: 'row', gap: spacing[2] },
  tile: { flex: 1, minWidth: 0 },
  tileInner: { minWidth: 0, paddingHorizontal: spacing[3] },
  hint: { fontFamily: fonts.body, fontSize: fontSizes.xs, lineHeight: 18 },
  nudge: {
    borderRadius: radii.md,
    padding: spacing[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  nudgeText: { flex: 1, fontFamily: fonts.body, fontSize: fontSizes.xs, lineHeight: 18 },
  bold: { fontFamily: fonts.bodyBold },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  streakIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  headCount: { fontFamily: fonts.body, fontSize: fontSizes.sm },
  seeAll: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  seeAllText: { fontFamily: fonts.bodyBold, fontSize: fontSizes.sm },
  nextName: { fontFamily: fonts.displayBold, fontSize: fontSizes.lg },
  medalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    paddingTop: spacing[3],
    borderTopWidth: 1,
  },
});
