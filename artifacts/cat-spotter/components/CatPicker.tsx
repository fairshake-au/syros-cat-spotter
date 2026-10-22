/**
 * "Which cat is it?": the spotter finds the right cat themselves when the
 * suggestions miss (SYC-119, docs/specs/choose-a-different-cat.md §3.2).
 *
 * Cats known around here, nearest first by published square, with big
 * photos, a search box that only narrows that list, and a side-by-side check
 * before choosing. Built only from the public cat-alogue and the location
 * saved with the sighting (lib/catPicker.ts), so it works from the phone's
 * saved copy without signal. Sending the choice is the review screen's job.
 *
 * SYC-398 PR D (coat-colours-and-pattern.md §5): two rows of drawn chips,
 * colours and patterns, narrow the list further. A cat whose coat isn't known
 * is never hidden: it is listed under *Not known*. The cats the chips hide
 * are counted above "Can't find it?", with one tap to show them all. The
 * chips start at *All* each time the picker opens (it is mounted afresh).
 * They never touch the review screen's suggestions.
 *
 * Not yet (plan decision 4): "Ask Syros Cats to match it".
 */
import React, { useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import {
  useGetCat,
  getGetCatQueryKey,
  type Cat,
} from '@workspace/api-client-react';
import type { LatLng } from '@workspace/geo';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { Button, IconButton } from '@/components/purropolis';
import { appearanceLine } from '@/lib/appearance';
import { appWidth } from '@/lib/appColumn';
import { photoSource } from '@/lib/urls';
import { pickedFromFor, pickerList, type PickedFrom } from '@/lib/catPicker';
import { filterIsOn, placeCats, type Picked } from '@/lib/coat';
import { CoatChips, NOTHING_PICKED } from '@/components/coat';
import {
  borderWidths,
  fonts,
  fontSizes,
  radii,
  spacing,
} from '@/constants/theme';

export interface CatPickerProps {
  /** Where the photo was taken, as saved with the sighting. */
  from: LatLng | null;
  /** The public cat-alogue: fresh when online, the saved copy offline. */
  cats: readonly Cat[];
  isOffline: boolean;
  /** A choice is being sent. */
  busy: boolean;
  /** Translation key for a line above the list (a refusal, no signal). */
  message: string | null;
  /** The spotter's own photo, rendered by the review screen. */
  yourPhoto: ReactNode;
  /** `colourFilterOn`: a chip was picked in either row (sighting_matches.colour_filter_on, spec §5). */
  onPick: (catId: number, pickedFrom: PickedFrom, colourFilterOn: boolean) => void;
  onAddNew: (colourFilterOn: boolean) => void;
  onClose: () => void;
  insetTop?: number;
  insetBottom?: number;
}

const CONTENT_MAX_WIDTH = 720;
const CONTENT_PADDING = 16;
const GRID_GAP = 12;

function catCode(id: number): string {
  return `SYR-${String(id).padStart(4, '0')}`;
}

export function CatPicker({
  from,
  cats,
  isOffline,
  busy,
  message,
  yourPhoto,
  onPick,
  onAddNew,
  onClose,
  insetTop = 0,
  insetBottom = 0,
}: CatPickerProps) {
  const colors = useColors();
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Cat | null>(null);
  // Both rows start at All, every time the picker opens (spec §5).
  const [picked, setPicked] = useState<Picked>(NOTHING_PICKED);
  // Equal-width columns: two on a phone, up to four on a wide screen, so the
  // last row never stretches wider than the rows above it.
  const width = appWidth(useWindowDimensions().width);
  const contentWidth = Math.min(width, CONTENT_MAX_WIDTH) - 2 * CONTENT_PADDING;
  const columns = contentWidth >= 600 ? 4 : contentWidth >= 420 ? 3 : 2;
  const cardWidth = Math.floor(
    (contentWidth - GRID_GAP * (columns - 1)) / columns,
  );

  // What the search finds, then where the chips place each of those cats:
  // every one counted once, as a match, Not known, or hidden (spec §5).
  const listed = useMemo(
    () => (from ? pickerList(from, cats, query) : []),
    [from, cats, query],
  );
  const placed = useMemo(() => placeCats(listed, picked), [listed, picked]);
  const showAll = () => setPicked(NOTHING_PICKED);

  // Up to two more public photos for the side-by-side check. Only with
  // signal: offline, the main photo (if the phone has it) is all there is.
  const detail = useGetCat(selected?.id ?? 0, {
    query: {
      enabled: selected != null && !isOffline,
      queryKey: getGetCatQueryKey(selected?.id ?? 0),
    },
  });
  const morePhotos = useMemo(() => {
    if (!selected || !detail.data) return [];
    const seen = new Set([selected.photoUrl]);
    const out: string[] = [];
    for (const s of detail.data.sightings) {
      if (out.length === 2) break;
      if (!s.photoUrl || seen.has(s.photoUrl)) continue;
      seen.add(s.photoUrl);
      out.push(s.photoUrl);
    }
    return out;
  }, [selected, detail.data]);

  const header = (onBack: () => void) => (
    <View style={[styles.header, { paddingTop: insetTop + 8 }]}>
      <IconButton variant="ghost" label={t('back')} onPress={onBack}>
        <Feather name="chevron-left" size={22} color={colors.mutedForeground} />
      </IconButton>
      <Text style={[styles.title, { color: colors.foreground }]}>
        {t('pickerTitle')}
      </Text>
      <View style={{ width: 40 }} />
    </View>
  );

  const messageLine = message ? (
    <View style={[styles.message, { backgroundColor: colors.muted }]}>
      <Feather name="info" size={16} color={colors.foreground} />
      <Text style={[styles.messageText, { color: colors.foreground }]}>
        {t(message)}
      </Text>
    </View>
  ) : null;

  // ----- The side-by-side check (a deliberate second step, spec §3.2) -----
  if (selected) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {header(() => setSelected(null))}
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insetBottom + 32 },
          ]}
        >
          {messageLine}
          <View style={styles.compareRow}>
            <View style={styles.compareCol}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>
                {t('yourPhoto')}
              </Text>
              {yourPhoto}
            </View>
            <View style={styles.compareCol}>
              <Text
                style={[styles.label, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {selected.name}
              </Text>
              <Image
                source={photoSource(selected.photoUrl)}
                style={[styles.comparePhoto, { borderColor: colors.border }]}
                contentFit="cover"
              />
            </View>
          </View>
          {morePhotos.length > 0 ? (
            <View style={styles.moreRow}>
              {morePhotos.map((url) => (
                <Image
                  key={url}
                  source={photoSource(url)}
                  style={[styles.morePhoto, { borderColor: colors.border }]}
                  contentFit="cover"
                />
              ))}
            </View>
          ) : null}
          <View style={styles.selectedName}>
            <Text style={[styles.cardName, { color: colors.foreground }]}>
              {selected.name}
            </Text>
            <Text
              style={[
                styles.code,
                { color: colors.mutedForeground, backgroundColor: colors.muted },
              ]}
            >
              {catCode(selected.id)}
            </Text>
          </View>
          <Button
            variant="primary"
            size="lg"
            block
            disabled={busy}
            onPress={() => onPick(selected.id, pickedFromFor(query), filterIsOn(picked))}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              t('pickerConfirm')
            )}
          </Button>
        </ScrollView>
      </View>
    );
  }

  // One cat's card, the same in the matches and under Not known.
  const renderCard = (cat: Cat) => {
    // SYC-119 Slice D (data spine PR 4): a cat recorded as
    // deceased is greyed out, not hidden -- a spotter who really
    // is looking at that cat should understand why they can't
    // pick it, rather than wondering why it vanished from the
    // list. resolve refuses a hand pick of one with the same
    // refusal a too-far pick gets; a suggested match (never
    // offered through this picker) is the only way to clear it.
    const isDeceased = cat.lifeStatus === 'deceased';
    const appearance = appearanceLine(cat, t);
    return (
      <Pressable
        key={cat.id}
        testID={`picker-cat-${cat.id}`}
        disabled={isDeceased}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDeceased }}
        // SYC-2: a screen reader hears the colour and markings line
        // too, since the label replaces the card's own text.
        accessibilityLabel={[
          cat.name,
          catCode(cat.id),
          appearance,
          isDeceased ? t('pickerDeceased') : null,
        ]
          .filter(Boolean)
          .join(', ')}
        onPress={() => {
          if (isDeceased) return;
          setSelected(cat);
        }}
        style={({ pressed }) => [
          styles.card,
          {
            width: cardWidth,
            backgroundColor: colors.card,
            borderColor: colors.border,
            opacity: isDeceased ? 0.45 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <View style={[styles.cardPhotoBox, { backgroundColor: colors.muted }]}>
          {/* Offline, a photo the phone never loaded shows this
              placeholder: the name and number are still below. */}
          <Text style={styles.placeholder}>🐈</Text>
          <Image
            source={photoSource(cat.photoUrl)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        </View>
        <View style={styles.cardText}>
          <Text
            style={[styles.cardName, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {cat.name}
          </Text>
          {/* SYC-2 (spec §7.2): the same line as the cat page,
              so a spotter can compare. Not a filter. */}
          {appearance ? (
            <Text
              style={[styles.cardAppearance, { color: colors.mutedForeground }]}
              numberOfLines={3}
            >
              {appearance}
            </Text>
          ) : null}
          <Text style={[styles.cardCode, { color: colors.mutedForeground }]}>
            {catCode(cat.id)}
          </Text>
          {isDeceased ? (
            <Text
              style={[styles.cardDeceased, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {t('pickerDeceased')}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  // ----- Cats known around here -----
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {header(onClose)}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insetBottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.yourPhotoRow}>
          <View style={styles.yourPhotoSmall}>{yourPhoto}</View>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            {t('yourPhoto')}
          </Text>
        </View>

        {messageLine}

        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('pickerSearchPlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel={t('clear')}
              hitSlop={8}
            >
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>

        {/* SYC-398 PR D: the colour and pattern rows, under the search box (spec §5). */}
        <CoatChips picked={picked} onChange={setPicked} />

        {isOffline ? (
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {t('pickerOfflineStale')}
          </Text>
        ) : null}

        <Text style={[styles.heading, { color: colors.foreground }]}>
          {t('pickerListHeading')}
        </Text>

        {listed.length === 0 ? (
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {query.trim()
              ? t('pickerNoResults').replace('{text}', query.trim())
              : t('pickerEmpty')}
          </Text>
        ) : placed.matching.length + placed.notKnown.length === 0 && query.trim() ? (
          // The search found cats, but the chips hide them all (spec §5).
          <View style={styles.searchEmpty} testID="picker-search-empty">
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {t('pickerNoResultsFiltered').replace('{text}', query.trim())}
            </Text>
            <Button variant="ghost" size="sm" onPress={showAll}>
              {t('pickerSearchAll')}
            </Button>
          </View>
        ) : (
          <>
            {placed.matching.length > 0 ? (
              <View style={styles.grid} testID="picker-matching">
                {placed.matching.map(renderCard)}
              </View>
            ) : null}
            {placed.notKnown.length > 0 ? (
              <>
                <Text style={[styles.heading, { color: colors.foreground }]}>
                  {t('coatNotKnown')}
                </Text>
                <View style={styles.grid} testID="picker-not-known">
                  {placed.notKnown.map(renderCard)}
                </View>
              </>
            ) : null}
          </>
        )}

        {/* Directly above "Can't find it?" (spec §5): how many cats the
            chips hide, with one tap to show them all. */}
        {placed.hidden > 0 ? (
          <View
            style={styles.hiddenLine}
            testID="picker-hidden-line"
            // Read out when a chip changes the count.
            accessibilityLiveRegion="polite"
            aria-live="polite"
          >
            <Text style={[styles.hiddenText, { color: colors.foreground }]}>
              {placed.hidden === 1
                ? t('pickerHiddenOne')
                : t('pickerHiddenMany').replace('{n}', String(placed.hidden))}
            </Text>
            <Button variant="ghost" size="sm" onPress={showAll}>
              {t('pickerShowAll')}
            </Button>
          </View>
        ) : null}

        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Text style={[styles.footerLead, { color: colors.mutedForeground }]}>
            {t('pickerAddNewLead')}
          </Text>
          <Button variant="secondary" size="md" onPress={() => onAddNew(filterIsOn(picked))}>
            {t('pickerAddNewAction')}
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  title: { fontSize: fontSizes.lg, fontFamily: fonts.displayBold },
  content: {
    padding: CONTENT_PADDING,
    gap: 14,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  yourPhotoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  yourPhotoSmall: { width: 72, height: 72, borderRadius: radii.sm, overflow: 'hidden' },
  label: { fontSize: fontSizes['2xs'], fontFamily: fonts.bodySemiBold },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: spacing[3],
    borderRadius: radii.md,
  },
  messageText: { flex: 1, fontSize: fontSizes.sm, fontFamily: fonts.bodySemiBold },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: radii.pill,
    borderWidth: borderWidths.thin,
    paddingHorizontal: spacing[4],
    paddingVertical: Platform.OS === 'web' ? 10 : 9,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSizes.sm,
    fontFamily: fonts.body,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  note: { fontSize: fontSizes.xs, fontFamily: fonts.body },
  heading: { fontSize: fontSizes.md, fontFamily: fonts.bodyBold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  card: {
    borderRadius: radii.md,
    borderWidth: borderWidths.thin,
    overflow: 'hidden',
  },
  cardPhotoBox: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: { fontSize: 36, opacity: 0.4 },
  cardText: { padding: 10, gap: 2 },
  cardName: { fontSize: fontSizes.md, fontFamily: fonts.displayBold },
  cardCode: { fontSize: fontSizes['2xs'], fontFamily: fonts.mono },
  cardAppearance: { fontSize: fontSizes['2xs'], fontFamily: fonts.body },
  cardDeceased: {
    fontSize: fontSizes['3xs'],
    fontFamily: fonts.bodySemiBold,
    textTransform: 'uppercase',
  },
  compareRow: { flexDirection: 'row', gap: 12 },
  compareCol: { flex: 1, gap: 6 },
  comparePhoto: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  moreRow: { flexDirection: 'row', gap: 12 },
  morePhoto: {
    flex: 1,
    aspectRatio: 1.3,
    borderRadius: radii.sm,
    borderWidth: 1,
    maxWidth: 200,
  },
  selectedName: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  code: {
    fontSize: fontSizes['2xs'],
    fontFamily: fonts.mono,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.xs,
    overflow: 'hidden',
  },
  footer: {
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  footerLead: { fontSize: fontSizes.sm, fontFamily: fonts.body },
  searchEmpty: { gap: 4, alignItems: 'flex-start' },
  hiddenLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 4,
    marginTop: 4,
  },
  hiddenText: { fontSize: fontSizes.sm, fontFamily: fonts.bodySemiBold, textAlign: 'center' },
});
