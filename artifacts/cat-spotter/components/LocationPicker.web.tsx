import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { LocationPickerProps } from './LocationPicker';
import { Button } from '@/components/purropolis/Button';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useMapLibre } from '@/components/map/useMapLibre.web';
import type { LatLng } from '@/lib/mercator';

const START_ZOOM = 17;
// SYC-509: one arrow-key press moves the map this many pixels (Shift: 4x).
const KEY_STEP = 32;
// Marks camera moves the picker makes for the person (a key press, a tap's
// recentre), so their 'moveend' is reported like a drag's. MapLibre copies
// event data onto the move's events.
const PICKER_MOVE = 'pickerMove';
// Closer than this, a centre is the same spot (the echo of our own onChange).
const SAME_SPOT = 1e-9;

function sameSpot(a: LatLng, b: LatLng): boolean {
  return (
    Math.abs(a.latitude - b.latitude) <= SAME_SPOT && Math.abs(a.longitude - b.longitude) <= SAME_SPOT
  );
}

/**
 * Web pan-to-pick, matching the native picker: the pin stays in the middle
 * and the user drags the map underneath it, or taps a spot to bring it to
 * the pin (SYC-705: drawn by MapLibre from our own Syros map file).
 *
 * The parent hears the new centre once per move the person makes: on the
 * 'moveend' of a drag (MapLibre puts `originalEvent` on those), of a tap's
 * recentre, or of an arrow-key press. Never for the picker's own move when
 * the parent changes `latitude`/`longitude`, and never for a zoom that
 * leaves the centre where it was.
 *
 * Without WebGL (or if the map can't download) the person can still give a
 * place: "Use where I am now" asks the browser for their position.
 */
export function LocationPicker({
  latitude,
  longitude,
  onChange,
  pinColor,
  style,
}: LocationPickerProps) {
  const colors = useColors();
  const { t } = useLanguage();
  const resolvedPinColor = pinColor ?? colors.accent;
  const [center, setCenter] = useState<LatLng>({ latitude, longitude });
  const [locating, setLocating] = useState(false);
  const [locOff, setLocOff] = useState(false);

  const { containerRef, map, failed } = useMapLibre({
    center,
    zoom: START_ZOOM,
    interactive: true,
    rotate: false,
    // Our keys, not MapLibre's: see onKeyDown.
    keyboard: false,
  });

  const centerRef = useRef(center);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const commit = (next: LatLng) => {
    // Update the ref now, so key repeats faster than a render still add up.
    centerRef.current = next;
    setCenter(next);
    onChangeRef.current(next);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Follow the parent if it moves the location itself (for example, a fresh
  // GPS fix before the user has touched the map), but not the echo of our own
  // onChange. jumpTo carries no originalEvent, so it isn't reported back.
  useEffect(() => {
    const next = { latitude, longitude };
    if (sameSpot(centerRef.current, next)) return;
    centerRef.current = next;
    setCenter(next);
    map?.jumpTo({ center: [longitude, latitude] });
  }, [map, latitude, longitude]);

  useEffect(() => {
    if (!map) return;
    // MapLibre makes its canvas a tab stop; the labelled surface is the one.
    map.getCanvas().setAttribute('tabindex', '-1');
    const onMoveEnd = (e: { originalEvent?: unknown; [PICKER_MOVE]?: boolean }) => {
      if (!e.originalEvent && !e[PICKER_MOVE]) return;
      const c = map.getCenter();
      const next = { latitude: c.lat, longitude: c.lng };
      if (sameSpot(centerRef.current, next)) return;
      commitRef.current(next);
    };
    // A tap: bring the tapped spot to the pin; its moveend reports it.
    const onClick = (e: { lngLat: { lng: number; lat: number } }) => {
      map.easeTo({ center: e.lngLat }, { [PICKER_MOVE]: true });
    };
    map.on('moveend', onMoveEnd);
    map.on('click', onClick);
    return () => {
      map.off('moveend', onMoveEnd);
      map.off('click', onClick);
    };
  }, [map]);

  // Zoom about the pin, at once, so quick presses add up.
  const zoomBy = (delta: number) => {
    map?.jumpTo({ zoom: map.getZoom() + delta });
  };

  // SYC-509: a non-drag way to place the pin for keyboard users. Arrow keys
  // move the map under the fixed pin, as a drag would; + and - zoom.
  const onKeyDown = (e: { key: string; shiftKey?: boolean; preventDefault: () => void }) => {
    if (!map) return;
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      // Not animated, so the next press starts from where this one landed.
      map.panBy(move, { animate: false }, { [PICKER_MOVE]: true });
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomBy(1);
    } else if (e.key === '-') {
      e.preventDefault();
      zoomBy(-1);
    }
  };

  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const useWhereIAm = () => {
    setLocOff(false);
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      setLocOff(true);
      return;
    }
    setLocating(true);
    geo.getCurrentPosition(
      (pos) => {
        if (!mounted.current) return;
        setLocating(false);
        commitRef.current({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      () => {
        if (!mounted.current) return;
        setLocating(false);
        setLocOff(true);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const zoomButton = (name: 'plus' | 'minus', delta: number, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => zoomBy(delta)}
      style={[styles.zoomBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Feather name={name} size={18} color={colors.foreground} />
    </Pressable>
  );

  return (
    <View style={[styles.container, style]}>
      {failed === null ? (
        <>
          <View
            style={styles.surface}
            focusable
            // "application" lets screen readers pass the arrow keys through to the map.
            role="application"
            accessibilityLabel={t('mapPickerLabel')}
            // react-native-web passes keydown through on a focusable View.
            {...({ onKeyDown } as object)}
          >
            {/* MapLibre owns this element's children; React puts nothing in it. */}
            <View ref={containerRef} style={StyleSheet.absoluteFill} />
          </View>
          {/* Fixed centre pin; pointerEvents none so the gesture reaches the map */}
          <View pointerEvents="none" style={styles.pinWrap} testID="location-picker-pin">
            <Feather
              name="map-pin"
              size={36}
              color={resolvedPinColor}
              style={[styles.pin, webOnly.noPointer]}
            />
          </View>
          <View style={styles.zoomControls}>
            {zoomButton('plus', 1, t('mapZoomIn'))}
            {zoomButton('minus', -1, t('mapZoomOut'))}
          </View>
        </>
      ) : (
        <View style={styles.failure}>
          <Text style={[styles.failureText, { color: colors.foreground }]}>
            {t(failed === 'no-webgl' ? 'mapNoWebgl' : 'mapLoadFailed')}
          </Text>
          <Button
            variant="secondary"
            size="sm"
            onPress={useWhereIAm}
            disabled={locating}
            iconLeft={<Feather name="crosshair" size={14} color={colors.secondaryForeground} />}
          >
            {locating ? t('locating') : t('claimUseHere')}
          </Button>
          {locOff && (
            <Text style={[styles.failureText, { color: colors.mutedForeground }]}>
              {t('mapLocOffWeb')}
            </Text>
          )}
        </View>
      )}
      <Text
        pointerEvents="none"
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
  noPointer: { pointerEvents: 'none' } as object,
};

const styles = StyleSheet.create({
  container: { overflow: 'hidden', borderRadius: 16, backgroundColor: '#e8e4dc' },
  surface: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  pinWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Lift the pin so its tip (not its center) marks the location.
  pin: { marginBottom: 32, textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 4 },
  zoomControls: { position: 'absolute', right: 8, top: 8, gap: 4 },
  zoomBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failure: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  failureText: { fontSize: 14, fontFamily: 'Inter_500Medium', textAlign: 'center' },
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
