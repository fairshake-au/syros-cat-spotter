import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { LANGUAGES } from '@/lib/i18n';
import { Button } from '@/components/purropolis';
import { FairShakeMark } from '@/components/FairShakeMark';
import { decorative, spokenText } from '@/lib/a11yText';

/**
 * First-run hero. Deliberately renders on the Aegean gradient rather than the
 * page surface — it is the one screen in the app that is pure brand.
 */
/** SYC-524: the old How it works screen, folded into Welcome. */
const STEPS = [
  { icon: '📍', title: 'howStepSpot', body: 'howStepSpotBody' },
  { icon: '🐱', title: 'howStepCatalog', body: 'howStepCatalogBody' },
  { icon: '❤️', title: 'howStepHelp', body: 'howStepHelpBody' },
] as const;

export function WelcomeStep({ onNext, onRestore }: { onNext: () => void; onRestore: () => void }) {
  const insets = useSafeAreaInsets();
  const { t, language, setLanguage } = useLanguage();

  return (
    <View style={[styles.container, { backgroundColor: palette.aegean600 }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill} {...decorative}>
        <Text style={[styles.paw, styles.paw1]} allowFontScaling={false}>
          🐾
        </Text>
        <Text style={[styles.paw, styles.paw2]} allowFontScaling={false}>
          🐾
        </Text>
        <Text style={[styles.paw, styles.paw3]} allowFontScaling={false}>
          🐾
        </Text>
      </View>

      {/* SYC-155: change language before "How it works" and the safety guidance. */}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('language')}
        style={[styles.languages, { paddingTop: insets.top + spacing[3] }]}
      >
        {LANGUAGES.map((lang) => {
          const selected = lang.code === language;
          return (
            <Pressable
              key={lang.code}
              onPress={() => setLanguage(lang.code)}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              aria-checked={selected}
              accessibilityLabel={lang.label}
              hitSlop={6}
              style={[styles.languageChip, selected && styles.languageChipSelected]}
            >
              <Text
                style={[styles.languageText, selected && styles.languageTextSelected]}
              >
                {lang.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.body, { paddingTop: spacing[4] }]}>
        <View style={styles.mark}>
          <Text style={styles.markEmoji} allowFontScaling={false}>
            🐈
          </Text>
        </View>
        <Text style={styles.title}>{t('welcomeTitle')}</Text>
        <Text style={styles.subtitle} accessibilityLabel={spokenText(t('welcomeSubtitle'))}>
          {t('welcomeSubtitle')}
        </Text>
        <View style={styles.steps}>
          {STEPS.map((step) => (
            <View
              key={step.title}
              accessible
              accessibilityLabel={`${t(step.title)}. ${t(step.body)}`}
              style={styles.step}
            >
              <View style={styles.stepIcon} {...decorative}>
                <Text style={styles.stepEmoji} allowFontScaling={false} {...decorative}>
                  {step.icon}
                </Text>
              </View>
              <View style={styles.stepText}>
                <Text style={styles.stepTitle}>{t(step.title)}</Text>
                <Text style={styles.stepBody}>{t(step.body)}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[4] }]}>
        <Button variant="accent" size="lg" block onPress={onNext}>
          {t('welcomeCta')}
        </Button>
        {/* SYC-3: "Already a spotter? Get your spots back". */}
        <Pressable onPress={onRestore} accessibilityRole="button" style={styles.restore}>
          <Text style={styles.restoreText}>{t('welcomeHaveAccount')}</Text>
        </Pressable>
        <View style={styles.attribution}>
          <Text style={styles.madeWith}>{t('welcomeMadeWith')}</Text>
          <View style={styles.byline}>
            <FairShakeMark size={15} />
            <Text style={styles.fairShake}>Fair Shake</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  languages: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing[2],
    paddingHorizontal: spacing[5],
  },
  languageChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  languageChipSelected: { backgroundColor: '#fff', borderColor: '#fff' },
  languageText: {
    fontFamily: fonts.displaySemiBold,
    fontSize: fontSizes.sm,
    color: '#fff',
  },
  languageTextSelected: { color: palette.aegean600 },
  paw: { position: 'absolute', opacity: 0.1, color: '#fff' },
  paw1: { top: 96, left: -30, fontSize: 120 },
  paw2: { top: 300, right: -20, fontSize: 80 },
  paw3: { bottom: 230, left: 40, fontSize: 54 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
  },
  mark: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[5],
  },
  markEmoji: { fontSize: 54 },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 32,
    lineHeight: 36,
    color: '#fff',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    marginTop: spacing[3],
    maxWidth: 290,
  },
  steps: { alignSelf: 'stretch', gap: spacing[2], marginTop: spacing[4] },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radii.lg,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  stepIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepEmoji: { fontSize: 20 },
  stepText: { flex: 1 },
  stepTitle: { fontFamily: fonts.displayBold, fontSize: 14.5, color: '#fff' },
  stepBody: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.9)',
  },
  footer: { paddingHorizontal: spacing[5], gap: spacing[3] },
  restore: { paddingVertical: 6, alignItems: 'center' },
  restoreText: {
    fontFamily: fonts.displaySemiBold,
    fontSize: fontSizes.sm,
    color: 'rgba(255,255,255,0.9)',
  },
  attribution: { alignItems: 'center', gap: 6, marginTop: 4 },
  madeWith: {
    fontFamily: fonts.body,
    fontSize: fontSizes['2xs'],
    color: 'rgba(255,255,255,0.62)',
    textAlign: 'center',
  },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fairShake: {
    // The Fair Shake wordmark is set in its own brand face, not Purropolis's.
    fontFamily: Platform.select({
      web: "'Schibsted Grotesk', 'DM Sans', system-ui, sans-serif",
      default: fonts.displayBold,
    }),
    fontWeight: '800',
    fontSize: 12.5,
    letterSpacing: -0.375,
    color: '#fff',
  },
});
