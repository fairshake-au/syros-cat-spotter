import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
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
import { daysLeft, safeDonateUrl } from '@/lib/campaignDates';

/** Alert.alert is a no-op on RN web, so route through window.alert there. */
function notifyError(message: string) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(message);
  } else {
    Alert.alert(message);
  }
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

  // The server already rejects anything that isn't absolute https, but this
  // button is trusted UI: a tampered response must not be able to send someone
  // to an arbitrary scheme. Re-validate here and show where the button goes.
  const donateUrl = safeDonateUrl(campaign?.donateUrl);
  const canDonate = !!donateUrl;
  const donateHost = donateUrl ? new URL(donateUrl).host : null;

  const openDonate = async (amountCents: number | null) => {
    if (!donateUrl) return;
    // Built from the already-validated URL, so a parse failure is impossible
    // here and we never fall back to opening an unvalidated string.
    const parsed = new URL(donateUrl);
    if (amountCents != null) {
      // Presentational only — this pre-fills the external donation page's
      // amount field. No charge happens in-app.
      parsed.searchParams.set('amount', String(amountCents / 100));
    }
    const url = parsed.toString();
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) throw new Error('cannot open');
      await Linking.openURL(url);
    } catch {
      notifyError(t('error'));
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
            donateHost={donateHost}
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
  donateHost,
  selectedCents,
  onSelectAmount,
  onDonate,
}: {
  campaign: Campaign;
  insetsTop: number;
  remainingDays: number | null;
  canDonate: boolean;
  donateHost: string | null;
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
        {/* Centred by the wrapping View rather than textAlignVertical, which
            is Android-only and left the paw stuck to the top on iOS and web. */}
        <View style={styles.heroPawWrap} pointerEvents="none">
          <Text style={styles.heroPaw}>🐾</Text>
        </View>
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
            {!!donateHost && (
              <Text style={[styles.donateHost, { color: colors.mutedForeground }]}>
                {t('campaignOpensAt').replace('{host}', donateHost)}
              </Text>
            )}
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
  heroPawWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPaw: {
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

  donateHost: {
    fontFamily: fonts.body,
    fontSize: fontSizes['2xs'],
    textAlign: 'center',
    marginTop: spacing[2],
  },
  notOpenYet: {
    textAlign: 'center',
    fontFamily: fonts.bodySemiBold,
    fontSize: fontSizes.sm,
  },
});
