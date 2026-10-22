import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '@/context/LanguageContext';
import { registerModalOpen } from '@/lib/modalVisibility';
import { photoSource } from '@/lib/urls';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';

/**
 * One photo full screen (SYC-44 PR 6.1; report-an-issue.md §3.2, D8): the
 * photo, the date, who spotted it, **Close**, and beneath them **Report an
 * issue with this photo**. The link is quiet, never bigger than Close, and
 * appears only when `onReport` is given (PR 6.2's reason sheet). It is only
 * ever opened for a photo the phone has already loaded, so nothing here
 * changes what works offline (spec §4.2).
 */
export function PhotoViewer({
  url,
  label,
  date,
  byline,
  onClose,
  onReport,
}: {
  url: string;
  /** What a screen reader says for the photo. */
  label: string;
  /** Already formatted for the reader's language. */
  date: string;
  /** Who spotted it, ready to show (`bylineFor`). */
  byline: string;
  onClose: () => void;
  onReport?: () => void;
}) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  // Keep the Home Screen nudge from floating over this (SYC-134).
  useEffect(() => registerModalOpen(), []);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={[
          styles.backdrop,
          { paddingTop: insets.top + spacing[4], paddingBottom: insets.bottom + spacing[4] },
        ]}
        testID="sighting-photo-viewer"
      >
        <Pressable
          testID="photo-viewer-backdrop"
          accessible={false}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View style={styles.photoWrap} pointerEvents="none">
          <Image source={photoSource(url)} accessibilityLabel={label} style={styles.photo} contentFit="contain" />
        </View>
        <View style={styles.footer}>
          <View style={styles.footerRow}>
            <View style={styles.caption}>
              <Text testID="photo-viewer-date" style={styles.date}>
                {date}
              </Text>
              <Text testID="photo-viewer-spotter" style={styles.spotter} numberOfLines={1}>
                {byline}
              </Text>
            </View>
            <Pressable
              testID="sighting-photo-viewer-close"
              accessibilityRole="button"
              onPress={onClose}
              hitSlop={8}
              style={styles.close}
            >
              <Text style={styles.closeText}>{t('extraPhotoClose')}</Text>
            </Pressable>
          </View>
          {onReport ? (
            <Pressable
              testID="photo-viewer-report"
              accessibilityRole="link"
              onPress={onReport}
              hitSlop={8}
              style={styles.report}
            >
              <Text style={styles.reportText}>{t('reportIssuePhoto')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
    paddingHorizontal: spacing[4],
  },
  photoWrap: { flex: 1 },
  photo: { width: '100%', height: '100%' },
  footer: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingTop: spacing[3],
    gap: spacing[2],
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  caption: { flex: 1, gap: 2 },
  date: { color: '#fff', fontFamily: fonts.bodySemiBold, fontSize: fontSizes.sm },
  spotter: { color: 'rgba(255,255,255,0.75)', fontFamily: fonts.body, fontSize: fontSizes.xs },
  close: {
    minHeight: 44,
    paddingHorizontal: spacing[4],
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: fontSizes.sm },
  report: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  // The same quiet weight as "This cat needs help" (spec §3).
  reportText: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
