import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { notify } from '@/lib/notify';
import { Button } from '@/components/purropolis';
import { FairShakeMark } from '@/components/FairShakeMark';

/**
 * First-run hero. Deliberately renders on the Aegean gradient rather than the
 * page surface — it is the one screen in the app that is pure brand.
 */
export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  // There are no accounts — identity is per-device and anonymous by design.
  // The design asked for this entry point, so it is present and honest about
  // its status rather than dead-ending. Restore across reinstall is ticketed.
  const explainRestore = () => {
    notify(t('welcomeRestoreTitle'), t('welcomeRestoreBody'));
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.aegean600 }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
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

      <View style={[styles.body, { paddingTop: insets.top + spacing[6] }]}>
        <View style={styles.mark}>
          <Text style={styles.markEmoji} allowFontScaling={false}>
            🐈
          </Text>
        </View>
        <Text style={styles.title}>{t('welcomeTitle')}</Text>
        <Text style={styles.subtitle}>{t('welcomeSubtitle')}</Text>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[4] }]}>
        <Button variant="accent" size="lg" block onPress={onNext}>
          {t('welcomeCta')}
        </Button>
        <Pressable onPress={explainRestore} style={styles.restore}>
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
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[5],
  },
  markEmoji: { fontSize: 74 },
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
