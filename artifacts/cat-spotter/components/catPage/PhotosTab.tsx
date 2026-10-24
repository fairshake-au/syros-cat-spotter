import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Sighting } from '@workspace/api-client-react';
import { useLanguage } from '@/context/LanguageContext';
import { SightingPhotos } from '@/components/SightingPhotos';
import { ReportIssueLink } from '@/components/report/ReportIssueLink';
import { useQuietColor } from '@/hooks/useQuietColor';
import { bylineFor, spotterName } from '@/lib/photoCaption';
import { formatPublicDate } from '@/lib/catPageDates';

/** 📷 Photos (spec §4): the sighting grid exactly as it was, without its heading. */
export function PhotosTab({
  sightings,
  onReportPhoto,
  onReport,
}: {
  sightings: Sighting[];
  onReportPhoto: (photoUrl: string) => void;
  onReport: () => void;
}) {
  const quiet = useQuietColor();
  const { t, language } = useLanguage();
  return (
    <View style={styles.stack}>
      <View style={styles.grid}>
        {sightings.map((s, i) => (
          // Keyed by the photo's address: when a refetch hides a photo its
          // key changes, so an open full-screen view of it closes rather
          // than go on showing a hidden photo (review finding 7).
          <View key={s.photoUrl ?? `sighting-${i}`} style={styles.item}>
            <SightingPhotos
              photoUrl={s.photoUrl}
              photoHidden={s.photoHidden}
              photoRemoved={s.photoRemoved}
              extraPhotos={s.extraPhotos}
              createdAt={s.createdAt}
              byline={bylineFor(s, t)}
              onReportPhoto={onReportPhoto}
            />
            <Text style={[styles.date, { color: quiet }]}>{formatPublicDate(s.createdAt, language)}</Text>
            <Text style={[styles.spotter, { color: quiet }]} numberOfLines={1}>
              {spotterName(s, t)}
            </Text>
          </View>
        ))}
      </View>
      <ReportIssueLink onPress={onReport} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  item: { width: '30.5%', gap: 4 },
  date: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  spotter: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
});
