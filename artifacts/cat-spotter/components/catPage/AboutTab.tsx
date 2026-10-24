import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { OwnershipBanner } from '@/components/OwnershipBanner';
import { MoreToAdd } from '@/components/MoreToAdd';
import { ReportIssueLink } from '@/components/report/ReportIssueLink';
import { Button } from '@/components/purropolis';
import { QuestionCards } from '@/components/catPage/QuestionCards';
import { useQuietColor } from '@/hooks/useQuietColor';
import type { CatTab } from '@/components/catPage/CatTabBar';
import { formatInstant, formatPublicDate } from '@/lib/catPageDates';
import type { HomeAction } from '@/lib/catPageFacts';
import { fonts, fontSizes, radii } from '@/constants/theme';
import { catDisplayName } from '@/lib/catDisplayName';

export type UpdateBanner = {
  updateType?: string | null;
  createdAt: string;
  message: string;
};

type FactRow = { key: string; icon: React.ComponentProps<typeof Feather>['name']; bold: string; quiet?: string | null };

/** The tinted round icon beside a facts-card row. */
function FactIcon({ name }: { name: FactRow['icon'] }) {
  const colors = useColors();
  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.factIcon, { backgroundColor: colors.secondary }]}
    >
      <Feather name={name} size={15} color={colors.primary} />
    </View>
  );
}

/**
 * 🐱 About (SYC-624 spec §3): edit, the notification banner, the facts card,
 * the main button, the two soft cards, "You spotted…", "Has a home", and the
 * quiet report link last.
 */
export function AboutTab({
  cat,
  isOwner,
  onEdit,
  update,
  onSeeTab,
  storyAvailable,
  lifeLineText,
  sterilisedLine,
  seenQuiet,
  appearance,
  canSpot,
  onSpot,
  homeAction,
  claimDisabled,
  onHome,
  homeCardRef,
  offline,
  onReport,
}: {
  cat: {
    id: number;
    name: string;
    photoUrl: string | null;
    lastSeenAt: string;
    description?: string | null;
    hasHome: boolean;
    ownerName?: string | null;
    homeDescription?: string | null;
  };
  isOwner: boolean;
  onEdit: () => void;
  update?: UpdateBanner;
  onSeeTab: (tab: CatTab) => void;
  storyAvailable: boolean;
  lifeLineText: string;
  sterilisedLine: string;
  seenQuiet: string | null;
  /** The appearance line (colour and markings), or null. */
  appearance: string | null;
  canSpot: boolean;
  onSpot: () => void;
  homeAction: HomeAction;
  claimDisabled: boolean;
  onHome: () => void;
  homeCardRef: React.Ref<View>;
  offline: boolean;
  onReport: () => void;
}) {
  const colors = useColors();
  const quiet = useQuietColor();
  const { t, language } = useLanguage();
  const shownName = catDisplayName(cat, t);
  const place = cat.description?.trim() || null;
  const whereBold = place ?? appearance;
  const whereQuiet = place ? appearance : null;

  const rows: FactRow[] = [
    { key: 'home', icon: 'heart', bold: lifeLineText },
    { key: 'sterilised', icon: 'check-circle', bold: sterilisedLine },
    {
      key: 'seen',
      icon: 'eye',
      bold: `${t('lastSeen')} ${formatPublicDate(cat.lastSeenAt, language)}`.trim(),
      quiet: seenQuiet,
    },
  ];
  if (whereBold) rows.push({ key: 'where', icon: 'map-pin', bold: whereBold, quiet: whereQuiet });

  const bannerTarget: CatTab | null = update
    ? update.updateType === 'sighting'
      ? 'photos'
      : storyAvailable
        ? 'story'
        : null
    : null;

  return (
    <View style={styles.stack}>
      {isOwner && (
        <Pressable
          onPress={onEdit}
          testID="edit-cat-button"
          hitSlop={8}
          style={[styles.editBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <Feather name="edit-2" size={13} color={colors.primary} />
          <Text style={[styles.editText, { color: colors.primary }]}>{t('editCat')}</Text>
        </Pressable>
      )}

      {update && (
        <View
          testID="update-banner"
          style={[styles.updateBanner, { backgroundColor: colors.card, borderColor: colors.primary }]}
        >
          <Feather
            name={
              update.updateType === 'adopted'
                ? 'home'
                : update.updateType === 'desexed'
                  ? 'heart'
                  : update.updateType === 'sighting'
                    ? 'eye'
                    : 'bell'
            }
            size={18}
            color={colors.primary}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.updateLabel, { color: colors.primary }]}>
              {t('catUpdateBanner')} · {formatInstant(update.createdAt, language)}
            </Text>
            <Text style={[styles.updateMessage, { color: colors.foreground }]}>{update.message}</Text>
            {bannerTarget && (
              <Pressable
                role="link"
                accessibilityRole="link"
                testID="update-banner-link"
                hitSlop={8}
                onPress={() => onSeeTab(bannerTarget)}
                style={styles.bannerLink}
              >
                <Text style={[styles.bannerLinkText, { color: colors.primary }]}>
                  {bannerTarget === 'photos'
                    ? t('catBannerSeePhotos')
                    : t('catBannerSeeStory').split('{name}').join(shownName)}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      <View style={[styles.factsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {rows.map((row, i) => (
          <View
            key={row.key}
            testID={`fact-${row.key}`}
            style={[
              styles.factRow,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
            ]}
          >
            <FactIcon name={row.icon} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.factBold, { color: colors.foreground }]}>{row.bold}</Text>
              {row.quiet ? <Text style={[styles.factQuiet, { color: quiet }]}>{row.quiet}</Text> : null}
            </View>
          </View>
        ))}
      </View>

      {canSpot ? (
        <Button
          variant="primary"
          size="lg"
          block
          wrapLabel
          testID="spotted-cat-button"
          iconLeft={<Feather name="camera" size={18} color={colors.primaryForeground} aria-hidden />}
          onPress={onSpot}
        >
          {t('spottedCatButton').split('{name}').join(shownName)}
        </Button>
      ) : null}

      <QuestionCards
        cat={{ id: cat.id, name: shownName, photoUrl: cat.photoUrl }}
        homeAction={homeAction}
        claimDisabled={claimDisabled}
        onHome={onHome}
        homeCardRef={homeCardRef}
      />
      {homeAction === 'claim' && offline && (
        <Text style={[styles.offlineLine, { color: quiet }]}>{t('claimNeedsConnection')}</Text>
      )}

      {/* SYC-117 part 2: "You spotted Agatha on 3 October. Anything to add?" */}
      <MoreToAdd catId={cat.id} catName={shownName} />

      {/* The facts card already says "Has a home"; the banner only adds the owner's name or the home's description (the owner's view). */}
      {cat.hasHome && (cat.ownerName || cat.homeDescription) && (
        <OwnershipBanner ownerName={cat.ownerName} homeDescription={cat.homeDescription} />
      )}

      <ReportIssueLink onPress={onReport} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
  },
  editText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  updateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
  },
  updateLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase' },
  updateMessage: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  bannerLink: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  bannerLinkText: { fontSize: 13, fontFamily: fonts.bodySemiBold, textDecorationLine: 'underline' },
  factsCard: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  factIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  factBold: { fontSize: fontSizes.sm, fontFamily: fonts.bodyBold },
  factQuiet: { fontSize: 13, fontFamily: fonts.body, marginTop: 1 },
  offlineLine: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },
});
