import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';
import { Feather } from '@expo/vector-icons';
import { OsmTiles } from './OsmTiles';
import { useColors } from '@/hooks/useColors';

export interface LocationPickerProps {
  latitude: number;
  longitude: number;
  onChange: (coords: { latitude: number; longitude: number }) => void;
  pinColor?: string;
  style?: object;
}

/**
 * Pan-to-pick location confirmation: the pin stays centered while the user
 * drags the map underneath it. Uses the offline Syros tiles when available.
 */
export function LocationPicker({
  latitude,
  longitude,
  onChange,
  pinColor,
  style,
}: LocationPickerProps) {
  const colors = useColors();
  const resolvedPinColor = pinColor ?? colors.accent;
  // Only the first coords should re-position the map; afterwards the user
  // is in control and we merely report the center back.
  const initial = useRef({ latitude, longitude });

  return (
    <View style={[styles.container, style]}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: initial.current.latitude,
          longitude: initial.current.longitude,
          latitudeDelta: 0.004,
          longitudeDelta: 0.004,
        }}
        showsUserLocation
        onRegionChangeComplete={(region: Region) =>
          onChange({ latitude: region.latitude, longitude: region.longitude })
        }
      >
        <OsmTiles />
      </MapView>
      {/* Fixed center pin; pointerEvents none so map gestures pass through */}
      <View pointerEvents="none" style={styles.pinWrap}>
        <Feather
          name="map-pin"
          size={36}
          color={resolvedPinColor}
          style={styles.pin}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderRadius: 16,
  },
  pinWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Lift the pin so its tip (not its center) marks the location.
  pin: { marginBottom: 32, textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 4 },
});
