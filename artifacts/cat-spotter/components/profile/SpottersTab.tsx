import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { formatRank } from '@/lib/formatRank';
import type { LeaderRow, RankSummary } from '@/lib/leaderboardView';
import { weekCountdown } from '@/lib/weekCountdown';
import { sharedStyles, useSubtleText } from './shared';

// Gold, silver and bronze discs for the top three; plain numbers after.
const PODIUM = [palette.sun500, palette.stone300, palette.terra300];

export type SpottersState = 'ready' | 'loading' | 'offline' | 'error';

export interface BoardData {
  rows: LeaderRow[];
  summary: RankSummary | null;
  /** 'ready' once a list has loaded (it may be from before going offline). */
  state: SpottersState;
}

export interface WeekData extends BoardData {
  /** When the week closes (next Monday 00:00 Athens), from the server. */
  endsAt?: string;
  /** Last week's frozen top three; a null name is "a spotter". */
  lastWeek: { place: number; name: string | null; points: number }[];
}

/**
 * SYC-628 §3.4 and SYC-706 §1: the Spotters board, opening on This week with a
 * switch to All time. Ranks are the server's; nothing is renumbered. `now` is
 * injectable so the countdown is testable.
 */
export function SpottersTab({
  week,
  allTime,
  now,
}: {
  week: WeekData;
  allTime: BoardData;
  now?: Date;
}) {
  const colors = useColors();
  const subtle = useSubtleText();
  const { t, language } = useLanguage();
  // Mounted fresh each time the tab opens, so it always starts on This week.
  const [period, setPeriod] = useState<'week' | 'all'>('week');
  const isWeek = period === 'week';
  const { rows, summary, state } = isWeek ? week : allTime;

  const switcher = (
    <View accessibilityRole="tablist" style={[styles.switch, { backgroundColor: colors.muted }]}>
      {(['week', 'all'] as const).map((key) => {
        const active = key === period;
        return (
          <Pressable
            key={key}
            testID={`spotters-period-${key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            aria-selected={active}
            onPress={() => setPeriod(key)}
            style={[styles.segment, active && { backgroundColor: colors.card }]}
          >
            <Text
              style={[
                styles.segmentText,
                { color: active ? colors.foreground : subtle },
                active && styles.bold,
              ]}
            >
              {key === 'week' ? t('spottersThisWeek') : t('spottersAllTime')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (state === 'loading') {
    return (
      <View style={styles.wrap}>
        {switcher}
        <View style={sharedStyles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }
  if (state === 'offline' || state === 'error') {
    return (
      <View style={styles.wrap}>
        {switcher}
        <Text testID={`profile-spotters-${state}`} style={[sharedStyles.body, { color: subtle }]}>
          {state === 'offline' ? t('profileSpottersOffline') : t('statsUnavailable')}
        </Text>
      </View>
    );
  }

  const weekEmpty = isWeek && rows.length === 0;
  const summaryLines =
    summary && !weekEmpty ? summaryText(summary, t, (n) => formatRank(language, n), isWeek) : null;
  const countdown = isWeek && week.endsAt ? countdownText(week.endsAt, now ?? new Date(), t) : null;
  const lastWeekNames = week.lastWeek.map((w) => w.name ?? t('aSpotter')).join(', ');

  return (
    <View style={styles.wrap}>
      {switcher}
      {summaryLines && (
        <View testID="profile-rank-summary" style={[styles.summary, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.summaryTitle, { color: colors.secondaryForeground }]}>{summaryLines[0]}</Text>
          {summaryLines[1] ? (
            <Text style={[sharedStyles.body, { color: colors.secondaryForeground }]}>{summaryLines[1]}</Text>
          ) : null}
        </View>
      )}
      {countdown && (
        <Text testID="spotters-countdown" style={[sharedStyles.body, styles.note, { color: subtle }]}>
          {countdown}
        </Text>
      )}

      {rows.length === 0 ? (
        <Text
          testID={isWeek ? 'spotters-week-empty' : 'profile-spotters-empty'}
          style={[sharedStyles.body, { color: subtle }]}
        >
          {isWeek ? t('spottersWeekEmpty') : t('profileSpottersEmpty')}
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
                  {row.isMe ? t('profileYou') : row.name}
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

      {isWeek && week.lastWeek.length > 0 && (
        <Text testID="spotters-last-week" style={[sharedStyles.body, styles.note, { color: subtle }]}>
          {t('spottersLastWeek').replace('{names}', lastWeekNames)}
        </Text>
      )}
    </View>
  );
}

/** "New week in 3 days" / "in 5 hours" (Athens calendar days from the server's endsAt). */
function countdownText(endsAt: string, now: Date, t: (key: string) => string): string | null {
  const c = weekCountdown(endsAt, now);
  if (!c) return null;
  if (c.unit === 'days') {
    return c.n === 1 ? t('spottersNewWeekInDay') : t('spottersNewWeekInDays').replace('{n}', String(c.n));
  }
  return c.n === 1 ? t('spottersNewWeekInHour') : t('spottersNewWeekInHours').replace('{n}', String(c.n));
}

/** The summary card's two lines (spec §3.4, §8.4). */
export function summaryText(
  summary: RankSummary,
  t: (key: string) => string,
  rank: (n: number) => string,
  week = false,
): [string, string | null] {
  if (week) {
    switch (summary.kind) {
      case 'top':
        return [t('spottersWeekTop').replace('{points}', String(summary.points)), null];
      case 'level':
        return [
          t('spottersWeekRank').replace('{rank}', rank(summary.rank)).replace('{points}', String(summary.points)),
          t('spottersWeekLevel').replace('{name}', summary.name).replace('{points}', String(summary.points)),
        ];
      case 'behind':
        return [
          t('spottersWeekRank').replace('{rank}', rank(summary.rank)).replace('{points}', String(summary.points)),
          t('spottersWeekPass').replace('{n}', String(summary.gap)).replace('{name}', summary.name),
        ];
      case 'outside':
        return [t('spottersWeekOutside').replace('{points}', String(summary.points)), t('profileRankOutsideBody')];
      case 'zero':
        return [t('profileRankZero'), null];
    }
  }
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
  switch: { flexDirection: 'row', borderRadius: radii.pill, padding: 3 },
  // SYC-644: a 44pt minimum tap area, as on the Map/List toggle.
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
  },
  segmentText: { fontFamily: fonts.bodySemiBold, fontSize: fontSizes.sm },
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
