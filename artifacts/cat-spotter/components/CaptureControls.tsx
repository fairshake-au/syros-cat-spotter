import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/purropolis/Button';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, spacing } from '@/constants/theme';

interface CaptureControlsProps {
  /** Opens the phone's own camera. The one way to take a photo (SYC-575). */
  onTakePhoto: () => void;
  onChooseFromLibrary: () => void;
  takePhotoLabel: string;
  libraryLabel: string;
}

/**
 * The capture controls over the viewfinder: one labelled "Take a photo" button
 * and a "Choose from your photos" link under it.
 *
 * Its own component so a test can render it and see that the button is there.
 * The first tester's bug was a viewfinder with no camera button at all, and a
 * test over a pure state function cannot see a deleted JSX branch (SYC-72).
 *
 * Invariant: both controls always render. There is no live-view shutter any
 * more (SYC-575): the button hands off to the phone's camera on every phone.
 */
export function CaptureControls({
  onTakePhoto,
  onChooseFromLibrary,
  takePhotoLabel,
  libraryLabel,
}: CaptureControlsProps) {
  return (
    <View style={styles.controls}>
      <Button
        variant="primary"
        size="lg"
        block
        wrapLabel
        onPress={onTakePhoto}
        // The viewfinder card is dark in light and dark mode alike, so the
        // button keeps the light-mode blue: its white label is 4.7:1 on it,
        // against 3.3:1 on the lighter dark-mode primary (SYC-509 rule).
        style={styles.takePhotoButton}
        testID="picker-camera-shutter"
        accessibilityLabel={takePhotoLabel}
        iconLeft={<Feather name="camera" size={20} color="#fff" />}
      >
        {takePhotoLabel}
      </Button>
      <Pressable
        onPress={onChooseFromLibrary}
        accessibilityRole="link"
        accessibilityLabel={libraryLabel}
        testID="choose-from-library"
        style={({ pressed }) => [styles.libraryLink, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={styles.libraryLinkText}>{libraryLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
  takePhotoButton: { backgroundColor: palette.aegean600 },
  // 44pt tall tap area, the SYC-509 minimum, around one line of text.
  libraryLink: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
  },
  libraryLinkText: {
    color: '#fff',
    fontFamily: fonts.displaySemiBold,
    fontSize: fontSizes.sm,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
});
