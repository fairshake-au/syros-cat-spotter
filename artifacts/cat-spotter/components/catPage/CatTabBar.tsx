import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useQuietColor } from '@/hooks/useQuietColor';
import { fonts, radii } from '@/constants/theme';

export type CatTab = 'about' | 'photos' | 'story' | 'map';

export type CatTabItem = {
  key: CatTab;
  emoji: string;
  label: string;
  /** Photos only: how many photos the grid shows. Absent or 0 shows no badge. */
  badge?: number;
  /** What a screen reader says, e.g. "Photos, 14". */
  a11yLabel: string;
};

export const tabId = (key: CatTab) => `cat-tab-${key}`;
export const panelId = (key: CatTab) => `cat-panel-${key}`;

const LABEL_MAX = 12;
const LABEL_MIN = 10;

/**
 * The label's size: 12, shrinking a pixel at a time down to 10 until it fits
 * its tab, and never cut off with an ellipsis. Native does this itself with
 * `adjustsFontSizeToFit`; the web has no such thing, so it measures the text.
 * (Greek "Φωτογραφίες" is the longest label and must fit a quarter-width tab at 360 px.)
 */
function useFittedLabelSize(label: string, tabWidth: number) {
  const [size, setSize] = React.useState(LABEL_MAX);
  const ref = React.useRef<Text>(null);
  React.useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const measure = () => {
      const el = ref.current as unknown as HTMLElement | null;
      if (!el || typeof el.scrollWidth !== 'number') return;
      // Measure at the largest size first, then step down until it fits.
      // react-native-web keeps the font size as an inline style, so put back
      // what it had (clearing it would leave the label at the browser default
      // when the fitted size equals the current state and nothing re-renders).
      const previous = el.style.fontSize;
      let next = LABEL_MAX;
      el.style.fontSize = `${next}px`;
      while (next > LABEL_MIN && el.scrollWidth > el.clientWidth + 0.5) {
        next -= 1;
        el.style.fontSize = `${next}px`;
      }
      el.style.fontSize = previous;
      setSize(next);
    };
    measure();
    // The first measure can run before the web font has loaded, with the
    // fallback font's narrower letters; measure again once fonts are ready.
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    let cancelled = false;
    fonts?.ready?.then(() => {
      if (!cancelled) measure();
    });
    const onLoaded = () => measure();
    fonts?.addEventListener?.('loadingdone', onLoaded);
    return () => {
      cancelled = true;
      fonts?.removeEventListener?.('loadingdone', onLoaded);
    };
  }, [label, tabWidth]);
  return { size, ref };
}

function Tab({
  item,
  selected,
  onSelect,
  onKey,
  tabWidth,
  forwardRef,
}: {
  item: CatTabItem;
  selected: boolean;
  onSelect: () => void;
  onKey: (e: { key: string; preventDefault: () => void }) => void;
  tabWidth: number;
  forwardRef: (el: View | null) => void;
}) {
  const colors = useColors();
  const quiet = useQuietColor();
  const { size, ref } = useFittedLabelSize(item.label, tabWidth);
  const webProps = {
    id: tabId(item.key),
    'aria-controls': panelId(item.key),
    tabIndex: selected ? 0 : -1,
    onKeyDown: onKey,
  } as object;
  return (
    <Pressable
      ref={forwardRef}
      role="tab"
      aria-selected={selected}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={item.a11yLabel}
      onPress={onSelect}
      testID={`cat-tab-${item.key}`}
      {...webProps}
      style={[
        styles.tab,
        selected && { backgroundColor: colors.card, borderColor: colors.border },
        !selected && styles.tabIdle,
      ]}
    >
      <View style={styles.emojiWrap}>
        <Text aria-hidden accessibilityElementsHidden importantForAccessibility="no" style={styles.emoji}>
          {item.emoji}
        </Text>
        {item.badge ? (
          <View
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={[styles.badge, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>{item.badge}</Text>
          </View>
        ) : null}
      </View>
      <Text
        ref={ref}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={LABEL_MIN / LABEL_MAX}
        style={[
          styles.label,
          // Idle labels use the page's quiet grey on the tab row (colors.muted):
          // stone700 on stone200 is 6.14:1 in light mode (the old stone600 was
          // 3.87:1); dark mode's stone400 on aegean800 is 5.16:1. Both pass 4.5:1.
          { fontSize: size, color: selected ? colors.foreground : quiet },
          // No ellipsis on the web: the size above is what makes it fit.
          ({ textOverflow: 'clip' } as object),
        ]}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

/**
 * The cat page's tab row (SYC-624): four equal tabs, emoji over label.
 * Sticky is the page's job (it is a direct child of the scroll view). It is a
 * tab list; the left and right arrow keys move between tabs on the web, with
 * only the selected tab in the Tab-key order.
 */
export function CatTabBar({
  tabs,
  selected,
  onSelect,
  topInset = 0,
  stuck = false,
  leftGutter = 0,
}: {
  tabs: CatTabItem[];
  selected: CatTab;
  onSelect: (k: CatTab) => void;
  /** The safe-area height kept clear above the row (it only paints once pinned). */
  topInset?: number;
  /** True while the row is pinned to the top of the screen. */
  stuck?: boolean;
  /** Room kept on the left while pinned, for the back button over the row. */
  leftGutter?: number;
}) {
  const colors = useColors();
  const [width, setWidth] = React.useState(0);
  const refs = React.useRef<Record<string, View | null>>({});

  const move = (to: number) => {
    const next = tabs[(to + tabs.length) % tabs.length];
    if (!next) return;
    onSelect(next.key);
    setTimeout(() => (refs.current[next.key] as unknown as { focus?: () => void } | null)?.focus?.(), 0);
  };

  return (
    <View
      style={[
        styles.bar,
        // The padding above the row overlaps the photo on a phone; touches there go to the photo.
        { pointerEvents: 'box-none' } as object,
        { paddingTop: topInset + 6 },
        stuck && { backgroundColor: colors.background, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View
        role="tablist"
        accessibilityRole="tablist"
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={[styles.row, { backgroundColor: colors.muted }, stuck && leftGutter > 0 && { marginLeft: leftGutter }]}
      >
        {tabs.map((item, index) => (
          <Tab
            key={item.key}
            item={item}
            selected={item.key === selected}
            tabWidth={width}
            onSelect={() => onSelect(item.key)}
            forwardRef={(el) => {
              refs.current[item.key] = el;
            }}
            onKey={(e) => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                move(index + 1);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                move(index - 1);
              }
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 8, paddingBottom: 6, paddingTop: 6 },
  row: { flexDirection: 'row', borderRadius: radii.md, padding: 3, gap: 2 },
  tab: {
    flex: 1,
    minHeight: 48,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: 2,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  tabIdle: { borderColor: 'transparent' },
  emojiWrap: { alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 16, lineHeight: 20 },
  // Always bold, selected or not: the fit is measured in this weight, so choosing
  // a tab can never make its label wider than the room it was fitted to.
  label: { fontFamily: fonts.bodyBold, textAlign: 'center', maxWidth: '100%' },
  badge: {
    position: 'absolute',
    top: -4,
    left: '60%',
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, lineHeight: 12, fontFamily: fonts.bodyBold },
});
