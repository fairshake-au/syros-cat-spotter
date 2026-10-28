import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { getGetCatQueryKey, useGetCat, type Cat } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { Chip } from '@/components/purropolis';
import { CHIP_TAP_PAD } from '@/components/purropolis/Chip';
import { photoSource } from '@/lib/urls';
import { catDisplayName } from '@/lib/catDisplayName';
import type { DuplicateChoice } from '@/lib/sightingAnswers';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';

type CatCard = Pick<Cat, 'id' | 'name' | 'photoUrl'> & { namePending?: boolean };

interface DuplicateQuestionProps {
  /** resolve's `duplicateQuestion`: the cat the spotter confirmed and the look-alike. */
  question: { catId: number; otherCatId: number };
  /** The cat the spotter confirmed (resolve's own `cat`). */
  chosen: CatCard;
  /** The phone's copy of the cat-alogue, where the look-alike is usually found. */
  cats: readonly CatCard[];
  /** The spotter's own photo of this spot, shown above the two. */
  yourPhoto: React.ReactNode;
  value: DuplicateChoice | null;
  onChange: (value: DuplicateChoice | null) => void;
  t: (key: string) => string;
}

/**
 * "Are these the same cat?" (which-cat-is-which.md §3.1 item 1, D8; SYC-59
 * PR 5.2). The last of the reward screen's optional questions. The spotter
 * has just seen the cat, so their own photo sits above the two cats' main
 * photos. Skipping sends nothing. Nothing about either cat changes: the
 * answer is a report the team weighs.
 *
 * The look-alike is read from the phone's cat-alogue, else fetched. If it
 * can't be shown the question is simply not asked.
 */
export function DuplicateQuestion({ question, chosen, cats, yourPhoto, value, onChange, t }: DuplicateQuestionProps) {
  const colors = useColors();
  const cached = cats.find((c) => c.id === question.otherCatId);
  const fetched = useGetCat(question.otherCatId, { query: { enabled: !cached, retry: 1, queryKey: getGetCatQueryKey(question.otherCatId) } });
  const other: CatCard | null = cached ?? (fetched.data?.cat?.id === question.otherCatId ? fetched.data.cat : null);
  if (!other) return null;

  const toggle = (choice: DuplicateChoice) => onChange(value === choice ? null : choice);
  const card = (cat: CatCard, testID: string) => (
    <View style={styles.cat} testID={testID}>
      <Image
        source={photoSource(cat.photoUrl)}
        style={[styles.catPhoto, { borderColor: colors.border, backgroundColor: colors.muted }]}
        contentFit="cover"
        accessibilityLabel={t('dupCatPhotoAlt').replace('{name}', cat.name)}
      />
      <Text style={[styles.catName, { color: colors.foreground }]} numberOfLines={1}>
        {catDisplayName(cat, t)}
      </Text>
    </View>
  );

  return (
    <View testID="duplicate-question" style={[styles.block, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View testID="duplicate-your-photo" style={styles.yours} accessibilityLabel={t('dupYourPhotoAlt')}>
        {yourPhoto}
      </View>
      <View style={styles.pair}>
        {card(chosen, 'duplicate-cat-chosen')}
        {card(other, 'duplicate-cat-other')}
      </View>
      <Text style={[styles.question, { color: colors.foreground }]}>{t('dupQuestion')}</Text>
      <View style={styles.choices}>
        <Chip label={t('dupSame')} active={value === 'same'} onPress={() => toggle('same')} />
        <Chip label={t('dupDifferent')} active={value === 'different'} onPress={() => toggle('different')} />
        <Chip label={t('dupNotSure')} active={value === 'not_sure'} onPress={() => toggle('not_sure')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing[2], padding: spacing[4], borderWidth: 1, borderRadius: radii.lg, width: '100%' },
  yours: { width: '100%', aspectRatio: 2, borderRadius: radii.md, overflow: 'hidden' },
  pair: { flexDirection: 'row', gap: spacing[2] },
  cat: { flex: 1, gap: spacing[1] },
  catPhoto: { width: '100%', aspectRatio: 1, borderRadius: radii.md, borderWidth: 1 },
  catName: { fontSize: fontSizes.xs, fontFamily: fonts.bodyBold, textAlign: 'center' },
  question: { fontSize: fontSizes.sm, fontFamily: fonts.displayBold },
  // Room for each chip's 5px tap area, given back by the negative margin (SYC-644).
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    paddingVertical: CHIP_TAP_PAD,
    marginVertical: -CHIP_TAP_PAD,
  },
});
