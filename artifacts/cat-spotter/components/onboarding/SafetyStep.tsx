import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/purropolis';
import { StepDots } from './StepDots';
import { ONBOARDING_DOT_COUNT, stepIndex } from './steps';

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
        <View style={[styles.icon, { backgroundColor: palette.terra100 }]}>
          <Text style={styles.iconEmoji} allowFontScaling={false}>
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
          <Text style={[styles.para, styles.strong, { color: colors.foreground }]}>
            {t('howSafetyHurt')}
          </Text>
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
    gap: spacing[3],
  },
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
  strong: { fontFamily: fonts.bodyBold },
  footer: { paddingHorizontal: spacing[5], paddingTop: spacing[2] },
});
