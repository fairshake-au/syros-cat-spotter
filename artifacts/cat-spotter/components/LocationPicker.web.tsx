import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { LocationPickerProps } from './LocationPicker';

const STEP = 0.0004; // ~40m per nudge

/**
 * Web fallback: OSM iframe with a marker plus nudge arrows to fine-tune the
 * position (the embedded map cannot report drag events across the iframe
 * boundary). The native app offers full pan-to-pick.
 */
export function LocationPicker({
  latitude,
  longitude,
  onChange,
  pinColor = '#e8558a',
  style,
}: LocationPickerProps) {
  const d = 0.004;
  const bbox = [
    longitude - d,
    latitude - d / 2,
    longitude + d,
    latitude + d / 2,
  ].join('%2C');
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude}%2C${longitude}`;

  const nudge = (dLat: number, dLon: number) =>
    onChange({ latitude: latitude + dLat, longitude: longitude + dLon });

  const arrow = (name: 'arrow-up' | 'arrow-down' | 'arrow-left' | 'arrow-right', dLat: number, dLon: number) => (
    <Pressable
      onPress={() => nudge(dLat, dLon)}
      style={[styles.arrowBtn, { borderColor: pinColor }]}
    >
      <Feather name={name} size={16} color={pinColor} />
    </Pressable>
  );

  return (
    <View style={[styles.container, style]}>
      {React.createElement('iframe', {
        key: src,
        src,
        style: { border: 0, width: '100%', height: '100%' },
        title: 'location picker',
      })}
      <View style={styles.controls}>
        {arrow('arrow-up', STEP, 0)}
        <View style={styles.row}>
          {arrow('arrow-left', 0, -STEP)}
          {arrow('arrow-down', -STEP, 0)}
          {arrow('arrow-right', 0, STEP)}
        </View>
      </View>
      <Text style={styles.coords}>
        {latitude.toFixed(5)}, {longitude.toFixed(5)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', borderRadius: 16 },
  controls: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    alignItems: 'center',
    gap: 4,
  },
  row: { flexDirection: 'row', gap: 4 },
  arrowBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  coords: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    fontSize: 11,
    fontFamily: 'Nunito_600SemiBold',
    color: '#1b2a38',
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
});
