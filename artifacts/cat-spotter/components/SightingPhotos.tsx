import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import type { Sighting } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { registerModalOpen } from '@/lib/modalVisibility';
import { parsePublicDate } from '@/lib/catStatusLines';
import { photoSource } from '@/lib/urls';
import { radii, spacing } from '@/constants/theme';

type ExtraPhoto = NonNullable<Sighting['extraPhotos']>[number];

const LABEL_KEY = {
  first: 'extraPhotoFirstLabel',
  face: 'extraPhotoFaceLabel',
  body: 'extraPhotoBodyLabel',
} as const;

/**
 * One sighting's photos on a cat's page (SYC-415, spec §5.5): the cover, as
 * before, and under it up to two small thumbnails for the spot's other photos
 * (the first, face or body photo). A tap opens one full size. A photo the team
 * hid arrives with a null address and shows nothing, and a sighting with no
 * `extraPhotos` looks exactly as it did before extra photos existed.
 */
export function SightingPhotos({
  photoUrl,
  extraPhotos,
  createdAt,
}: {
  photoUrl: string | null;
  /** The sighting's public day, as the tile shows it: part of each photo's spoken label. */
  createdAt: string;
  extraPhotos?: ExtraPhoto[];
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const [open, setOpen] = useState<{ url: string; label: string } | null>(null);
  const when = parsePublicDate(createdAt).toLocaleDateString();
  const visible = (extraPhotos ?? []).filter(
    (e): e is ExtraPhoto & { photoUrl: string } => !!e.photoUrl,
  );

  return (
    <View style={styles.wrap}>
      <Image
        testID="sighting-cover"
        source={photoSource(photoUrl)}
        style={[styles.cover, { borderColor: colors.border }]}
        contentFit="cover"
      />
      {visible.length > 0 ? (
        <View style={styles.thumbs}>
          {visible.slice(0, 2).map((e) => {
            const label = `${t(LABEL_KEY[e.role])}, ${when}`;
            return (
            // Up to 48pt, shrinking to fit a narrow tile; hitSlop keeps the tap target at 44pt.
            <Pressable
              key={e.role}
              testID={`extra-photo-${e.role}`}
              accessibilityRole="button"
              accessibilityLabel={label}
              hitSlop={8}
              onPress={() => setOpen({ url: e.photoUrl, label })}
              style={[styles.thumb, { borderColor: colors.border }]}
            >
              <Image
                source={photoSource(e.photoUrl)}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
            </Pressable>
            );
          })}
        </View>
      ) : null}
      {open !== null ? <FullSize url={open.url} label={open.label} onClose={() => setOpen(null)} /> : null}
    </View>
  );
}

/** One photo full size. A tap anywhere closes it. */
function FullSize({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const { t } = useLanguage();
  // Keep the Home Screen nudge from floating over this (SYC-134).
  useEffect(() => registerModalOpen(), []);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop} testID="sighting-photo-viewer">
        <Pressable
          testID="sighting-photo-viewer-close"
          accessibilityRole="button"
          accessibilityLabel={t('extraPhotoClose')}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <Image source={photoSource(url)} accessibilityLabel={label} style={styles.full} contentFit="contain" pointerEvents="none" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 6 },
  cover: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 1,
  },
  thumbs: { flexDirection: 'row', gap: 6 },
  thumb: {
    flex: 1,
    maxWidth: 48,
    aspectRatio: 1,
    borderRadius: radii.sm,
    borderWidth: 1,
    overflow: 'hidden',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  full: { width: '100%', height: '100%' },
});
