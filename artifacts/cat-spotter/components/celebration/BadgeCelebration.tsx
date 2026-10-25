import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { nextInGroup, type BadgeView } from '@/lib/badgeProgress';
import { BADGE_EMOJI } from '@/lib/i18n';
import { formatRank } from '@/lib/formatRank';
import { Confetti } from './Confetti';
import { useCelebrationFeedback } from './useCelebrationFeedback';

export interface CelebrationMoment {
  kind: 'badges' | 'week_result' | 'history';
  badgeIds: string[];
  place?: number | null;
  weekPoints?: number | null;
}

const emojiOf = (id: string) => (BADGE_EMOJI as Record<string, string | undefined>)[id] ?? '🏅';

/** A round medal with a sun-yellow ring. In the celebration it grows in with a shine. */
function Medal({ id, size, animate }: { id: string; size: number; animate: boolean }) {
  const grow = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const shine = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    const native = Platform.OS !== 'web';
    const run = Animated.parallel([
      Animated.spring(grow, { toValue: 1, friction: 4, tension: 60, useNativeDriver: native }),
      Animated.timing(shine, {
        toValue: 1,
        delay: 800,
        duration: 1400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: native,
      }),
    ]);
    run.start();
    return () => run.stop();
  }, [animate, grow, shine]);

  return (
    <Animated.View
      testID={animate ? 'celebration-medal' : undefined}
      accessible={false}
      style={[
        styles.medal,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          transform: [
            { scale: grow.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) },
            { rotate: grow.interpolate({ inputRange: [0, 1], outputRange: ['-25deg', '0deg'] }) },
          ],
          opacity: grow.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
        },
      ]}
    >
      <Text style={{ fontSize: Math.round(size * 0.5) }}>{emojiOf(id)}</Text>
      {animate && (
        <Animated.View
          testID="celebration-shine"
          pointerEvents="none"
          style={[
            styles.shine,
            {
              transform: [
                { translateX: shine.interpolate({ inputRange: [0, 1], outputRange: [-size, size] }) },
                { rotate: '20deg' },
              ],
            },
          ]}
        />
      )}
    </Animated.View>
  );
}

function ProgressLine({ value, goal }: { value: number; goal: number }) {
  const { t } = useLanguage();
  const pct = Math.max(0, Math.min(100, (value / goal) * 100));
  return (
    <>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: goal, now: value }}
        style={styles.barTrack}
      >
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.count}>
        {t('celebrateProgress').replace('{value}', String(value)).replace('{goal}', String(goal))}
      </Text>
    </>
  );
}

function NextBox({ id, views }: { id: string; views: BadgeView[] }) {
  const { t } = useLanguage();
  const next = nextInGroup(views, id);
  if (!next) {
    return (
      <View style={styles.next} testID="celebration-group-done">
        <Text style={styles.nextText}>{t('celebrateGroupDone')}</Text>
      </View>
    );
  }
  return (
    <View style={styles.next} testID="celebration-next">
      <Text style={styles.nextText}>
        <Text style={styles.nextBold}>
          {t('celebrateNext')} {t(`badge_${next.id}`)} {emojiOf(next.id)}
        </Text>
        {' · '}
        {t(`badge_${next.id}_desc`)}
      </Text>
      {next.goal !== null && next.value !== null && <ProgressLine value={next.value} goal={next.goal} />}
    </View>
  );
}

export function BadgeCelebration({
  moment,
  views,
  onDone,
  quiet = false,
}: {
  moment: CelebrationMoment;
  views: BadgeView[];
  onDone: () => void;
  /** A replay from the Badges tab: no confetti, sound or buzz. */
  quiet?: boolean;
}) {
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { play } = useCelebrationFeedback();
  const [index, setIndex] = useState(0);

  const history = moment.kind === 'history';
  // A week result that arrives without badge ids still shows its medal.
  const ids =
    moment.kind === 'week_result' && moment.badgeIds.length === 0
      ? [moment.place === 1 ? 'champion' : 'podium']
      : moment.badgeIds;
  const total = history ? 1 : ids.length;
  const id = history ? undefined : ids[index];

  // One chime and buzz per screen shown.
  const playRef = useRef(play);
  playRef.current = play;
  useEffect(() => {
    if (!quiet) playRef.current();
  }, [quiet, index]);

  const seeAll = () => {
    router.push({ pathname: '/profile', params: { tab: 'badges' } });
    onDone();
  };
  const advance = () => {
    if (index + 1 < total) setIndex(index + 1);
    else onDone();
  };

  const showConfetti = !quiet && !reduced;
  const weekLine =
    moment.kind === 'week_result' && moment.place != null && moment.weekPoints != null
      ? t('celebrateWeekLine')
          .replace('{place}', formatRank(language, moment.place))
          .replace('{points}', String(moment.weekPoints))
      : null;

  return (
    <Modal visible animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <View style={styles.root} testID="badge-celebration">
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <RadialGradient id="aegean" cx="50%" cy="38%" r="75%">
              <Stop offset="0" stopColor={palette.aegean600} />
              <Stop offset="0.7" stopColor={palette.aegean900} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#aegean)" />
        </Svg>
        {showConfetti && <Confetti key={index} />}
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + spacing[8], paddingBottom: insets.bottom + spacing[5] },
          ]}
        >
          {history ? (
            <>
              <Text style={styles.eyebrow}>{t('celebrateEyebrow')}</Text>
              <View style={styles.row}>
                {ids.map((b) => (
                  <View key={b} style={styles.rowItem}>
                    <Medal id={b} size={64} animate={false} />
                    <Text style={styles.rowName}>{t(`badge_${b}`)}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.name} testID="celebration-history-title">
                {t('celebrateHistoryTitle').replace('{n}', String(ids.length))}
              </Text>
            </>
          ) : id ? (
            <>
              {weekLine && index === 0 && (
                <Text style={styles.weekLine} testID="celebration-week-line">
                  {weekLine}
                </Text>
              )}
              <Text style={styles.eyebrow}>
                {t(moment.kind === 'week_result' ? 'celebrateWeekEyebrow' : 'celebrateEyebrow')}
              </Text>
              <Medal key={id} id={id} size={116} animate={!quiet && !reduced} />
              <Text style={styles.name}>{t(`badge_${id}`)}</Text>
              <Text style={styles.means}>{t(`badge_${id}_means`)}</Text>
              <NextBox id={id} views={views} />
              {total > 1 && (
                <Text style={styles.counter}>
                  {t('celebrateCounter').replace('{n}', String(index + 1)).replace('{total}', String(total))}
                </Text>
              )}
            </>
          ) : weekLine ? (
            <Text style={styles.name} testID="celebration-week-line">
              {weekLine}
            </Text>
          ) : null}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[5] }]}>
          <Pressable accessibilityRole="button" onPress={advance} style={styles.button} testID="celebration-close">
            <Text style={styles.buttonText}>{t('celebrateClose')}</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={seeAll} hitSlop={8} testID="celebration-see-all">
            <Text style={styles.link}>{t('celebrateSeeAll')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.aegean900 },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  eyebrow: {
    color: palette.sun500,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes['2xs'],
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  weekLine: {
    color: palette.stone000,
    fontFamily: fonts.bodySemiBold,
    fontSize: fontSizes.md,
    textAlign: 'center',
    marginBottom: spacing[4],
  },
  medal: {
    backgroundColor: palette.olive300,
    borderColor: palette.sun500,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: spacing[4],
    marginBottom: spacing[3],
  },
  shine: {
    position: 'absolute',
    top: -20,
    bottom: -20,
    width: 36,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  name: {
    color: palette.stone000,
    fontFamily: fonts.displayBold,
    fontSize: fontSizes['2xl'],
    textAlign: 'center',
    marginTop: spacing[1],
    marginBottom: spacing[2],
  },
  means: {
    color: palette.stone000,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: Math.round(fontSizes.md * 1.4),
    textAlign: 'center',
    opacity: 0.92,
  },
  next: {
    marginTop: spacing[4],
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radii.md,
    padding: spacing[3],
  },
  nextText: { color: palette.stone000, fontFamily: fonts.body, fontSize: fontSizes.xs },
  nextBold: { fontFamily: fonts.bodyBold },
  barTrack: {
    height: 6,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: spacing[2],
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: palette.sun500 },
  count: {
    color: palette.stone000,
    fontFamily: fonts.body,
    fontSize: fontSizes['2xs'],
    opacity: 0.75,
    marginTop: spacing[1],
  },
  counter: {
    color: palette.stone000,
    fontFamily: fonts.body,
    fontSize: fontSizes['2xs'],
    opacity: 0.75,
    marginTop: spacing[3],
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing[3], marginVertical: spacing[4] },
  rowItem: { alignItems: 'center', width: 84 },
  rowName: {
    color: palette.stone000,
    fontFamily: fonts.bodySemiBold,
    fontSize: fontSizes['2xs'],
    textAlign: 'center',
    marginTop: spacing[1],
  },
  footer: { paddingHorizontal: spacing[5], alignItems: 'center', width: '100%', maxWidth: 480, alignSelf: 'center' },
  button: {
    alignSelf: 'stretch',
    backgroundColor: palette.sun500,
    borderRadius: radii.pill,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  buttonText: { color: palette.stone900, fontFamily: fonts.bodyBold, fontSize: fontSizes.md },
  link: {
    color: palette.stone000,
    fontFamily: fonts.body,
    fontSize: fontSizes.xs,
    textDecorationLine: 'underline',
    opacity: 0.85,
    marginTop: spacing[3],
  },
});
