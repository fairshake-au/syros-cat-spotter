import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { formatRank } from '@/lib/formatRank';
import type { LeaderRow, RankSummary } from '@/lib/leaderboardView';
import { sharedStyles, useSubtleText } from './shared';

// Gold, silver and bronze discs for the top three; plain numbers after.
const PODIUM = [palette.sun500, palette.stone300, palette.terra300];

/**
 * SYC-628 §3.4: the leaderboard without people on 0 points, with "You"
 * highlighted and a summary of where the spotter stands. Ranks are the
 * server's; nothing is renumbered.
 */
export function SpottersTab({
  rows,
  summary,
  state,
}: {
  rows: LeaderRow[];
  summary: RankSummary | null;
  /** 'ready' once a list has loaded (it may be from before going offline). */
  state: 'ready' | 'loading' | 'offline' | 'error';
}) {
  const colors = useColors();
  const subtle = useSubtleText();
  const { t, language } = useLanguage();

  if (state === 'loading') {
    return (
      <View style={sharedStyles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (state === 'offline' || state === 'error') {
    return (
      <View style={styles.wrap}>
        <Text testID={`profile-spotters-${state}`} style={[sharedStyles.body, { color: subtle }]}>
          {state === 'offline' ? t('profileSpottersOffline') : t('statsUnavailable')}
        </Text>
      </View>
    );
  }

  const summaryLines = summary ? summaryText(summary, t, (n) => formatRank(language, n)) : null;

  return (
    <View style={styles.wrap}>
      {summaryLines && (
        <View testID="profile-rank-summary" style={[styles.summary, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.summaryTitle, { color: colors.secondaryForeground }]}>{summaryLines[0]}</Text>
          {summaryLines[1] ? (
            <Text style={[sharedStyles.body, { color: colors.secondaryForeground }]}>{summaryLines[1]}</Text>
          ) : null}
        </View>
      )}

      {rows.length === 0 ? (
        <Text testID="profile-spotters-empty" style={[sharedStyles.body, { color: subtle }]}>
          {t('profileSpottersEmpty')}
        </Text>
      ) : (
        <>
          <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {rows.map((row, i) => (
              <View
                key={row.spotterCode}
                testID={row.isMe ? 'leader-row-me' : `leader-row-${row.spotterCode}`}
                style={[
                  styles.row,
                  i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                  row.isMe && { backgroundColor: colors.secondary },
                ]}
              >
                <View
                  style={[
                    styles.rank,
                    row.rank <= 3 && { backgroundColor: PODIUM[row.rank - 1] },
                  ]}
                >
                  <Text
                    style={[
                      styles.rankText,
                      { color: row.rank <= 3 ? palette.stone900 : row.isMe ? colors.secondaryForeground : subtle },
                    ]}
                  >
                    {row.rank}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.name,
                    { color: row.isMe ? colors.secondaryForeground : colors.foreground },
                    row.isMe && styles.bold,
                  ]}
                >
                  {row.isMe ? t('you') : row.name}
                </Text>
                <Text style={[styles.points, { color: row.isMe ? colors.secondaryForeground : colors.primary }]}>
                  {row.points}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[sharedStyles.body, styles.note, { color: subtle }]}>{t('profileSpottersNote')}</Text>
        </>
      )}
    </View>
  );
}

/** The summary card's two lines (spec §3.4, §8.4). */
export function summaryText(
  summary: RankSummary,
  t: (key: string) => string,
  rank: (n: number) => string,
): [string, string | null] {
  switch (summary.kind) {
    case 'top':
      return [t('profileRankTop').replace('{points}', String(summary.points)), null];
    case 'level':
      return [
        t('profileRankSummary').replace('{rank}', rank(summary.rank)).replace('{points}', String(summary.points)),
        t('profileRankLevel').replace('{name}', summary.name).replace('{points}', String(summary.points)),
      ];
    case 'behind':
      return [
        t('profileRankSummary').replace('{rank}', rank(summary.rank)).replace('{points}', String(summary.points)),
        t('profileRankPass').replace('{n}', String(summary.gap)).replace('{name}', summary.name),
      ];
    case 'outside':
      return [t('profileRankOutside').replace('{points}', String(summary.points)), t('profileRankOutsideBody')];
    case 'zero':
      return [t('profileRankZero'), null];
  }
}

const styles = StyleSheet.create({
  wrap: { padding: spacing[4], gap: spacing[3] },
  summary: { borderRadius: radii.md, padding: spacing[4], gap: 4 },
  summaryTitle: { fontFamily: fonts.displayBold, fontSize: fontSizes.md },
  list: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: 52,
    paddingHorizontal: spacing[4],
  },
  rank: { width: 28, height: 28, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontFamily: fonts.bodyBold, fontSize: fontSizes.xs },
  name: { flex: 1, minWidth: 0, fontFamily: fonts.bodySemiBold, fontSize: fontSizes.md },
  bold: { fontFamily: fonts.bodyBold },
  points: { fontFamily: fonts.bodyBold, fontSize: fontSizes.md },
  note: { textAlign: 'center' },
});
