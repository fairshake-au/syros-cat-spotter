import React from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/purropolis/Button';
import { fonts, fontSizes, spacing } from '@/constants/theme';
import { PhotoTips } from './PhotoTips';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The tips card (SYC-415 spec §3.1): a card over the camera screen with the
 * title, the cartoons and tips, and one "Got it" button. Drawn as an overlay
 * rather than a native Modal, so it behaves the same on phones and the web and
 * never takes the screen's place in the page. It does not open the camera or
 * picker: browsers only allow that from a direct tap on the shutter.
 */
export function PhotoTipsCard({ visible, onClose }: Props) {
  const colors = useColors();
  const { t } = useLanguage();

  // Behaves like a modal while open: Android hardware back and Escape on the
  // web both close it, the same as "Got it".
  React.useEffect(() => {
    if (!visible) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (typeof document !== 'undefined') document.addEventListener('keydown', onKey);
    return () => {
      back?.remove?.();
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKey);
    };
  }, [visible, onClose]);

  if (!visible) return null;
  return (
    <View
      style={styles.overlay}
      // iOS keeps the screen behind it out of VoiceOver; on the web, role +
      // aria-modal do the same so a screen reader can't wander to the shutter.
      accessibilityViewIsModal
      role="dialog"
      aria-modal
      testID="photo-tips-card"
    >
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.foreground }]}
          >
            {t('photoTipsTitle')}
          </Text>
          <PhotoTips />
          <Button
            variant="primary"
            size="lg"
            block
            onPress={onClose}
            testID="photo-tips-got-it"
          >
            {t('photoTipsGotIt')}
          </Button>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
    zIndex: 50,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '100%',
    borderRadius: 20,
    overflow: 'hidden',
  },
  content: { padding: spacing[5], gap: spacing[4] },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.xl,
  },
});
