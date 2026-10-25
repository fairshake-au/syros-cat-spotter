import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppMap } from '@/components/AppMap';
import { ReportIssueLink } from '@/components/report/ReportIssueLink';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useQuietColor } from '@/hooks/useQuietColor';
import { DEFAULT_CELL_M } from '@/lib/cellShape';

/**
 * 🗺️ Map (spec §6): the cell drawn as an area, never a pin except to the
 * owner. Only mounted while this tab is showing, so the map never starts at
 * zero size and costs nothing for visits that never open it.
 */
export function MapTab({
  cat,
  onReport,
}: {
  cat: {
    lat: number;
    lng: number;
    locationPrecision: string;
    locationCellM?: number | null;
  };
  onReport: () => void;
}) {
  const colors = useColors();
  const quiet = useQuietColor();
  const { t } = useLanguage();
  const exact = cat.locationPrecision === 'exact';
  return (
    <View style={styles.stack}>
      <View style={[styles.mapWrap, { borderColor: colors.border }]}>
        <AppMap
          latitude={cat.lat}
          longitude={cat.lng}
          // Close enough that the 250 m cell fills most of the map, so
          // "Somewhere in here" reads as an area, not a dot.
          latitudeDelta={0.0035}
          longitudeDelta={0.0035}
          // Pan and zoom stay on so people can zoom out to see where on the
          // island this is. Safe for privacy: non-owners only ever get the cell
          // centre from the server, so zooming in can't reveal a finer spot.
          markerBorderColor={colors.primary}
          // Data spine PR 6 (spec §6.2, §6.6): the cat is somewhere in its
          // published cell, drawn as that cell, never a pin. Only its owner
          // gets the exact spot. Sightings carry no position.
          markers={exact ? [{ id: 'cat', latitude: cat.lat, longitude: cat.lng }] : []}
          areas={
            exact
              ? []
              : [
                  {
                    id: 'cat',
                    latitude: cat.lat,
                    longitude: cat.lng,
                    sizeMetres: cat.locationCellM ?? DEFAULT_CELL_M,
                    label: t('somewhereInHere'),
                  },
                ]
          }
        />
      </View>
      <Text style={[styles.caption, { color: quiet }]}>
        {t(exact ? 'firstSpottedHereOwner' : 'firstSpottedAroundHere')}
      </Text>
      <ReportIssueLink onPress={onReport} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  mapWrap: { borderRadius: 14, borderWidth: 1, overflow: 'hidden', height: 180 },
  caption: { fontSize: 12, fontFamily: 'Inter_500Medium' },
});
