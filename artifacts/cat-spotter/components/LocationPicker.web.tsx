import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { LocationPickerProps } from './LocationPicker';
import { useColors } from '@/hooks/useColors';
import {
  clampZoom,
  latLngAtOffset,
  visibleTiles,
  type LatLng,
} from '@/lib/mapTiles';

const START_ZOOM = 17;
// Movement under this many pixels is a tap, not a drag.
const TAP_SLOP = 6;
// Tiles drawn beyond each edge, so a long drag doesn't show grey gaps before
// the map recentres on release.
const DRAG_MARGIN = 384;

/**
 * Web pan-to-pick, matching the native picker: the pin stays in the middle
 * and the user drags the map underneath it, or taps a spot to bring it to
 * the pin. The map is drawn from OpenStreetMap tiles directly, because the
 * embedded OSM iframe this replaced could be dragged but never told us where
 * it had been dragged to — testers moved the map and the sighting was still
 * saved where they were standing.
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
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(START_ZOOM);
  const [center, setCenter] = useState<LatLng>({ latitude, longitude });
  // During a drag the map follows the finger without reporting every frame;
  // the parent hears about the new centre once, on release.
  const [dragOffset, setDragOffset] = useState({ dx: 0, dy: 0 });

  // Refs for the gesture handlers, which are created once.
  const centerRef = useRef(center);
  const zoomRef = useRef(zoom);
  const surfaceRef = useRef<View>(null);
  const onChangeRef = useRef(onChange);
  centerRef.current = center;
  zoomRef.current = zoom;
  onChangeRef.current = onChange;

  // Follow the parent if it moves the location itself (for example, a fresh
  // GPS fix before the user has touched the map), but not the echo of our own
  // onChange.
  useEffect(() => {
    const c = centerRef.current;
    if (
      Math.abs(c.latitude - latitude) > 1e-9 ||
      Math.abs(c.longitude - longitude) > 1e-9
    ) {
      setCenter({ latitude, longitude });
    }
  }, [latitude, longitude]);

  const commit = (next: LatLng) => {
    setCenter(next);
    onChangeRef.current(next);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Keep the gesture: otherwise the page scrolls instead of the map.
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => setDragOffset({ dx: g.dx, dy: g.dy }),
        onPanResponderRelease: (e, g) => {
          setDragOffset({ dx: 0, dy: 0 });
          const moved = Math.abs(g.dx) > TAP_SLOP || Math.abs(g.dy) > TAP_SLOP;
          if (moved) {
            // Dragging the map right brings what was to the left under the pin.
            commit(latLngAtOffset(centerRef.current, zoomRef.current, -g.dx, -g.dy));
            return;
          }
          // A tap: bring the tapped spot to the pin. Measured against the map
          // surface itself, because the event's own location is relative to
          // whichever tile image was under the finger.
          const node = surfaceRef.current as unknown as HTMLElement | null;
          const { pageX, pageY } = e.nativeEvent;
          if (!node?.getBoundingClientRect) return;
          if (typeof pageX !== 'number' || typeof pageY !== 'number') return;
          const rect = node.getBoundingClientRect();
          const x = pageX - window.scrollX - rect.left;
          const y = pageY - window.scrollY - rect.top;
          commit(
            latLngAtOffset(
              centerRef.current,
              zoomRef.current,
              x - rect.width / 2,
              y - rect.height / 2,
            ),
          );
        },
        onPanResponderTerminate: () => setDragOffset({ dx: 0, dy: 0 }),
      }),
    [],
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
        ref={surfaceRef}
        style={[styles.surface, webOnly.noTouchScroll]}
        {...panResponder.panHandlers}
        accessibilityLabel="location picker"
      >
        {/* Tiles ignore the pointer so the browser never starts dragging an
            image, and every touch lands on the surface that owns the gesture. */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {tiles.map((t) => (
            <Image
              key={t.key}
              source={{ uri: t.url }}
              style={[
                styles.tile,
                { left: t.left + dragOffset.dx, top: t.top + dragOffset.dy },
              ]}
            />
          ))}
        </View>
      </View>
      {/* Fixed centre pin; pointerEvents none so the gesture reaches the map */}
      <View pointerEvents="none" style={styles.pinWrap}>
        <Feather name="map-pin" size={36} color={resolvedPinColor} style={styles.pin} />
      </View>
      <View style={styles.zoomControls}>
        {zoomButton('plus', 1, 'Zoom in')}
        {zoomButton('minus', -1, 'Zoom out')}
      </View>
      <Text
        style={[styles.coords, { backgroundColor: colors.card, color: colors.cardForeground }]}
      >
        {center.latitude.toFixed(5)}, {center.longitude.toFixed(5)}
      </Text>
      <Text pointerEvents="none" style={styles.attribution}>
        © OpenStreetMap contributors
      </Text>
    </View>
  );
}

// Web-only style keys that the React Native style types do not know about.
const webOnly = {
  noTouchScroll: { touchAction: 'none', cursor: 'grab', userSelect: 'none' } as object,
};

const styles = StyleSheet.create({
  container: { overflow: 'hidden', borderRadius: 16, backgroundColor: '#e8e4dc' },
  surface: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  tile: { position: 'absolute', width: 256, height: 256 },
  pinWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Lift the pin so its tip (not its center) marks the location.
  pin: { marginBottom: 32, textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 4 },
  zoomControls: { position: 'absolute', right: 8, top: 8, gap: 4 },
  zoomBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coords: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
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
