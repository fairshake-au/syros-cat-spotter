import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { IconButton } from '@/components/purropolis/IconButton';
import { spacing } from '@/constants/theme';
import type { ShutterKind } from '@/lib/cameraMode';

interface CaptureControlsProps {
  /** Which shutter to show. See `shutterKindFor` — it is total on purpose. */
  shutterKind: ShutterKind;
  /** True while a live capture is in flight, to disable the shutter. */
  capturing?: boolean;
  onChooseFromLibrary: () => void;
  /** Capture from the live preview. Only reachable when shutterKind is 'live'. */
  onCaptureLive: () => void;
  /** Hand off to the system camera app. Reachable in every other state. */
  onCaptureWithPicker: () => void;
  libraryLabel: string;
  shutterLabel: string;
}

/**
 * The row of capture controls over the viewfinder.
 *
 * Extracted from the Spot screen so the branch that decides WHICH shutter
 * renders is testable. It is the branch that matters: the first tester's bug
 * was a viewfinder with no camera button at all, and a test over the pure
 * state function cannot see a deleted JSX branch (SYC-72).
 *
 * Invariant: exactly one shutter always renders, alongside the library button.
 */
export function CaptureControls({
  shutterKind,
  capturing = false,
  onChooseFromLibrary,
  onCaptureLive,
  onCaptureWithPicker,
  libraryLabel,
  shutterLabel,
}: CaptureControlsProps) {
  return (
    <View style={styles.controlRow}>
      <IconButton
        label={libraryLabel}
        onPress={onChooseFromLibrary}
        style={styles.translucentIconBtn}
      >
        <Feather name="image" size={20} color="#fff" />
      </IconButton>
      {shutterKind === 'live' ? (
        <Pressable
          onPress={onCaptureLive}
          disabled={capturing}
          accessibilityRole="button"
          accessibilityLabel={shutterLabel}
          testID="live-camera-shutter"
          style={({ pressed }) => [
            styles.shutter,
            { opacity: pressed || capturing ? 0.65 : 1 },
          ]}
        />
      ) : (
        <Pressable
          onPress={onCaptureWithPicker}
          accessibilityRole="button"
          accessibilityLabel={shutterLabel}
          testID="picker-camera-shutter"
          style={({ pressed }) => [
            styles.shutter,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[7],
    paddingBottom: spacing[6],
  },
  translucentIconBtn: { backgroundColor: 'rgba(255,255,255,0.2)' },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#fff',
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
});
