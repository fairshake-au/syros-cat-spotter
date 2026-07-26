import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useGetCampaign,
  getGetCampaignQueryKey,
  type Campaign,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useOffline } from '@/context/OfflineContext';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Card } from '@/components/purropolis/Card';
import { Button } from '@/components/purropolis/Button';
import { ProgressBar } from '@/components/purropolis/ProgressBar';
import { Chip } from '@/components/purropolis/Chip';
import { fonts, fontSizes, radii, spacing, shadows } from '@/constants/theme';

/**
 * Days remaining until `endsAt` (an ISO date). Never negative — a campaign
 * that has already ended reads as 0 days left rather than a negative number.
 */
function daysLeft(endsAt: string): number | null {
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    // Unknown/invalid currency code — fall back to a plain number so the
    // screen never throws over a server-config typo.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export default function HelpScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { isOnline } = useOffline();
  const [selectedCents, setSelectedCents] = useState<number | null>(null);

  const campaignQuery = useGetCampaign({
    query: { enabled: isOnline, queryKey: getGetCampaignQueryKey() },
  });
  const campaign = campaignQuery.data;

  const remainingDays = useMemo(
    () => (campaign ? daysLeft(campaign.endsAt) : null),
    [campaign],
  );

  const canDonate = !!campaign?.donateUrl;

  const openDonate = async (amountCents: number | null) => {
    if (!campaign?.donateUrl) return;
    let url = campaign.donateUrl;
    // Presentational only — this just pre-fills the external donation
    // page's amount field via a query param. No charge happens in-app.
    if (amountCents != null) {
      try {
        const parsed = new URL(url);
        parsed.searchParams.set('amount', String(amountCents / 100));
        url = parsed.toString();
      } catch {
        // donateUrl wasn't a parseable absolute URL — open it verbatim.
      }
    }
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) throw new Error('cannot open');
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('error'));
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + (Platform.OS === 'web' ? 110 : 100),
        }}
      >
        {!isOnline ? (
          <View style={{ padding: spacing[4] }}>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {t('campaignOffline')}
            </Text>
          </View>
        ) : campaignQuery.isLoading ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : campaignQuery.isError || !campaign ? (
          <View style={styles.centerBlock}>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {t('campaignError')}
            </Text>
          </View>
        ) : (
          <CampaignContent
            campaign={campaign}
            insetsTop={insets.top}
            remainingDays={remainingDays}
            canDonate={canDonate}
            selectedCents={selectedCents}
            onSelectAmount={setSelectedCents}
            onDonate={openDonate}
          />
        )}
      </ScrollView>
    </View>
  );
}

function CampaignContent({
  campaign,
  insetsTop,
  remainingDays,
  canDonate,
  selectedCents,
  onSelectAmount,
  onDonate,
}: {
  campaign: Campaign;
  insetsTop: number;
  remainingDays: number | null;
  canDonate: boolean;
  selectedCents: number | null;
  onSelectAmount: (cents: number | null) => void;
  onDonate: (amountCents: number | null) => void;
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const hasRaised = campaign.raisedCents > 0;

  return (
    <>
      <View style={[styles.hero, { paddingTop: insetsTop + spacing[7] }]}>
        <LinearGradient
          colors={['#e8558a', '#e07856']}
          style={StyleSheet.absoluteFillObject}
        />
        <Text style={styles.heroPaw}>🐾</Text>
        <View style={styles.heroTextWrap}>
          <Text style={styles.heroEyebrow}>{t('campaignEyebrow')}</Text>
          <Text style={styles.heroTitle}>{campaign.title}</Text>
        </View>
      </View>

      <View style={{ padding: spacing[4], gap: spacing[4] }}>
        <Card style={{ gap: spacing[3] }}>
          {hasRaised ? (
            <>
              <View style={styles.raisedRow}>
                <Text style={[styles.raisedValue, { color: colors.foreground }]}>
                  {formatCents(campaign.raisedCents, campaign.currency)}
                </Text>
                <Text style={[styles.raisedGoal, { color: colors.mutedForeground }]}>
                  {t('campaignOfGoal').replace(
                    '{goal}',
                    formatCents(campaign.goalCents, campaign.currency),
                  )}
                </Text>
              </View>
              <ProgressBar
                value={campaign.raisedCents}
                max={Math.max(campaign.goalCents, 1)}
                tone="bougain"
              />
            </>
          ) : (
            <View style={{ gap: spacing[1] }}>
              <Text style={[styles.raisedValue, { color: colors.foreground }]}>
                {t('campaignBeFirst')}
              </Text>
              <Text style={[styles.raisedGoal, { color: colors.mutedForeground }]}>
                {t('campaignGoalOnly').replace(
                  '{goal}',
                  formatCents(campaign.goalCents, campaign.currency),
                )}
              </Text>
            </View>
          )}

          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {campaign.catsHelped}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                {t('campaignCatsHelped')}
              </Text>
            </View>
            <View style={styles.statCell}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {campaign.donors}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                {t('campaignDonors')}
              </Text>
            </View>
            {remainingDays != null && (
              <View style={styles.statCell}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>
                  {remainingDays}
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                  {t('campaignDaysLeft')}
                </Text>
              </View>
            )}
          </View>
        </Card>

        {canDonate ? (
          <>
            {campaign.suggestedAmountsCents.length > 0 && (
              <View style={{ gap: spacing[2] }}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                  {t('campaignChipIn')}
                </Text>
                <View style={styles.amountRow}>
                  {campaign.suggestedAmountsCents.map((cents) => {
                    const active = selectedCents === cents;
                    return (
                      <Chip
                        key={cents}
                        label={formatCents(cents, campaign.currency)}
                        active={active}
                        onPress={() => onSelectAmount(active ? null : cents)}
                        style={styles.amountChip}
                      />
                    );
                  })}
                </View>
              </View>
            )}

            {!!campaign.blurb && (
              <View
                style={[styles.blurbBox, { backgroundColor: colors.secondary }]}
              >
                <Text style={[styles.blurbText, { color: colors.secondaryForeground }]}>
                  {campaign.blurb}
                </Text>
              </View>
            )}

            <Button
              variant="accent"
              size="lg"
              block
              onPress={() => onDonate(selectedCents)}
            >
              {selectedCents != null
                ? t('campaignChipInAmount').replace(
                    '{amount}',
                    formatCents(selectedCents, campaign.currency),
                  )
                : t('campaignDonateCta')}
            </Button>
          </>
        ) : (
          <>
            {!!campaign.blurb && (
              <View
                style={[styles.blurbBox, { backgroundColor: colors.secondary }]}
              >
                <Text style={[styles.blurbText, { color: colors.secondaryForeground }]}>
                  {campaign.blurb}
                </Text>
              </View>
            )}
            <Text style={[styles.notOpenYet, { color: colors.mutedForeground }]}>
              {t('campaignNotOpenYet')}
            </Text>
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  subtitle: { fontSize: fontSizes.xs, fontFamily: fonts.body },
  centerBlock: { padding: spacing[6], alignItems: 'center' },

  hero: {
    minHeight: 170,
    justifyContent: 'flex-end',
    padding: spacing[4],
    overflow: 'hidden',
  },
  heroPaw: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 90,
    opacity: 0.9,
  },
  heroTextWrap: { gap: spacing[1] },
  heroEyebrow: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: fontSizes['3xs'],
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.9)',
  },
  heroTitle: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.xl,
    color: '#fff',
    lineHeight: fontSizes.xl * 1.1,
  },

  raisedRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] },
  raisedValue: { fontFamily: fonts.displayBold, fontSize: fontSizes['2xl'] },
  raisedGoal: { fontFamily: fonts.body, fontSize: fontSizes.sm },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statCell: { gap: spacing[1] },
  statValue: { fontFamily: fonts.displayBold, fontSize: fontSizes.lg },
  statLabel: { fontFamily: fonts.body, fontSize: fontSizes['2xs'] },

  fieldLabel: {
    fontSize: fontSizes['2xs'],
    fontFamily: fonts.bodyBold,
    textTransform: 'uppercase',
  },
  amountRow: { flexDirection: 'row', gap: spacing[2] },
  amountChip: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  blurbBox: { borderRadius: radii.md, padding: spacing[3] },
  blurbText: { fontFamily: fonts.body, fontSize: fontSizes.xs, lineHeight: fontSizes.xs * 1.5 },

  notOpenYet: {
    textAlign: 'center',
    fontFamily: fonts.bodySemiBold,
    fontSize: fontSizes.sm,
  },
});
