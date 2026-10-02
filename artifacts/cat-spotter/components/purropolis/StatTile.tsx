import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing, shadows, lineHeights } from '@/constants/theme';
import { displayUpperCase } from '@/lib/displayUpperCase';
import { LABEL_FIT_STEPS, pickLabelFitStep } from '@/lib/labelFit';

export type StatTileTone = 'aegean' | 'bougain' | 'sun' | 'terra' | 'olive' | 'neutral';

export interface StatTileProps {
  value: ReactNode;
  label: string;
  icon?: ReactNode;
  tone?: StatTileTone;
  style?: StyleProp<ViewStyle>;
}

/** A label's own fit: a step index, or OVERFLOW if even the last step is too wide. */
const OVERFLOW = LABEL_FIT_STEPS.length;
const LAST_STEP = LABEL_FIT_STEPS.length - 1;

interface FitGroup {
  step: number;
  report: (id: string, needed: number | null) => void;
}
const StatTileFitContext = createContext<FitGroup | null>(null);

export interface StatTileGroupProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * SYC-143: a row of StatTiles whose labels share one size. Each tile works
 * out how far its own label has to step down to fit (see lib/labelFit), and
 * every tile in the group uses the smallest of those, so a row of three
 * doesn't mix 12px and 10px labels.
 */
export function StatTileGroup({ children, style }: StatTileGroupProps) {
  const [needs, setNeeds] = useState<Record<string, number>>({});
  const report = useCallback((id: string, needed: number | null) => {
    setNeeds((prev) => {
      if (needed === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return prev[id] === needed ? prev : { ...prev, [id]: needed };
    });
  }, []);
  const step = Math.min(LAST_STEP, Math.max(0, ...Object.values(needs)));
  const value = useMemo(() => ({ step, report }), [step, report]);
  return (
    <StatTileFitContext.Provider value={value}>
      <View style={style}>{children}</View>
    </StatTileFitContext.Provider>
  );
}

// useLayoutEffect warns during server rendering (the static web export).
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * SYC-143: measures, on web, how far the label must step down so its longest
 * word fits without breaking. Native text is fitted by the platform instead
 * (`adjustsFontSizeToFit`), so there this is always step 0.
 */
function useLabelFit(text: string) {
  const ref = useRef<Text>(null);
  const [needed, setNeeded] = useState(0);

  const measure = useCallback(() => {
    if (Platform.OS !== 'web') return;
    const el = ref.current as unknown as HTMLElement | null;
    if (!el || !el.style || !el.clientWidth) return;
    const saved = {
      fontSize: el.style.fontSize,
      letterSpacing: el.style.letterSpacing,
      overflowWrap: el.style.overflowWrap,
      wordBreak: el.style.wordBreak,
    };
    // With breaking inside words switched off, a word wider than the box
    // overflows it, which shows up as scrollWidth > clientWidth.
    el.style.overflowWrap = 'normal';
    el.style.wordBreak = 'normal';
    let fitted = false;
    const idx = pickLabelFitStep((step) => {
      el.style.fontSize = `${step.fontSize}px`;
      el.style.letterSpacing = `${step.letterSpacing}px`;
      fitted = el.scrollWidth <= el.clientWidth + 0.5;
      return fitted;
    });
    Object.assign(el.style, saved);
    setNeeded(fitted ? idx : OVERFLOW);
  }, []);

  useIsoLayoutEffect(measure, [text, measure]);
  return { ref, needed, measure };
}

export function StatTile({ value, label, icon, tone = 'neutral', style }: StatTileProps) {
  const colors = useColors();
  const group = useContext(StatTileFitContext);
  const id = useId();
  const upper = displayUpperCase(label);
  const fit = useLabelFit(upper);

  const report = group?.report;
  useEffect(() => {
    report?.(id, fit.needed);
  }, [report, id, fit.needed]);
  useEffect(() => () => report?.(id, null), [report, id]);

  const step = Math.min(LAST_STEP, Math.max(fit.needed, group?.step ?? 0));
  const { fontSize, letterSpacing } = LABEL_FIT_STEPS[step]!;
  // Only a word too long even at the smallest size may break (rather than
  // spill out of the tile).
  const allowBreak = fit.needed === OVERFLOW;

  const tones: Record<StatTileTone, { bg: string; fg: string }> = {
    aegean: { bg: palette.aegean100, fg: palette.aegean800 },
    bougain: { bg: palette.bougain100, fg: palette.bougain700 },
    sun: { bg: palette.sun100, fg: palette.sun700 },
    terra: { bg: palette.terra100, fg: palette.terra700 },
    olive: { bg: palette.olive100, fg: palette.olive700 },
    neutral: { bg: colors.card, fg: colors.foreground },
  };
  const t = tones[tone];

  return (
    <View
      style={[
        styles.base,
        { backgroundColor: t.bg },
        tone === 'neutral' ? shadows.sm : undefined,
        style,
      ]}
    >
      {icon ? <View>{icon}</View> : null}
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text
          style={[
            styles.value,
            { color: t.fg, lineHeight: fontSizes['2xl'] * lineHeights.tight },
          ]}
        >
          {value}
        </Text>
      ) : (
        value
      )}
      {/* Toned tiles keep a fixed light background in both schemes (matching the
          web DS, whose --*-100 ramps are scheme-invariant), so the label must be
          derived from the tone too. Using the scheme-aware muted colour here
          puts pale grey text on a pale tile in dark mode.

          SYC-143: capitals via displayUpperCase (Greek capitals carry no
          accents), and the label wraps only between words. If its longest
          word is too wide for the tile, it steps down in spacing and size
          (web: measured in useLabelFit; native: adjustsFontSizeToFit). */}
      <Text
        ref={fit.ref}
        onLayout={fit.measure}
        {...(Platform.OS === 'web'
          ? {}
          : { adjustsFontSizeToFit: true, minimumFontScale: 0.75, numberOfLines: 2 })}
        style={[
          styles.label,
          {
            color: tone === 'neutral' ? colors.mutedForeground : t.fg,
            opacity: tone === 'neutral' ? 1 : 0.75,
            fontSize,
            letterSpacing,
          },
          Platform.OS === 'web'
            ? ({
                overflowWrap: allowBreak ? 'anywhere' : 'normal',
                wordBreak: 'normal',
              } as object)
            : null,
        ]}
      >
        {upper}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    padding: spacing[4],
    gap: spacing[1],
    minWidth: 120,
  },
  value: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes['2xl'],
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes['2xs'],
  },
});
