import React from 'react';
import { Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import { Chip, Input } from '@/components/purropolis';
import { EAR_TIP_EXAMPLE_PHOTO } from '@/lib/earTipExample';
import { NOTE_MAX_LENGTH, type SightingAnswers } from '@/lib/sightingAnswers';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';

interface SightingQuestionsProps {
  catName: string;
  /** False once this spotter has answered the ear-tip question for this cat
   * (resolve's askEarTip; Q3 → B, asked once per cat). */
  askEarTip: boolean;
  answers: SightingAnswers;
  /** Only what changed. The screen merges it into its latest answers, so
   * two quick taps can never overwrite each other with a stale copy. */
  onChange: (patch: Partial<SightingAnswers>) => void;
  t: (key: string) => string;
  /** Defaults to Syros Cats' example photo, once it exists (SYC-79). */
  examplePhoto?: ImageSourcePropType | null;
  /** SYC-117 part 2, on the cat's page: which of the other two to ask. */
  show?: { foodAndWater: boolean; note: boolean };
  /** SYC-117 part 2: "answered" shows the spotter's earlier answer with a
   * way to change it; "checked" means Syros Cats have checked it, so it
   * can't be changed. The reward screen leaves this "open". */
  earTipState?: 'open' | 'answered' | 'checked';
  /** With "answered": the earlier answer, as words. */
  currentEarTipLabel?: string;
}

/**
 * The optional questions on the reward screen, after the points (data
 * spine PR 7; cat-record-data-spine.md §4.4, §7). Every one can be skipped,
 * and nothing here stands between a spotter and their points: those are
 * already on screen above this.
 */
export function SightingQuestions({
  catName,
  askEarTip,
  answers,
  onChange,
  t,
  examplePhoto = EAR_TIP_EXAMPLE_PHOTO,
  show = { foodAndWater: true, note: true },
  earTipState = 'open',
  currentEarTipLabel,
}: SightingQuestionsProps) {
  const colors = useColors();
  const [earTipSkipped, setEarTipSkipped] = React.useState(false);
  const [changing, setChanging] = React.useState(false);
  const toggle = <K extends keyof SightingAnswers>(key: K, value: SightingAnswers[K]) =>
    onChange({
      [key]: answers[key] === value ? null : value,
    } as Partial<SightingAnswers>);

  const showEarTip = askEarTip && !earTipSkipped && (earTipState === 'open' || changing);

  return (
    <View style={styles.wrap}>
      {askEarTip && earTipState === 'checked' ? (
        <View style={[styles.block, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>{t('earTipChecked')}</Text>
        </View>
      ) : null}
      {askEarTip && earTipState === 'answered' && !changing && !earTipSkipped ? (
        <View style={[styles.block, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.question, { color: colors.foreground }]}>
            {t('earTipYouSaid').replace('{answer}', currentEarTipLabel ?? '')}
          </Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setChanging(true)}
            style={styles.skip}
          >
            <Text style={[styles.skipText, { color: colors.primary }]}>{t('earTipChange')}</Text>
          </Pressable>
        </View>
      ) : null}
      {showEarTip ? (
        <View style={[styles.block, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.question, { color: colors.foreground }]}>
            {t('earTipQuestion').replace('{name}', catName)}
          </Text>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            {t('earTipUsuallyLeft')}
          </Text>

          <View testID="ear-tip-example" style={styles.example}>
            {/* Samuel, 5 Oct 2026: ship without waiting for Syros Cats'
                photo (SYC-79). Until it arrives, the written line below is the
                whole explanation; the photo appears here once
                EAR_TIP_EXAMPLE_PHOTO is set. Never a stand-in photo. */}
            {examplePhoto ? (
              <Image
                source={examplePhoto}
                style={[styles.examplePhoto, { borderColor: colors.border }]}
                contentFit="cover"
                accessibilityLabel={t('earTipExampleCaption')}
              />
            ) : null}
            <Text style={[styles.caption, { color: colors.mutedForeground }]}>
              {t('earTipExampleCaption')}
            </Text>
          </View>

          <View style={styles.choices}>
            <Chip
              label={t('earTipYes')}
              active={answers.earTip === 'clipped'}
              onPress={() =>
                onChange({
                  earTip: answers.earTip === 'clipped' ? null : 'clipped',
                  earSide: null,
                })
              }
            />
            <Chip
              label={t('earTipNo')}
              active={answers.earTip === 'looks_whole'}
              onPress={() =>
                onChange({
                  earTip: answers.earTip === 'looks_whole' ? null : 'looks_whole',
                  earSide: null,
                })
              }
            />
            <Chip
              label={t('earTipCantTell')}
              active={answers.earTip === 'cant_tell'}
              onPress={() =>
                onChange({
                  earTip: answers.earTip === 'cant_tell' ? null : 'cant_tell',
                  earSide: null,
                })
              }
            />
          </View>

          {answers.earTip === 'clipped' ? (
            <View style={styles.subQuestion}>
              <Text style={[styles.subLabel, { color: colors.foreground }]}>
                {t('earTipWhichEar')}
              </Text>
              <View style={styles.choices}>
                <Chip
                  label={t('earLeft')}
                  active={answers.earSide === 'left'}
                  onPress={() => toggle('earSide', 'left')}
                />
                <Chip
                  label={t('earRight')}
                  active={answers.earSide === 'right'}
                  onPress={() => toggle('earSide', 'right')}
                />
                <Chip
                  label={t('earNotSure')}
                  active={answers.earSide === 'unsure'}
                  onPress={() => toggle('earSide', 'unsure')}
                />
              </View>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              setEarTipSkipped(true);
              onChange({ earTip: null, earSide: null });
            }}
            style={styles.skip}
          >
            <Text style={[styles.skipText, { color: colors.mutedForeground }]}>{t('skip')}</Text>
          </Pressable>
        </View>
      ) : null}

      {show.foodAndWater ? (
        <View style={[styles.block, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.question, { color: colors.foreground }]}>
            {t('foodWaterQuestion')}
          </Text>
          <View style={styles.choices}>
            <Chip
              label={t('foodWaterYes')}
              active={answers.foodAndWater === 'yes'}
              onPress={() => toggle('foodAndWater', 'yes')}
            />
            <Chip
              label={t('foodWaterNo')}
              active={answers.foodAndWater === 'no'}
              onPress={() => toggle('foodAndWater', 'no')}
            />
            <Chip
              label={t('foodWaterCantTell')}
              active={answers.foodAndWater === 'cant_tell'}
              onPress={() => toggle('foodAndWater', 'cant_tell')}
            />
          </View>
        </View>
      ) : null}

      {show.note ? (
        <View style={[styles.block, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Input
            testID="sighting-note"
            label={t('noteLabel')}
            placeholder={t('notePlaceholder')}
            helper={t('noteHint')}
            value={answers.note}
            onChangeText={(note) => onChange({ note })}
            maxLength={NOTE_MAX_LENGTH}
            multiline
            style={styles.note}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing[3], width: '100%' },
  block: {
    gap: spacing[2],
    padding: spacing[4],
    borderWidth: 1,
    borderRadius: radii.lg,
  },
  question: { fontSize: fontSizes.sm, fontFamily: fonts.displayBold },
  hint: { fontSize: fontSizes.xs, fontFamily: fonts.body },
  example: { gap: spacing[1] },
  examplePhoto: {
    width: '100%',
    aspectRatio: 2,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  caption: {
    fontSize: fontSizes.xs,
    fontFamily: fonts.body,
    lineHeight: fontSizes.xs * 1.45,
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  subQuestion: { gap: spacing[1] },
  subLabel: { fontSize: fontSizes.xs, fontFamily: fonts.bodyBold },
  skip: { alignSelf: 'flex-start', paddingVertical: spacing[1] },
  skipText: {
    fontSize: fontSizes.xs,
    fontFamily: fonts.displayBold,
    textDecorationLine: 'underline',
  },
  note: { minHeight: 72, textAlignVertical: 'top' },
});
