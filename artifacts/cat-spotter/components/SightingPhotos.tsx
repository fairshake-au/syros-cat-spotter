import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { Sighting } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { parsePublicDate } from '@/lib/catStatusLines';
import { photoSource } from '@/lib/urls';
import { PhotoViewer } from '@/components/PhotoViewer';
import { fonts, radii } from '@/constants/theme';

type ExtraPhoto = NonNullable<Sighting['extraPhotos']>[number];

const LABEL_KEY = {
  first: 'extraPhotoFirstLabel',
  face: 'extraPhotoFaceLabel',
  body: 'extraPhotoBodyLabel',
} as const;

/**
 * One sighting's photos on a cat's page (SYC-415, spec §5.5): the cover, and
 * under it up to two small thumbnails for the spot's other photos (the first,
 * face or body photo). A tap on any of them opens it full screen with the
 * date and who spotted it (SYC-44 PR 6.1; the cover only once it has loaded,
 * so nothing changes offline). A cover the team or a report has hidden shows
 * a calm tile in its place (D4); a hidden extra photo shows nothing. A
 * sighting with no `extraPhotos` looks exactly as it did before extra photos
 * existed.
 */
export function SightingPhotos({
  photoUrl,
  photoHidden,
  extraPhotos,
  createdAt,
  spotter,
  onReportPhoto,
}: {
  photoUrl: string | null;
  /** SYC-44 PR 6.1: the server's flag. Undefined from an older server. */
  photoHidden?: boolean;
  /** The sighting's public day, as the tile shows it: part of each photo's spoken label. */
  createdAt: string;
  /** Who spotted it, as the tile names them. */
  spotter: string;
  extraPhotos?: ExtraPhoto[];
  /** PR 6.2: opens the reason sheet for this photo. Without it there is no report link. */
  onReportPhoto?: (photoUrl: string) => void;
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const [open, setOpen] = useState<{ url: string; label: string } | null>(null);
  const [coverLoaded, setCoverLoaded] = useState<string | null>(null);
  const when = parsePublicDate(createdAt).toLocaleDateString();
  const visible = (extraPhotos ?? []).filter(
    (e): e is ExtraPhoto & { photoUrl: string } => !!e.photoUrl,
  );

  return (
    <View style={styles.wrap}>
      {photoHidden === true ? (
        <View
          testID="photo-hidden-tile"
          style={[styles.cover, styles.tile, { borderColor: colors.border, backgroundColor: colors.muted }]}
        >
          <Text style={[styles.tileText, { color: colors.mutedForeground }]}>{t('photoHiddenTile')}</Text>
        </View>
      ) : (
        <Pressable
          testID="sighting-cover-open"
          accessibilityRole={photoUrl ? 'imagebutton' : undefined}
          accessibilityLabel={photoUrl ? when : undefined}
          disabled={!photoUrl}
          onPress={() => {
            if (photoUrl && coverLoaded === photoUrl) setOpen({ url: photoUrl, label: when });
          }}
        >
          <Image
            testID="sighting-cover"
            source={photoSource(photoUrl)}
            style={[styles.cover, { borderColor: colors.border }]}
            contentFit="cover"
            onLoad={() => setCoverLoaded(photoUrl)}
          />
        </Pressable>
      )}
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
      {open !== null ? (
        <PhotoViewer
          url={open.url}
          label={open.label}
          date={when}
          spotter={spotter}
          onClose={() => setOpen(null)}
          onReport={onReportPhoto ? () => onReportPhoto(open.url) : undefined}
        />
      ) : null}
    </View>
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
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  tileText: { fontFamily: fonts.body, fontSize: 11, lineHeight: 15, textAlign: 'center' },
  thumbs: { flexDirection: 'row', gap: 6 },
  thumb: {
    flex: 1,
    maxWidth: 48,
    aspectRatio: 1,
    borderRadius: radii.sm,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
