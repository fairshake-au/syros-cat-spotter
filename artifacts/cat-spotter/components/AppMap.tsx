import React from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Image } from 'expo-image';
import { OsmTiles } from './OsmTiles';
import { useColors } from '@/hooks/useColors';

export interface AppMapMarker {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  imageUrl?: string;
  pinColor?: string;
  onPress?: () => void;
}

export interface AppMapProps {
  latitude: number;
  longitude: number;
  latitudeDelta?: number;
  longitudeDelta?: number;
  markers: AppMapMarker[];
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
      {markers.map((m) => (
        <Marker
          key={m.id}
          coordinate={{ latitude: m.latitude, longitude: m.longitude }}
          title={m.title}
          pinColor={m.pinColor ?? colors.primary}
          onCalloutPress={m.onPress}
        >
          {m.imageUrl ? (
            <View
              style={[
                styles.markerWrap,
                { backgroundColor: colors.card, borderColor: resolvedMarkerBorderColor },
              ]}
            >
              <Image
                source={{ uri: m.imageUrl }}
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
});
