import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useOpenNeedsHelp } from '@/components/report/NeedsHelpLink';
import { fonts, fontSizes, radii } from '@/constants/theme';
import type { HomeAction } from '@/lib/catPageFacts';

function QuestionCard({
  emoji,
  label,
  onPress,
  disabled = false,
  testID,
  cardRef,
}: {
  emoji: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
  cardRef?: React.Ref<View>;
}) {
  const colors = useColors();
  return (
    <Pressable
      ref={cardRef}
      role="button"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <Text aria-hidden accessibilityElementsHidden importantForAccessibility="no" style={styles.emoji}>
        {emoji}
      </Text>
      <Text style={[styles.text, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The two soft cards under the cat page's main button (SYC-624): "🩹 {name}
 * needs help" and "🏠 {name} lives with me". Equal width side by side, or the
 * help card alone at full width when the home card doesn't apply. Both are
 * quieter and smaller than the main button, and the words may wrap.
 */
export function QuestionCards({
  cat,
  homeAction,
  claimDisabled,
  onHome,
  homeCardRef,
}: {
  cat: { id: number; name: string; photoUrl: string | null };
  homeAction: HomeAction;
  claimDisabled: boolean;
  onHome: () => void;
  homeCardRef: React.Ref<View>;
}) {
  const { t } = useLanguage();
  const openNeedsHelp = useOpenNeedsHelp({ cat });
  const named = (key: string) => t(key).split('{name}').join(cat.name);
  return (
    <View style={styles.row}>
      <QuestionCard
        emoji="🩹"
        label={named('reportNeedsHelpNamed')}
        onPress={() => void openNeedsHelp()}
        testID="needs-help-card"
      />
      {homeAction !== null ? (
        <QuestionCard
          emoji="🏠"
          label={named('claimCat')}
          onPress={onHome}
          disabled={claimDisabled}
          testID="lives-with-me-card"
          cardRef={homeCardRef}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  card: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  emoji: { fontSize: 20, lineHeight: 24 },
  text: { fontSize: fontSizes.xs, fontFamily: fonts.bodySemiBold, textAlign: 'center' },
});
