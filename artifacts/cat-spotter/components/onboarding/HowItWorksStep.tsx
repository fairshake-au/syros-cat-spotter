import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, shadows, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/purropolis';
import { StepDots } from './StepDots';

export function HowItWorksStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const [requesting, setRequesting] = useState(false);

  const steps = [
    { emoji: '📍', tint: palette.aegean100, title: t('howStep1Title'), body: t('howStep1Body') },
    { emoji: '🐱', tint: palette.sun100, title: t('howStep2Title'), body: t('howStep2Body') },
    { emoji: '❤️', tint: palette.bougain100, title: t('howStep3Title'), body: t('howStep3Body') },
  ];

  // Ask up front so the map and the spot flow have coordinates when first used.
  // A refusal is not a blocker — the app still works, it just can't sort by
  // distance, so we advance either way.
  const allowAndContinue = async () => {
    setRequesting(true);
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      // Permission dialogs can throw on unsupported platforms (e.g. web without
      // geolocation). Never let that trap someone in onboarding.
    } finally {
      setRequesting(false);
      onNext();
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Text
          onPress={onSkip}
          suppressHighlighting
          style={[styles.skip, { color: colors.mutedForeground }]}
        >
          {t('skip')}
        </Text>
        <StepDots total={3} active={1} />
        <View style={styles.topBarSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heading}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t('howTitle')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {t('howSubtitle')}
          </Text>
        </View>

        <View style={styles.cards}>
          {steps.map((s, i) => (
            <View
              key={i}
              style={[styles.card, { backgroundColor: colors.card }, shadows.md]}
            >
              <View style={[styles.cardIcon, { backgroundColor: s.tint }]}>
                <Text style={styles.cardEmoji} allowFontScaling={false}>
                  {s.emoji}
                </Text>
              </View>
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  {s.title}
                </Text>
                <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                  {s.body}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[4] }]}>
        <View style={[styles.permission, { backgroundColor: palette.aegean100 }]}>
          <Text style={styles.permissionEmoji} allowFontScaling={false}>
            🗺️
          </Text>
          <View style={styles.permissionText}>
            <Text style={[styles.permissionTitle, { color: palette.aegean700 }]}>
              {t('howLocationTitle')}
            </Text>
            <Text style={[styles.permissionBody, { color: palette.aegean700 }]}>
              {t('howLocationBody')}
            </Text>
          </View>
        </View>
        <Button
          variant="primary"
          size="lg"
          block
          disabled={requesting}
          onPress={allowAndContinue}
        >
          {t('howAllowContinue')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[5],
    paddingBottom: 6,
  },
  skip: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.sm, width: 44 },
  topBarSpacer: { width: 44 },
  scroll: { paddingHorizontal: spacing[5], paddingTop: spacing[5] },
  heading: { gap: 6 },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 26,
    lineHeight: 30,
  },
  subtitle: { fontFamily: fonts.body, fontSize: fontSizes.sm },
  cards: { paddingTop: spacing[5], gap: spacing[3] },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: radii.lg,
    padding: spacing[4],
  },
  cardIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji: { fontSize: 28 },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: fontSizes.md },
  cardBody: { fontFamily: fonts.body, fontSize: fontSizes.xs, lineHeight: 19 },
  footer: { paddingHorizontal: spacing[5], gap: spacing[3] },
  permission: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: radii.md,
    padding: spacing[4],
  },
  permissionEmoji: { fontSize: 22 },
  permissionText: { flex: 1 },
  permissionTitle: { fontFamily: fonts.displayBold, fontSize: fontSizes.xs },
  permissionBody: { fontFamily: fonts.body, fontSize: fontSizes['2xs'], opacity: 0.85 },
});
