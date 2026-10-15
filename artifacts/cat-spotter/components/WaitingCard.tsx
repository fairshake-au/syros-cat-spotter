import React, { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/purropolis/Card';
import { displayUpperCase } from '@/lib/displayUpperCase';
import { EAR_TIP_EXAMPLE_PHOTO } from '@/lib/earTipExample';
import { factById } from '@/lib/starterFacts';
import type { WaitChoice } from '@/lib/waitingCard';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';

/**
 * The waiting card (SYC-48 / SYC-36; starter-facts.md §3.5, feeding-nudge.md
 * §4): one short thing to read in the map's place while a sighting is being
 * sent. No buttons, nothing to tap. On appearing it announces one short line
 * to a screen reader and leaves focus where it was; it appears without any
 * transition, so "reduce motion" needs nothing extra.
 *
 * A fact: "While we look…", then the fact; the ear-tip fact shows Syros
 * Cats' example photo above its words. The feeding nudge (from PR 2): its own
 * heading and its words, no buttons during the wait.
 */
export interface WaitingCardProps {
  choice: WaitChoice;
  t: (key: string) => string;
  examplePhoto?: ImageSourcePropType | null;
}

export function WaitingCard({ choice, t, examplePhoto = EAR_TIP_EXAMPLE_PHOTO }: WaitingCardProps) {
  const colors = useColors();
  const announce = choice.kind === 'nudge' ? t('feedNudgeA11yLabel') : t('waitingFactA11yLabel');

  useEffect(() => {
    void AccessibilityInfo.announceForAccessibility?.(announce);
    // Once per card: a new wait mounts a new card.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (choice.kind === 'nudge') {
    return (
      <View testID="waiting-card">
        <Card flat style={styles.card}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            {t('feedNudgeTitle')}
          </Text>
          <Text style={[styles.body, { color: colors.foreground }]}>{t('feedNudgeWhy')}</Text>
          <Text style={[styles.body, { color: colors.foreground }]}>
            {t(choice.form === 'link' ? 'feedNudgeInstead' : 'feedNudgeInsteadNoLink')}
          </Text>
          {choice.form === 'link' ? (
            <Text style={[styles.euro, { color: colors.foreground }]}>{t('feedNudgeEuro')}</Text>
          ) : null}
        </Card>
      </View>
    );
  }

  const fact = choice.kind === 'fact' ? factById(choice.id) : undefined;
  return (
    <View testID="waiting-card">
      <Card flat style={styles.card}>
        <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
          {displayUpperCase(t('waitingEyebrow'))}
        </Text>
        {fact?.photo && examplePhoto ? (
          <Image
            testID="waiting-card-photo"
            source={examplePhoto}
            style={[styles.photo, { borderColor: colors.border }]}
            contentFit="cover"
            accessibilityLabel={t('earTipExampleAlt')}
          />
        ) : null}
        {fact ? (
          <Text testID="waiting-card-fact" style={[styles.body, { color: colors.foreground }]}>
            {t(fact.id)}
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing[2] },
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: fontSizes['2xs'],
    letterSpacing: 0.6,
  },
  title: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.lg, lineHeight: fontSizes.lg * 1.3 },
  body: { fontFamily: fonts.body, fontSize: fontSizes.md, lineHeight: fontSizes.md * 1.45 },
  euro: { fontFamily: fonts.bodyBold, fontSize: fontSizes.md, lineHeight: fontSizes.md * 1.45 },
  photo: { width: '100%', aspectRatio: 2, borderRadius: radii.md, borderWidth: 1 },
});
