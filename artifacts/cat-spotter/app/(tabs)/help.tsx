import React, { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetCampaign, getGetCampaignQueryKey } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useWelfareGuidance } from '@/hooks/useWelfareGuidance';
import { useLanguage } from '@/context/LanguageContext';
import { useOffline } from '@/context/OfflineContext';
import { useAppSettings } from '@/context/AppSettingsContext';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Card } from '@/components/purropolis/Card';
import { Button } from '@/components/purropolis/Button';
import { Fold } from '@/components/report/Fold';
import { VetList } from '@/components/report/VetList';
import { CampaignCard } from '@/components/help/CampaignCard';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { CONTACT_EMAIL, contactMailto } from '@/lib/contactMail';
import { givingState } from '@/lib/helpGiving';
import { notify } from '@/lib/notify';
import { useBannerAreaReserve } from '@/lib/bannerArea';
import { apiOrigin } from '@/lib/urls';
import type { Language } from '@/lib/i18n';

const PRIVACY_URL = 'https://catspotters.com/privacy';

/**
 * Help & info (SYC-120; docs/specs/help-and-info.md §3). One scrolling page,
 * in the order a visitor needs it: a hurt cat, the vets, how the app works,
 * contact, privacy, and last (by design) giving.
 */
export default function HelpScreen() {
  const colors = useColors();
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const bannerReserve = useBannerAreaReserve();
  const router = useRouter();
  const { isOnline } = useOffline();
  const { donateHost } = useAppSettings();
  const guidance = useWelfareGuidance();
  const [mailFailed, setMailFailed] = useState(false);

  const campaignQuery = useGetCampaign({
    query: { enabled: isOnline, queryKey: getGetCampaignQueryKey() },
  });
  const giving = givingState({
    online: isOnline,
    campaign: campaignQuery.data,
    campaignStatus: campaignQuery.isError ? 'error' : campaignQuery.data ? 'success' : 'pending',
    donateHost,
  });

  const heading = [styles.heading, { color: colors.foreground }];
  const body = [styles.body, { color: colors.foreground }];
  const muted = [styles.muted, { color: colors.mutedForeground }];

  const emailUs = () => {
    setMailFailed(false);
    const version = Constants.expoConfig?.version ?? '';
    Linking.openURL(contactMailto(language as Language, version, Platform.OS)).catch(() =>
      setMailFailed(true),
    );
  };

  const openPrivacy = () => {
    Linking.openURL(PRIVACY_URL).catch(() => notify(t('error')));
  };

  const openGive = () => {
    Linking.openURL(`${apiOrigin()}/api/go/give`).catch(() => notify(t('error')));
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + bannerReserve + spacing[4],
          paddingHorizontal: spacing[4],
          paddingBottom: insets.bottom + (Platform.OS === 'web' ? 110 : 100),
          gap: spacing[6],
        }}
      >
        <Text role="heading" style={[styles.title, { color: colors.foreground }]}>
          {t('helpInfoTitle')}
        </Text>

        {/* 3.1 A cat needs help */}
        <View
          testID="help-urgent-card"
          style={[styles.urgentCard, { borderColor: colors.primary, backgroundColor: colors.card }]}
        >
          <Text role="heading" style={heading}>
            {t('helpCatHeading')}
          </Text>
          <Button
            variant="primary"
            size="lg"
            block
            wrapLabel
            accessibilityLabel={t('helpCatButton')}
            onPress={() => router.push('/report')}
          >
            {t('helpCatButton')}
          </Button>
        </View>

        {/* 3.2 Vets */}
        <View style={styles.section} testID="help-vets">
          <Text role="heading" style={heading}>
            {t('helpVetsHeading')}
          </Text>
          <VetList guidance={guidance} />
        </View>

        {/* 3.3 How the app works */}
        <View style={styles.section} testID="help-how">
          <Text role="heading" style={heading}>
            {t('helpHowHeading')}
          </Text>
          <Fold title={t('helpHowSpotting')} icon="camera" tone="plain">
            {(['Spot', 'DontFeed', 'Catalog', 'Help'] as const).map((step) => (
              <View key={step} style={{ gap: 2 }}>
                <Text style={[styles.stepTitle, { color: colors.foreground }]}>{t(`howStep${step}`)}</Text>
                <Text style={body}>{t(`howStep${step}Body`)}</Text>
              </View>
            ))}
          </Fold>
          <Fold title={t('howSafetyTitle')} icon="eye" tone="plain">
            <Text style={body}>{t('howSafetyLiveHere')}</Text>
            <Text style={body}>{t('howSafetyDistance')}</Text>
            <Text style={body}>{t('howSafetyLeaveBe')}</Text>
            <Text style={body}>{t('howSafetyHurt')}</Text>
          </Fold>
        </View>

        {/* 3.4 Contact us */}
        <View style={styles.section} testID="help-contact">
          <Text role="heading" style={heading}>
            {t('helpContactHeading')}
          </Text>
          <Text style={body}>{t('helpContactBody')}</Text>
          <Button
            variant="secondary"
            size="lg"
            block
            accessibilityLabel={t('helpContactButton')}
            iconLeft={<Feather name="mail" size={18} color={colors.foreground} />}
            onPress={emailUs}
          >
            {t('helpContactButton')}
          </Button>
          <Text selectable style={[styles.address, { color: colors.foreground }]}>
            {CONTACT_EMAIL}
          </Text>
          {mailFailed && (
            <Text role="alert" style={[styles.muted, { color: colors.destructive }]}>
              {t('helpContactFailed')}
            </Text>
          )}
        </View>

        {/* 3.5 Privacy */}
        <View style={styles.section} testID="help-privacy">
          <Text role="heading" style={heading}>
            {t('helpPrivacyHeading')}
          </Text>
          <Text style={body}>{t('helpPrivacyBody')}</Text>
          {isOnline ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t('helpPrivacyPolicy')}
              onPress={openPrivacy}
              hitSlop={8}
              style={styles.linkRow}
            >
              <Text style={[styles.link, { color: colors.primary }]}>{t('helpPrivacyPolicy')}</Text>
            </Pressable>
          ) : (
            <View style={styles.linkRow}>
              <Text style={muted}>{t('helpPrivacyPolicy')}</Text>
              <Text testID="help-privacy-offline" style={muted}>
                {t('helpNeedsInternet')}
              </Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('deleteMyDataRow')}
            onPress={() => router.push('/delete-my-data')}
            hitSlop={8}
            style={styles.linkRow}
          >
            <Text style={[styles.link, { color: colors.primary }]}>{t('deleteMyDataRow')}</Text>
          </Pressable>
        </View>

        {/* 3.6 Giving: last by design; nothing at all in state C. */}
        {giving === 'campaign' && campaignQuery.data && (
          <View style={styles.section} testID="help-giving-campaign">
            <CampaignCard campaign={campaignQuery.data} />
          </View>
        )}
        {giving === 'link' && donateHost && (
          <View style={styles.section} testID="help-giving-link">
            <Card style={{ gap: spacing[3] }}>
              <Text role="heading" style={heading}>
                {t('helpGiveHeading')}
              </Text>
              <Text style={body}>{t('helpGiveBody')}</Text>
              {isOnline ? (
                <>
                  <Button
                    variant="accent"
                    size="lg"
                    block
                    wrapLabel
                    accessibilityLabel={t('helpGiveButton').replace('{host}', donateHost)}
                    onPress={openGive}
                  >
                    {t('helpGiveButton').replace('{host}', donateHost)}
                  </Button>
                  <Text style={[styles.hostNote, { color: colors.mutedForeground }]}>
                    {t('campaignOpensAt').replace('{host}', donateHost)}
                  </Text>
                </>
              ) : (
                <Text testID="help-giving-offline" style={muted}>
                  {t('helpNeedsInternet')}
                </Text>
              )}
            </Card>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontFamily: fonts.displayBold, fontSize: fontSizes.xl },
  section: { gap: spacing[3] },
  heading: { fontFamily: fonts.displayBold, fontSize: fontSizes.lg },
  body: { fontFamily: fonts.body, fontSize: fontSizes.sm, lineHeight: fontSizes.sm * 1.45 },
  stepTitle: { fontFamily: fonts.bodyBold, fontSize: fontSizes.sm },
  muted: { fontFamily: fonts.body, fontSize: fontSizes.xs },
  address: { fontFamily: fonts.bodySemiBold, fontSize: fontSizes.sm, textAlign: 'center' },
  link: { fontFamily: fonts.bodySemiBold, fontSize: fontSizes.sm, textDecorationLine: 'underline' },
  linkRow: { minHeight: 44, justifyContent: 'center', gap: 2 },
  hostNote: { fontFamily: fonts.body, fontSize: fontSizes['2xs'], textAlign: 'center' },
  urgentCard: {
    borderWidth: 1.5,
    borderRadius: radii.md,
    padding: spacing[4],
    gap: spacing[3],
  },
});
