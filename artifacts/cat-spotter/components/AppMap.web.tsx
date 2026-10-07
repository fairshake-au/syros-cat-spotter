import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as RNImage,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import type { AppMapProps } from './AppMap';
import { useColors } from '@/hooks/useColors';
import { cellBoxPixels } from '@/lib/cellShape';
import { clampZoom, latLngAtOffset, visibleTiles, type LatLng } from '@/lib/mapTiles';

// Tiles drawn beyond each edge, so a drag doesn't show grey gaps before the
// map recentres on release.
const DRAG_MARGIN = 384;

/** The tile zoom that shows roughly `latitudeDelta` degrees top to bottom. */
export function zoomForDelta(latitudeDelta: number): number {
  return clampZoom(Math.log2(360 / latitudeDelta) - 1);
}

/**
 * Web map. react-native-maps is native-only, and the embedded OpenStreetMap
 * iframe this replaced could only draw one pin, so it couldn't show a cat's
 * published cell (data spine PR 6, spec §6.2). This draws OpenStreetMap
 * tiles itself, like the web location picker, lays each cell over them as a
 * square with softened corners, and keeps the strip of tappable cats.
 */
export function AppMap({
  latitude,
  longitude,
  latitudeDelta = 0.06,
  markers,
  areas = [],
  interactive = true,
  markerBorderColor,
  style,
}: AppMapProps) {
  const colors = useColors();
  const resolvedMarkerBorderColor = markerBorderColor ?? colors.primary;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(() => zoomForDelta(latitudeDelta));
  const [center, setCenter] = useState<LatLng>({ latitude, longitude });
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const centerRef = useRef(center);
  const zoomRef = useRef(zoom);
  centerRef.current = center;
  zoomRef.current = zoom;

  // Follow the parent when it moves the map (e.g. the user's location arrives).
  useEffect(() => {
    setCenter({ latitude, longitude });
  }, [latitude, longitude]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) =>
          interactive && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => setDrag({ dx: g.dx, dy: g.dy }),
        onPanResponderRelease: (_e, g) => {
          setDrag({ dx: 0, dy: 0 });
          setCenter(latLngAtOffset(centerRef.current, zoomRef.current, -g.dx, -g.dy));
        },
        onPanResponderTerminate: () => setDrag({ dx: 0, dy: 0 }),
      }),
    [interactive],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  const tiles = visibleTiles(center, zoom, size.width, size.height, DRAG_MARGIN);

  const zoomButton = (name: 'plus' | 'minus', delta: number, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => setZoom((z) => clampZoom(z + delta))}
      style={[styles.zoomBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Feather name={name} size={18} color={colors.foreground} />
    </Pressable>
  );

  return (
    <View style={[styles.container, style]} onLayout={onLayout}>
      <View
        style={[styles.surface, interactive ? webOnly.grab : null]}
        {...panResponder.panHandlers}
        accessibilityLabel="map"
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {tiles.map((t) => (
            <RNImage
              key={t.key}
              source={{ uri: t.url }}
              style={[styles.tile, { left: t.left + drag.dx, top: t.top + drag.dy }]}
            />
          ))}
        </View>
        {size.width > 0 &&
          areas.map((a) => {
            const box = cellBoxPixels(a, a.sizeMetres, center, zoom, size.width, size.height);
            return (
              <Pressable
                key={a.id}
                disabled={!a.onPress}
                onPress={a.onPress}
                accessibilityLabel={a.label}
                style={[
                  styles.area,
                  {
                    left: box.left + drag.dx,
                    top: box.top + drag.dy,
                    width: box.width,
                    height: box.height,
                    borderRadius: box.radius,
                    borderColor: colors.primary,
                    backgroundColor: `${colors.primary}33`,
                  },
                ]}
              >
                {a.label ? (
                  <View style={[styles.areaLabel, { backgroundColor: colors.card }]}>
                    <Text
                      numberOfLines={1}
                      style={[styles.areaLabelText, { color: colors.cardForeground }]}
                    >
                      {a.label}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
      </View>
      {interactive && (
        <View style={styles.zoomControls}>
          {zoomButton('plus', 1, 'Zoom in')}
          {zoomButton('minus', -1, 'Zoom out')}
        </View>
      )}
      {markers.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.stripContent}
        >
          {markers.map((m) => (
            <Pressable
              key={m.id}
              onPress={m.onPress}
              style={[styles.chip, { backgroundColor: colors.card }]}
            >
              {m.image ? (
                <View
                  style={[
                    styles.markerWrap,
                    {
                      backgroundColor: colors.card,
                      borderColor: resolvedMarkerBorderColor,
                    },
                  ]}
                >
                  <Image source={m.image} style={styles.markerImage} contentFit="cover" />
                </View>
              ) : (
                <View
                  style={[
                    styles.markerWrap,
                    {
                      backgroundColor: colors.card,
                      borderColor: m.pinColor ?? resolvedMarkerBorderColor,
                    },
                  ]}
                />
              )}
              {m.title ? (
                <Text style={[styles.chipText, { color: colors.cardForeground }]}>{m.title}</Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Text pointerEvents="none" style={styles.attribution}>
        © OpenStreetMap contributors
      </Text>
    </View>
  );
}

// Web-only style keys that the React Native style types do not know about.
const webOnly = {
  grab: { touchAction: 'none', cursor: 'grab', userSelect: 'none' } as object,
};

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden', backgroundColor: '#e8e4dc' },
  surface: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  tile: { position: 'absolute', width: 256, height: 256 },
  area: {
    position: 'absolute',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  areaLabel: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  areaLabelText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  zoomControls: { position: 'absolute', right: 8, top: 8, gap: 4 },
  zoomBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
  },
  stripContent: { paddingHorizontal: 12, gap: 10 },
  chip: {
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    padding: 8,
  },
  markerWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    overflow: 'hidden',
  },
  markerImage: { width: '100%', height: '100%' },
  chipText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  attribution: {
    position: 'absolute',
    right: 6,
    bottom: 4,
    fontSize: 10,
    color: '#333',
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
