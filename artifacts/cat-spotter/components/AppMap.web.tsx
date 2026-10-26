import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import type { AppMapArea, AppMapProps } from './AppMap';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { CORNER_SHARE, LABEL_MIN_PX, fitRegion, roundedCellPolygon } from '@/lib/cellShape';
import { clampZoom, toMapLibreZoom } from '@/lib/mercator';
import { useMapLibre, type MaplibreMap } from './map/useMapLibre.web';

/** The app zoom that shows roughly `latitudeDelta` degrees top to bottom. */
export function zoomForDelta(latitudeDelta: number): number {
  return clampZoom(Math.log2(360 / latitudeDelta) - 1);
}

/** A cell's true square: its edges as latitudes and longitudes. */
export interface CellBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** Where a cell's square sits over the map, in pixels from the map's top-left. */
export interface CellBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Radians, clockwise on screen; non-zero only while the map is rotated. */
  angle: number;
}

/** The true square, from the bounds of the drawn (rounded) cell. */
export function cellBounds(a: AppMapArea): CellBounds {
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  for (const p of roundedCellPolygon(a, a.sizeMetres)) {
    north = Math.max(north, p.latitude);
    south = Math.min(south, p.latitude);
    east = Math.max(east, p.longitude);
    west = Math.min(west, p.longitude);
  }
  return { north, south, east, west };
}

/**
 * The square on screen, from where MapLibre draws its corners. When the map
 * is rotated the square turns with it: the box is centred on the cell and
 * rotated (about its centre, clockwise) by the angle of its north edge.
 */
export function cellBox(map: Pick<MaplibreMap, 'project'>, b: CellBounds): CellBox {
  const nw = map.project([b.west, b.north]);
  const ne = map.project([b.east, b.north]);
  const sw = map.project([b.west, b.south]);
  const width = Math.hypot(ne.x - nw.x, ne.y - nw.y);
  const height = Math.hypot(sw.x - nw.x, sw.y - nw.y);
  const angle = Math.atan2(ne.y - nw.y, ne.x - nw.x);
  if (Math.abs(angle) < 1e-6) return { left: nw.x, top: nw.y, width, height, angle: 0 };
  // Centre of the square: halfway along the NE–SW diagonal.
  const cx = (ne.x + sw.x) / 2;
  const cy = (ne.y + sw.y) / 2;
  return { left: cx - width / 2, top: cy - height / 2, width, height, angle };
}

/**
 * The area under a point on the map, if a pressable one is there: the last
 * one drawn wins, as the topmost square did when squares took taps
 * themselves. Works in latitude and longitude, so rotation doesn't matter.
 */
export function pressableAreaAt(
  areas: readonly AppMapArea[],
  bounds: readonly CellBounds[],
  at: { lng: number; lat: number },
): AppMapArea | null {
  for (let i = areas.length - 1; i >= 0; i--) {
    const a = areas[i]!;
    const b = bounds[i];
    if (!a.onPress || !b) continue;
    if (at.lat <= b.north && at.lat >= b.south && at.lng <= b.east && at.lng >= b.west) return a;
  }
  return null;
}

const nextFrame: (cb: () => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 16) as unknown as number;
const cancelFrame: (id: number) => void =
  typeof cancelAnimationFrame === 'function'
    ? (id) => cancelAnimationFrame(id)
    : (id) => clearTimeout(id);

/**
 * Web map, drawn by MapLibre from our own Syros map file (SYC-705). Each cat's
 * published cell is a DOM square laid over the map, placed with map.project
 * and moved with the map frame by frame. The squares are pointer-transparent,
 * so every drag, pinch and wheel reaches the map; a tap is found from the
 * map's own 'click' (which never fires after a drag). They stay Pressables,
 * so they keep their spoken labels, tab order and Enter/Space. The map
 * rotates; a compass button turns it back to north, and labels stay upright.
 * The strip of tappable cats sits along the bottom and keeps working when the
 * map itself can't draw.
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
  fitKey,
  stripAction,
}: AppMapProps) {
  const colors = useColors();
  const { t } = useLanguage();
  const resolvedMarkerBorderColor = markerBorderColor ?? colors.primary;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { containerRef, map, failed } = useMapLibre({
    center: { latitude, longitude },
    zoom: zoomForDelta(latitudeDelta),
    interactive,
    rotate: true,
    keyboard: true,
  });

  // Follow the parent when it moves the map (e.g. the user's location
  // arrives), keeping the zoom. The map starts at the first centre itself.
  const appliedCentre = useRef({ latitude, longitude });
  useEffect(() => {
    if (!map) return;
    const prev = appliedCentre.current;
    if (prev.latitude === latitude && prev.longitude === longitude) return;
    appliedCentre.current = { latitude, longitude };
    map.jumpTo({ center: [longitude, latitude] });
  }, [map, latitude, longitude]);

  // Fit to the areas once per `fitKey`, when the map is measured and there is
  // something to fit. New data under the same key does not move the map.
  const areasRef = useRef(areas);
  areasRef.current = areas;
  const fittedKey = useRef<string | number | null>(null);
  const hasAreas = areas.length > 0;
  useEffect(() => {
    if (!map || fitKey === undefined || size.width <= 0 || !hasAreas) return;
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
    fittedKey.current = fitKey;
    map.jumpTo({ center: [fit.longitude, fit.latitude], zoom: toMapLibreZoom(fit.zoom) });
  }, [map, fitKey, size, hasAreas]);

  const bounds = useMemo(() => areas.map(cellBounds), [areas]);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  // Squares are placed during render from map.project. The map's camera
  // events only ask for a new render, at most once per animation frame.
  // Keyed on the map alone, so callers' inline `areas` never re-subscribe.
  const [, setFrame] = useState(0);
  const [bearing, setBearing] = useState(0);
  useEffect(() => {
    if (!map) return;
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = nextFrame(() => {
        frame = null;
        setFrame((n) => n + 1);
      });
    };
    const onRotate = () => setBearing(map.getBearing());
    const hit = (e: { lngLat: { lng: number; lat: number } }) =>
      pressableAreaAt(areasRef.current, boundsRef.current, e.lngLat);
    const onClick = (e: { lngLat: { lng: number; lat: number } }) => hit(e)?.onPress?.();
    const onMouseMove = (e: { lngLat: { lng: number; lat: number } }) => {
      map.getCanvas().style.cursor = hit(e) ? 'pointer' : '';
    };
    const camera = ['move', 'zoom', 'rotate', 'resize'] as const;
    for (const e of camera) map.on(e, schedule);
    map.on('rotate', onRotate);
    map.on('click', onClick);
    map.on('mousemove', onMouseMove);
    onRotate();
    return () => {
      for (const e of camera) map.off(e, schedule);
      map.off('rotate', onRotate);
      map.off('click', onClick);
      map.off('mousemove', onMouseMove);
      if (frame !== null) cancelFrame(frame);
    };
  }, [map]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  };

  const controlButton = (
    icon: React.ReactNode,
    label: string,
    onPress: () => void,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.zoomBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      {icon}
    </Pressable>
  );

  const boxes = map !== null && failed === null ? bounds.map((b) => cellBox(map, b)) : null;
  // MapLibre snaps back to north within a few degrees; anything else is a turned map.
  const rotated = Math.abs(bearing) > 0.01;

  return (
    <View style={[styles.container, style]} onLayout={onLayout}>
      <View style={styles.surface} accessibilityLabel="map">
        {/* MapLibre owns this element's children; React puts nothing in it. */}
        <View ref={containerRef} style={StyleSheet.absoluteFill} />
        {boxes && (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {areas.map((a, i) => {
              const box = boxes[i]!;
              return (
                <Pressable
                  key={a.id}
                  disabled={!a.onPress}
                  onPress={a.onPress}
                  accessibilityRole={a.onPress ? 'button' : undefined}
                  accessibilityLabel={a.accessibilityLabel ?? a.label}
                  style={[
                    styles.area,
                    { left: box.left, top: box.top, width: box.width, height: box.height },
                  ]}
                >
                  {/* The square turns with the map; the label stays upright. */}
                  <View
                    pointerEvents="none"
                    style={[
                      styles.areaSquare,
                      {
                        borderRadius: Math.min(box.width, box.height) * CORNER_SHARE,
                        borderColor: colors.primary,
                        backgroundColor: `${colors.primary}33`,
                      },
                      box.angle !== 0 ? { transform: [{ rotate: `${box.angle}rad` }] } : null,
                    ]}
                  />
                  {a.label && box.width >= LABEL_MIN_PX ? (
                    <View
                      pointerEvents="none"
                      style={[styles.areaLabel, { backgroundColor: colors.card }]}
                    >
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
        )}
        {failed !== null && (
          <View style={[styles.failure, { backgroundColor: colors.card }]}>
            <Text style={[styles.failureText, { color: colors.cardForeground }]}>
              {t(failed === 'no-webgl' ? 'mapNoWebgl' : 'mapLoadFailed')}
            </Text>
          </View>
        )}
      </View>
      {markers.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.stripContent}
        >
          {stripAction ? (
            <Pressable
              accessibilityRole="button"
              onPress={stripAction.onPress}
              style={[styles.chip, styles.stripAction, { backgroundColor: colors.card, borderColor: colors.primary }]}
            >
              <Text style={[styles.chipText, { color: colors.primary }]}>{stripAction.label}</Text>
            </Pressable>
          ) : null}
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
      {/* After the strip, and zIndex 1: on a short map the strip's empty area would otherwise cover the compass. */}
      {interactive && failed === null && (
        <View style={styles.zoomControls}>
          {controlButton(
            <Feather name="plus" size={18} color={colors.foreground} />,
            t('mapZoomIn'),
            () => map?.easeTo({ zoom: map.getZoom() + 1 }),
          )}
          {controlButton(
            <Feather name="minus" size={18} color={colors.foreground} />,
            t('mapZoomOut'),
            () => map?.easeTo({ zoom: map.getZoom() - 1 }),
          )}
          {rotated &&
            controlButton(
              // The arrow points at north on screen.
              <View style={{ transform: [{ rotate: `${-bearing}deg` }] }}>
                <Feather name="navigation-2" size={18} color={colors.foreground} />
              </View>,
              t('mapResetNorth'),
              () => map?.easeTo({ bearing: 0 }),
            )}
        </View>
      )}
      <Text pointerEvents="none" style={styles.attribution}>
        © OpenStreetMap contributors
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden', backgroundColor: '#e8e4dc' },
  surface: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  failure: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  failureText: { fontSize: 14, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  area: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  areaSquare: { ...StyleSheet.absoluteFillObject, borderWidth: 2 },
  areaLabel: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  areaLabelText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  zoomControls: { position: 'absolute', right: 8, top: 8, gap: 4, zIndex: 1 },
  zoomBtn: {
    width: 44,
    height: 44,
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
  stripAction: { justifyContent: 'center', borderWidth: 1, paddingHorizontal: 14 },
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
