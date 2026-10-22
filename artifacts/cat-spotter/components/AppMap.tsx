import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import MapView, { Marker, Polygon } from 'react-native-maps';
import { Image, type ImageSource } from 'expo-image';
import { OsmTiles } from './OsmTiles';
import { useColors } from '@/hooks/useColors';
import {
  LABEL_MIN_PX,
  cellWidthOnNativeMap,
  fitRegion,
  roundedCellPolygon,
} from '@/lib/cellShape';

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
  /** Shown in the middle of the cell, e.g. "Somewhere in here" or "3 cats". Hidden while the cell is under 40 px wide. */
  label?: string;
  /** Spoken label, e.g. "Agatha's area" or "Area with 3 cats". */
  accessibilityLabel?: string;
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
  /**
   * When this changes, the map moves to fit the areas it has at that moment
   * (without remounting). New data, a location fix or a keystroke alone never
   * move it. Leave it out to keep the given centre.
   */
  fitKey?: string | number;
  /** Web only: a chip at the start of the cat strip, e.g. "Show all". */
  stripAction?: { label: string; onPress: () => void };
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
  fitKey,
}: AppMapProps) {
  const colors = useColors();
  const resolvedMarkerBorderColor = markerBorderColor ?? colors.primary;
  const mapRef = useRef<MapView>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [lngDelta, setLngDelta] = useState(longitudeDelta);
  const areasRef = useRef(areas);
  areasRef.current = areas;
  const fittedKey = useRef<string | number | null>(null);
  const hasAreas = areas.length > 0;

  // Fit once per key, once the map is measured and there is something to fit.
  useEffect(() => {
    if (fitKey === undefined || size.width <= 0 || !hasAreas) return;
    if (fittedKey.current === fitKey) return;
    const fit = fitRegion(
      areasRef.current.map((a) => ({
        latitude: a.latitude,
        longitude: a.longitude,
        sizeMetres: a.sizeMetres,
      })),
      size,
    );
    if (!fit) return;
    const first = fittedKey.current === null;
    fittedKey.current = fitKey;
    setLngDelta(fit.longitudeDelta);
    mapRef.current?.animateToRegion(
      {
        latitude: fit.latitude,
        longitude: fit.longitude,
        latitudeDelta: fit.latitudeDelta,
        longitudeDelta: fit.longitudeDelta,
      },
      first ? 0 : 300,
    );
  }, [fitKey, size, hasAreas]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  };

  return (
    <MapView
      ref={mapRef}
      onLayout={onLayout}
      onRegionChangeComplete={(r) => setLngDelta(r.longitudeDelta)}
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
        .filter(
          (a) =>
            a.label &&
            cellWidthOnNativeMap(a, a.sizeMetres, lngDelta, size.width || 1) >= LABEL_MIN_PX,
        )
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
