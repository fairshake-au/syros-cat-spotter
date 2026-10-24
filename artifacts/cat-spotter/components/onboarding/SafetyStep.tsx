import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, radii, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/purropolis';
import { StepDots } from './StepDots';
import { ONBOARDING_DOT_COUNT, stepIndex } from './steps';
import { decorative } from '@/lib/a11yText';

/**
 * SYC-35: keep-your-distance guidance, on its own screen straight after
 * "How it works". Syros Cats asked for it as health-and-safety cover
 * (PRODUCT-SPEC §2.2). The copy is `onboarding.healthy`
 * (docs/specs/source/safety-copy-translations.md), word for word.
 *
 * There is deliberately no Skip here: Skip on "How it works" lands on this
 * screen, so nobody passes the guidance without seeing it. It fits a
 * 390×844 screen without scrolling in all three languages; the ScrollView
 * is only a fallback for smaller phones and large text settings.
 */
/**
 * The last line ("If you find a cat that is hurt or sick… the app will tell
 * you what to do") promises the cat-in-trouble flow, SYC-42. Samuel decided on
 * 1 Oct 2026 that it ships in the same release as that flow (SYC-42 plan,
 * Decision 7), so SYC-42 Slice 1 switches it on here.
 */
export const SHOW_HURT_LINE = true;

export function SafetyStep({ onNext }: { onNext: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <StepDots total={ONBOARDING_DOT_COUNT} active={stepIndex('safety')} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.column}>
          <View style={[styles.icon, { backgroundColor: palette.terra100 }]}>
            <Text style={styles.iconEmoji} allowFontScaling={false} {...decorative}>
              🐾
            </Text>
          </View>
          <Text role="heading" style={[styles.title, { color: colors.foreground }]}>
            {t('howSafetyTitle')}
          </Text>
          <View style={styles.body}>
            <Text style={[styles.para, { color: colors.foreground }]}>
              {t('howSafetyLiveHere')}
            </Text>
            <Text style={[styles.para, { color: colors.foreground }]}>
              {t('howSafetyDistance')}
            </Text>
            <Text style={[styles.para, { color: colors.foreground }]}>
              {t('howSafetyLeaveBe')}
            </Text>
            {/* SYC-524: the advice that was a card on the retired How it works screen. */}
            <View style={[styles.feedBlock, { backgroundColor: palette.terra100 }]}>
              <Text style={[styles.feedTitle, { color: colors.foreground }]}>
                <Text {...decorative}>🚫 </Text>
                {t('howStepDontFeed')}
              </Text>
              <Text style={[styles.para, { color: colors.foreground }]}>
                {t('safetyDontFeedBody')}
              </Text>
            </View>
            {SHOW_HURT_LINE && (
              <Text style={[styles.para, styles.strong, { color: colors.foreground }]}>
                {t('howSafetyHurt')}
              </Text>
            )}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[4] }]}>
        <Button variant="primary" size="lg" block onPress={onNext}>
          {t('continue')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing[5],
    paddingBottom: 6,
    minHeight: 28,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
  },
  // Keeps lines a readable length on a desktop browser; a no-op on phones.
  column: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: spacing[3] },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmoji: { fontSize: 30 },
  title: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 31 },
  body: { gap: spacing[3] },
  para: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  feedBlock: {
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 4,
  },
  feedTitle: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 22 },
  strong: { fontFamily: fonts.bodyBold },
  footer: {
    width: '100%',
    maxWidth: 560 + spacing[5] * 2,
    alignSelf: 'center',
    paddingHorizontal: spacing[5],
    paddingTop: spacing[2],
  },
});
