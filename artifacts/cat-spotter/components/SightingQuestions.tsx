import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  onChange: (answers: SightingAnswers) => void;
  t: (key: string) => string;
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
}: SightingQuestionsProps) {
  const colors = useColors();
  const [earTipSkipped, setEarTipSkipped] = React.useState(false);
  const toggle = <K extends keyof SightingAnswers>(key: K, value: SightingAnswers[K]) =>
    onChange({ ...answers, [key]: answers[key] === value ? null : value });

  const showEarTip = askEarTip && !earTipSkipped;

  return (
    <View style={styles.wrap}>
      {showEarTip ? (
        <View style={[styles.block, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.question, { color: colors.foreground }]}>
            {t('earTipQuestion').replace('{name}', catName)}
          </Text>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            {t('earTipUsuallyLeft')}
          </Text>

          <View testID="ear-tip-example" style={styles.example}>
            {EAR_TIP_EXAMPLE_PHOTO ? (
              <Image
                source={EAR_TIP_EXAMPLE_PHOTO}
                style={[styles.examplePhoto, { borderColor: colors.border }]}
                contentFit="cover"
                accessibilityLabel={t('earTipExampleCaption')}
              />
            ) : (
              // TODO(SYC-79): placeholder until Syros Cats' example photos
              // arrive. PR 7 must not merge while this is showing.
              <View
                style={[
                  styles.examplePhoto,
                  styles.placeholder,
                  { borderColor: colors.mutedForeground, backgroundColor: colors.muted },
                ]}
              >
                <Text style={[styles.placeholderText, { color: colors.mutedForeground }]}>
                  PLACEHOLDER{'\n'}Example photos still to come from Syros Cats (SYC-79):
                  a clipped tip beside a torn ear
                </Text>
              </View>
            )}
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
                  ...answers,
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
                  ...answers,
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
                  ...answers,
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
              onChange({ ...answers, earTip: null, earSide: null });
            }}
            style={styles.skip}
          >
            <Text style={[styles.skipText, { color: colors.mutedForeground }]}>{t('skip')}</Text>
          </Pressable>
        </View>
      ) : null}

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

      <View style={[styles.block, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Input
          testID="sighting-note"
          label={t('noteLabel')}
          placeholder={t('notePlaceholder')}
          helper={t('noteHint')}
          value={answers.note}
          onChangeText={(note) => onChange({ ...answers, note })}
          maxLength={NOTE_MAX_LENGTH}
          multiline
          style={styles.note}
        />
      </View>
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
  placeholder: {
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[3],
  },
  placeholderText: {
    fontSize: fontSizes['2xs'],
    fontFamily: fonts.bodyBold,
    textAlign: 'center',
  },
  caption: { fontSize: fontSizes.xs, fontFamily: fonts.body, lineHeight: fontSizes.xs * 1.45 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  subQuestion: { gap: spacing[1] },
  subLabel: { fontSize: fontSizes.xs, fontFamily: fonts.bodyBold },
  skip: { alignSelf: 'flex-start', paddingVertical: spacing[1] },
  skipText: { fontSize: fontSizes.xs, fontFamily: fonts.displayBold, textDecorationLine: 'underline' },
  note: { minHeight: 72, textAlignVertical: 'top' },
});
