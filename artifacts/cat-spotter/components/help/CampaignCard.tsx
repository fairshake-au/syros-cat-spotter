import React, { useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { Campaign } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { Card } from '@/components/purropolis/Card';
import { Button } from '@/components/purropolis/Button';
import { ProgressBar } from '@/components/purropolis/ProgressBar';
import { Chip } from '@/components/purropolis/Chip';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { daysLeft, safeDonateUrl } from '@/lib/campaignDates';
import { notify } from '@/lib/notify';

function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    // Unknown/invalid currency code: fall back to a plain number so the
    // screen never throws over a server-config typo.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * State A of the Help & info giving section (spec §3.6): the in-app campaign,
 * as a plain card with no hero. Today's progress, stats, amount chips and the
 * Donate button. "Be the first to chip in!" belongs here and nowhere else.
 */
export function CampaignCard({ campaign }: { campaign: Campaign }) {
  const colors = useColors();
  const { t } = useLanguage();
  const [selectedCents, setSelectedCents] = useState<number | null>(null);
  const hasRaised = campaign.raisedCents > 0;
  const remainingDays = useMemo(() => daysLeft(campaign.endsAt), [campaign.endsAt]);

  // The server already rejects anything that isn't absolute https, but this
  // button is trusted UI: a tampered response must not be able to send someone
  // to an arbitrary scheme. Re-validate here and show where the button goes.
  const donateUrl = safeDonateUrl(campaign.donateUrl);
  const donateHost = donateUrl ? new URL(donateUrl).host : null;

  const openDonate = async (amountCents: number | null) => {
    if (!donateUrl) return;
    // Built from the already-validated URL, so a parse failure is impossible
    // here and we never fall back to opening an unvalidated string.
    const parsed = new URL(donateUrl);
    if (amountCents != null) {
      // Presentational only: this pre-fills the external donation page's
      // amount field. No charge happens in-app.
      parsed.searchParams.set('amount', String(amountCents / 100));
    }
    const url = parsed.toString();
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) throw new Error('cannot open');
      await Linking.openURL(url);
    } catch {
      notify(t('error'));
    }
  };

  if (!donateUrl) return null;

  return (
    <Card style={{ gap: spacing[3] }}>
      <Text role="heading" style={[styles.title, { color: colors.foreground }]}>
        {campaign.title}
      </Text>

      {hasRaised ? (
        <>
          <View style={styles.raisedRow}>
            <Text style={[styles.raisedValue, { color: colors.foreground }]}>
              {formatCents(campaign.raisedCents, campaign.currency)}
            </Text>
            <Text style={[styles.raisedGoal, { color: colors.mutedForeground }]}>
              {t('campaignOfGoal').replace('{goal}', formatCents(campaign.goalCents, campaign.currency))}
            </Text>
          </View>
          <ProgressBar value={campaign.raisedCents} max={Math.max(campaign.goalCents, 1)} tone="bougain" />
        </>
      ) : (
        <View style={{ gap: spacing[1] }}>
          <Text style={[styles.raisedValue, { color: colors.foreground }]}>{t('campaignBeFirst')}</Text>
          <Text style={[styles.raisedGoal, { color: colors.mutedForeground }]}>
            {t('campaignGoalOnly').replace('{goal}', formatCents(campaign.goalCents, campaign.currency))}
          </Text>
        </View>
      )}

      <View style={styles.statsRow}>
        <View style={styles.statCell}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{campaign.catsHelped}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t('campaignCatsHelped')}</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{campaign.donors}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t('campaignDonors')}</Text>
        </View>
        {remainingDays != null && (
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{remainingDays}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t('campaignDaysLeft')}</Text>
          </View>
        )}
      </View>

      {campaign.suggestedAmountsCents.length > 0 && (
        <View style={{ gap: spacing[2] }}>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{t('campaignChipIn')}</Text>
          <View style={styles.amountRow}>
            {campaign.suggestedAmountsCents.map((cents) => {
              const active = selectedCents === cents;
              return (
                <Chip
                  key={cents}
                  label={formatCents(cents, campaign.currency)}
                  active={active}
                  onPress={() => setSelectedCents(active ? null : cents)}
                  style={styles.amountChip}
                />
              );
            })}
          </View>
        </View>
      )}

      {!!campaign.blurb && (
        <View style={[styles.blurbBox, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.blurbText, { color: colors.secondaryForeground }]}>{campaign.blurb}</Text>
        </View>
      )}

      <Button variant="accent" size="lg" block onPress={() => void openDonate(selectedCents)}>
        {selectedCents != null
          ? t('campaignChipInAmount').replace('{amount}', formatCents(selectedCents, campaign.currency))
          : t('campaignDonateCta')}
      </Button>
      {!!donateHost && (
        <Text style={[styles.donateHost, { color: colors.mutedForeground }]}>
          {t('campaignOpensAt').replace('{host}', donateHost)}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.displayBold, fontSize: fontSizes.lg },
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
});
