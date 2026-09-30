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

  // The step number is rendered from the index rather than baked into the
  // translated title, so inserting a step never means renumbering copy in three
  // languages.
  const steps = [
    { emoji: '📍', tint: palette.aegean100, title: t('howStepSpot'), body: t('howStepSpotBody') },
    { emoji: '🚫', tint: palette.terra100, title: t('howStepDontFeed'), body: t('howStepDontFeedBody') },
    { emoji: '🐱', tint: palette.sun100, title: t('howStepCatalog'), body: t('howStepCatalogBody') },
    { emoji: '❤️', tint: palette.bougain100, title: t('howStepHelp'), body: t('howStepHelpBody') },
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
          numberOfLines={1}
          style={[styles.skip, { color: colors.mutedForeground }]}
        >
          {t('skip')}
        </Text>
        {/* Centred independently of the Skip label's width. Greek "Παράλειψη"
            is more than twice the length of "Skip", so a fixed-width label and
            matching spacer would either wrap or shove the dots off-centre. */}
        <View style={styles.dots} pointerEvents="none">
          <StepDots total={3} active={1} />
        </View>
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
                  {`${i + 1} · ${s.title}`}
                </Text>
                <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                  {s.body}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* SYC-35: keep-your-distance guidance Syros Cats asked for (PRODUCT-SPEC
            §2.2). Copy is `onboarding.healthy`, word for word. It sits inside
            the scroll area so it can never push the location card or the
            Continue button off a small screen. */}
        <View
          role="region"
          aria-label={t('howSafetyTitle')}
          style={[styles.safety, { backgroundColor: palette.terra100 }]}
        >
          <View style={styles.safetyHeader}>
            <Text style={styles.safetyEmoji} allowFontScaling={false}>
              🐾
            </Text>
            <Text role="heading" style={[styles.safetyTitle, { color: palette.terra700 }]}>
              {t('howSafetyTitle')}
            </Text>
          </View>
          <Text style={[styles.safetyBody, { color: palette.stone900 }]}>
            {t('howSafetyLiveHere')}
          </Text>
          <Text style={[styles.safetyBody, { color: palette.stone900 }]}>
            {t('howSafetyDistance')}
          </Text>
          <Text style={[styles.safetyBody, { color: palette.stone900 }]}>
            {t('howSafetyLeaveBe')}
          </Text>
          <Text style={[styles.safetyBody, styles.safetyStrong, { color: palette.stone900 }]}>
            {t('howSafetyHurt')}
          </Text>
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
    paddingHorizontal: spacing[5],
    paddingBottom: 6,
    minHeight: 28,
  },
  skip: {
    fontFamily: fonts.displaySemiBold,
    fontSize: fontSizes.sm,
    zIndex: 1,
  },
  dots: {
    ...StyleSheet.absoluteFillObject,
    top: undefined,
    bottom: 6,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  scroll: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
  },
  heading: { gap: 6 },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    lineHeight: 28,
  },
  subtitle: { fontFamily: fonts.body, fontSize: fontSizes.sm },
  cards: { paddingTop: spacing[4], gap: 11 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: radii.lg,
    padding: 14,
  },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji: { fontSize: 26 },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 15.5 },
  cardBody: { fontFamily: fonts.body, fontSize: fontSizes.xs, lineHeight: 19 },
  safety: {
    marginTop: spacing[4],
    borderRadius: radii.lg,
    padding: spacing[4],
    gap: spacing[2],
  },
  safetyHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  safetyEmoji: { fontSize: 20 },
  safetyTitle: { flex: 1, fontFamily: fonts.displayBold, fontSize: 17 },
  safetyBody: { fontFamily: fonts.body, fontSize: fontSizes.xs, lineHeight: 19 },
  safetyStrong: { fontFamily: fonts.bodyBold },
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
