import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon } from 'react-native-maps';
import { Image, type ImageSource } from 'expo-image';
import { OsmTiles } from './OsmTiles';
import { useColors } from '@/hooks/useColors';
import { roundedCellPolygon } from '@/lib/cellShape';

export interface AppMapMarker {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  image?: ImageSource;
  pinColor?: string;
  onPress?: () => void;
}

/**
 * A cat's published position: the square cell it is somewhere in (data
 * spine PR 6, spec §6.2). Drawn as the cell with softened corners, never a pin.
 */
export interface AppMapArea {
  id: string;
  /** The cell's centre, exactly as the API sent it. */
  latitude: number;
  longitude: number;
  /** The cell's side, the API's `locationCellM`. */
  sizeMetres: number;
  /** Shown in the middle of the cell, e.g. "Somewhere in here". */
  label?: string;
  onPress?: () => void;
}

export interface AppMapProps {
  latitude: number;
  longitude: number;
  latitudeDelta?: number;
  longitudeDelta?: number;
  markers: AppMapMarker[];
  areas?: AppMapArea[];
  showsUserLocation?: boolean;
  interactive?: boolean;
  markerBorderColor?: string;
  style?: object;
}

export function AppMap({
  latitude,
  longitude,
  latitudeDelta = 0.06,
  longitudeDelta = 0.06,
  markers,
  areas = [],
  showsUserLocation,
  interactive = true,
  markerBorderColor,
  style,
}: AppMapProps) {
  const colors = useColors();
  const resolvedMarkerBorderColor = markerBorderColor ?? colors.primary;

  return (
    <MapView
      style={[styles.map, style]}
      initialRegion={{ latitude, longitude, latitudeDelta, longitudeDelta }}
      showsUserLocation={showsUserLocation}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
    >
      <OsmTiles />
      {areas.map((a) => (
        <Polygon
          key={`area-${a.id}`}
          coordinates={roundedCellPolygon(a, a.sizeMetres)}
          fillColor={`${colors.primary}33`}
          strokeColor={colors.primary}
          strokeWidth={2}
          tappable={!!a.onPress}
          onPress={a.onPress}
        />
      ))}
      {areas
        .filter((a) => a.label)
        .map((a) => (
          <Marker
            key={`area-label-${a.id}`}
            coordinate={{ latitude: a.latitude, longitude: a.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            tappable={false}
          >
            <View style={[styles.areaLabel, { backgroundColor: colors.card }]}>
              <Text style={[styles.areaLabelText, { color: colors.cardForeground }]}>
                {a.label}
              </Text>
            </View>
          </Marker>
        ))}
      {markers.map((m) => (
        <Marker
          key={m.id}
          coordinate={{ latitude: m.latitude, longitude: m.longitude }}
          title={m.title}
          pinColor={m.pinColor ?? colors.primary}
          onCalloutPress={m.onPress}
        >
          {m.image ? (
            <View
              style={[
                styles.markerWrap,
                { backgroundColor: colors.card, borderColor: resolvedMarkerBorderColor },
              ]}
            >
              <Image
                source={m.image}
                style={styles.markerImage}
                contentFit="cover"
              />
            </View>
          ) : undefined}
        </Marker>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  markerWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    overflow: 'hidden',
  },
  markerImage: { width: '100%', height: '100%' },
  areaLabel: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  areaLabelText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});
