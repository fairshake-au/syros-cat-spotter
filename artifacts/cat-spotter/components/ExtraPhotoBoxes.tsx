import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { BodyCartoon, FaceCartoon } from '@/components/photoTips/cartoons';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import type { ExtraRole } from '@/lib/extraPhotos';

interface ExtraPhotoBoxesProps {
  /** The extra photos added so far: the prepared copy's uri, for showing. */
  extras: Partial<Record<ExtraRole, { uri: string }>>;
  /** Open the camera or the photo library for a box, straight from the tap. */
  onAdd: (role: ExtraRole, from: 'camera' | 'library') => void;
  onRemove: (role: ExtraRole) => void;
  /** True while the spot is being sent or saved. */
  disabled?: boolean;
}

const COPY: Record<
  ExtraRole,
  { label: string; emptyA11y: string; addedA11y: string }
> = {
  face: { label: 'addFace', emptyA11y: 'addFaceA11y', addedA11y: 'faceAddedA11y' },
  body: { label: 'addBody', emptyA11y: 'addBodyA11y', addedA11y: 'bodyAddedA11y' },
};

/**
 * SYC-415 (spec §4.1): two optional boxes under the first photo, "Add the
 * face" and "Add the whole body", each with its cartoon.
 *
 * They look nothing like "Retake photo" (a dashed box, not a text button), so
 * nobody mistakes adding a photo for replacing one (SYC-118). Each empty box
 * shows two buttons, Camera and Photos, rather than a pop-up chooser: a
 * browser only opens the camera or the file chooser from a direct tap, and
 * the app has no three-way pop-up (plan, "One small change from the spec").
 */
export function ExtraPhotoBoxes({ extras, onAdd, onRemove, disabled = false }: ExtraPhotoBoxesProps) {
  const { t } = useLanguage();
  const colors = useColors();
  return (
    <View style={styles.wrap} testID="extra-photo-boxes">
      <Text style={[styles.line, { color: colors.mutedForeground }]}>{t('extraPhotosLine')}</Text>
      <View style={styles.row}>
        {(['face', 'body'] as const).map((role) => (
          <ExtraBox
            key={role}
            role={role}
            photoUri={extras[role]?.uri}
            onAdd={onAdd}
            onRemove={onRemove}
            disabled={disabled}
          />
        ))}
      </View>
    </View>
  );
}

function ExtraBox({
  role,
  photoUri,
  onAdd,
  onRemove,
  disabled,
}: {
  role: ExtraRole;
  photoUri: string | undefined;
  onAdd: ExtraPhotoBoxesProps['onAdd'];
  onRemove: ExtraPhotoBoxesProps['onRemove'];
  disabled: boolean;
}) {
  const { t } = useLanguage();
  const colors = useColors();
  const [replacing, setReplacing] = React.useState(false);
  const copy = COPY[role];
  const filled = !!photoUri;

  // A new photo arriving (or the old one going) closes the replace choice.
  React.useEffect(() => {
    setReplacing(false);
  }, [photoUri]);

  const choices = (
    <View style={styles.choices}>
      <ChoiceButton
        testID={`extra-${role}-camera`}
        icon="camera"
        label={t('extraCamera')}
        a11yLabel={`${t(copy.label)}: ${t('extraCamera')}`}
        onPress={() => onAdd(role, 'camera')}
        disabled={disabled}
      />
      <ChoiceButton
        testID={`extra-${role}-library`}
        icon="image"
        label={t('extraLibrary')}
        a11yLabel={`${t(copy.label)}: ${t('extraLibrary')}`}
        onPress={() => onAdd(role, 'library')}
        disabled={disabled}
      />
    </View>
  );

  return (
    <View
      testID={`extra-box-${role}`}
      accessibilityRole={'group' as never}
      accessibilityLabel={t(filled ? copy.addedA11y : copy.emptyA11y)}
      style={[styles.box, { borderColor: colors.primary, backgroundColor: colors.card }]}
    >
      {filled ? (
        <>
          <Pressable
            testID={`extra-${role}-photo`}
            onPress={disabled ? undefined : () => setReplacing((r) => !r)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={t(copy.addedA11y)}
            accessibilityHint={t('extraReplaceA11yHint')}
            style={styles.photoPress}
          >
            <Image source={{ uri: photoUri }} style={styles.photo} contentFit="cover" />
          </Pressable>
          <Pressable
            testID={`extra-${role}-remove`}
            onPress={disabled ? undefined : () => onRemove(role)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${t('removePhoto')}: ${t(copy.label)}`}
            accessibilityState={{ disabled }}
            style={[styles.remove, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="x" size={14} color={colors.foreground} />
            <Text style={[styles.removeLabel, { color: colors.foreground }]}>{t('removePhoto')}</Text>
          </Pressable>
          {replacing && choices}
        </>
      ) : (
        <>
          <View
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={styles.cartoon}
          >
            {role === 'face' ? (
              <FaceCartoon size={56} label={t('cartoonFaceLabel')} />
            ) : (
              <BodyCartoon size={56} label={t('cartoonBodyLabel')} />
            )}
          </View>
          <View style={styles.labelRow}>
            <Feather name="plus" size={14} color={colors.primary} />
            <Text style={[styles.label, { color: colors.primary }]}>{t(copy.label)}</Text>
          </View>
          {choices}
        </>
      )}
    </View>
  );
}

function ChoiceButton({
  testID,
  icon,
  label,
  a11yLabel,
  onPress,
  disabled,
}: {
  testID: string;
  icon: 'camera' | 'image';
  label: string;
  a11yLabel: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.choice,
        { backgroundColor: colors.secondary, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      <Feather name={icon} size={14} color={colors.secondaryForeground} />
      <Text style={[styles.choiceLabel, { color: colors.secondaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing[2] },
  line: { fontSize: fontSizes.xs, fontFamily: fonts.body, lineHeight: fontSizes.xs * 1.45 },
  row: { flexDirection: 'row', gap: spacing[2] },
  box: {
    flex: 1,
    minHeight: 132,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: radii.md,
    padding: spacing[2],
    gap: spacing[2],
    alignItems: 'center',
    overflow: 'hidden',
  },
  cartoon: { alignItems: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  label: { fontSize: fontSizes.xs, fontFamily: fonts.displayBold, textAlign: 'center', flexShrink: 1 },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1],
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  choice: {
    flexGrow: 1,
    minWidth: 44,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    borderRadius: radii.sm,
  },
  choiceLabel: { fontSize: fontSizes['2xs'], fontFamily: fonts.bodySemiBold },
  photoPress: { alignSelf: 'stretch', flex: 1, minHeight: 112, borderRadius: radii.sm, overflow: 'hidden' },
  photo: { width: '100%', height: '100%', minHeight: 112 },
  remove: {
    position: 'absolute',
    top: spacing[1],
    right: spacing[1],
    minWidth: 44,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing[2],
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  removeLabel: { fontSize: fontSizes['2xs'], fontFamily: fonts.bodySemiBold },
});
