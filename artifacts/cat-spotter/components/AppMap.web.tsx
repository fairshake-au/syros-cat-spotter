import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { AppMapProps } from './AppMap';

/**
 * Web fallback: react-native-maps is native-only, so on web we embed an
 * OpenStreetMap iframe centered on the region and overlay a horizontal
 * strip of tappable markers.
 */
export function AppMap({
  latitude,
  longitude,
  latitudeDelta = 0.06,
  markers,
  markerBorderColor = '#1c77c3',
  style,
}: AppMapProps) {
  const d = latitudeDelta;
  const bbox = [
    longitude - d,
    latitude - d / 2,
    longitude + d,
    latitude + d / 2,
  ].join('%2C');
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude}%2C${longitude}`;

  return (
    <View style={[styles.container, style]}>
      {React.createElement('iframe', {
        src,
        style: { border: 0, width: '100%', height: '100%' },
        title: 'map',
      })}
      {markers.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.stripContent}
        >
          {markers.map((m) => (
            <Pressable key={m.id} onPress={m.onPress} style={styles.chip}>
              {m.imageUrl ? (
                <View
                  style={[styles.markerWrap, { borderColor: markerBorderColor }]}
                >
                  <Image
                    source={{ uri: m.imageUrl }}
                    style={styles.markerImage}
                    contentFit="cover"
                  />
                </View>
              ) : (
                <View
                  style={[
                    styles.markerWrap,
                    { borderColor: m.pinColor ?? markerBorderColor },
                  ]}
                />
              )}
              {m.title ? <Text style={styles.chipText}>{m.title}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
  },
  stripContent: { paddingHorizontal: 12, gap: 10 },
  chip: {
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 12,
    padding: 8,
  },
  markerWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  markerImage: { width: '100%', height: '100%' },
  chipText: { fontSize: 11, fontFamily: 'Nunito_600SemiBold', color: '#1b2a38' },
});
