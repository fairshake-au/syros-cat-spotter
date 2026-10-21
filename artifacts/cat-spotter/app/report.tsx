import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useReportQueue } from '@/context/ReportQueueContext';
import { useLocation } from '@/hooks/useLocation';
import { useWelfareGuidance } from '@/hooks/useWelfareGuidance';
import { useReporterEmailOn } from '@/hooks/useReporterEmailOn';
import { IconButton } from '@/components/purropolis';
import { ReportWizard } from '@/components/report/ReportWizard';
import { ReportConfirmation } from '@/components/report/ReportConfirmation';
import { takeReportHandoff } from '@/lib/reportHandoff';
import { catIdOf, reporterEmail, startFlow, type ReportFlow } from '@/lib/reportFlow';
import { confirmationState, newClientRef, type ReportLanguage } from '@/lib/reportQueue';
import { notify } from '@/lib/notify';
import { spacing } from '@/constants/theme';

/**
 * "This cat needs help" (spec §4; SYC-42 plan, Slice 1 item 1.9), as three
 * screens with no scrolling (Samuel, 2 Oct 2026): see ReportWizard. This
 * route wires it to the phone (location, photos), the report queue (saved
 * first, then sent) and the confirmation screen ("Sent" only once the
 * server has the report).
 *
 * From the Spot screen, with a photo and a place already, it opens on
 * screen 2; from a cat's page or the map, on screen 1.
 */

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

async function toPhoto(asset: ImagePicker.ImagePickerAsset): Promise<ReportFlow['photo']> {
  if (asset.base64 && asset.base64.length * 0.75 <= MAX_UPLOAD_BYTES) {
    return { uri: asset.uri, base64: asset.base64 };
  }
  const r = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1200 } }], {
    compress: 0.7,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  return { uri: r.uri, base64: r.base64 ?? '' };
}

export default function ReportScreen() {
  const colors = useColors();
  const { t, language } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const guidance = useWelfareGuidance();
  const { submitReport, sendDraft, reports, acceptedIds, syncing, retryFailed } = useReportQueue();
  const { coords, loading: locating, denied } = useLocation();

  const initial = useRef(startFlow(takeReportHandoff())).current;
  const clientRef = useRef(newClientRef()).current;
  const [sending, setSending] = useState(false);
  const [sentLocalId, setSentLocalId] = useState<string | null>(null);
  // SYC-180: whether the sent report carries a photo. A report saved without
  // its photo (storage full) says so too, even after it has left the queue.
  const [sentHasPhoto, setSentHasPhoto] = useState(true);
  // SYC-42 Slice 3: offer the email box only when the server can verify.
  const offerEmail = useReporterEmailOn();
  const [sentEmailGiven, setSentEmailGiven] = useState(false);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const choosePhoto = async (fromCamera: boolean) => {
    try {
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, base64: true });
      if (!result.canceled && result.assets[0]) return await toPhoto(result.assets[0]);
    } catch {
      notify(t('error'));
    }
    return null;
  };

  const send = async (flow: ReportFlow) => {
    if (!flow.coords || !flow.severity || sending) return;
    setSending(true);
    // What they chose on the email screen, even if the server's answer
    // changed after the screen was shown (review of #181, finding 7).
    const email = reporterEmail(flow);
    try {
      const localId = await submitReport({
        severity: flow.severity,
        isLitter: flow.isLitter,
        lat: flow.coords.latitude,
        lng: flow.coords.longitude,
        note: flow.note,
        language: language as ReportLanguage,
        clientRef,
        photo: flow.photo,
        email,
        catId: catIdOf(flow),
      });
      setSentHasPhoto(!!flow.photo);
      setSentEmailGiven(!!email);
      setSentLocalId(localId);
    } catch {
      notify(t('error'));
    } finally {
      setSending(false);
    }
  };

  const sentItem = sentLocalId ? reports.find((r) => r.localId === sentLocalId) : undefined;
  if (sentItem && !sentItem.hasPhoto && sentHasPhoto) setSentHasPhoto(false);

  const state = useMemo(
    () => (sentLocalId ? confirmationState(sentLocalId, reports, acceptedIds, syncing) : null),
    [sentLocalId, reports, acceptedIds, syncing],
  );

  if (state) {
    // After sending: the confirmation, which may scroll (it carries the vets).
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 6, borderColor: colors.border }]}>
          <IconButton variant="ghost" label={t('back')} onPress={close}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </IconButton>
        </View>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
          <View style={styles.column}>
            <ReportConfirmation
              state={state}
              guidance={guidance}
              hasPhoto={sentHasPhoto}
              emailGiven={sentEmailGiven}
              onDone={close}
              onRetry={() => void retryFailed()}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <ReportWizard
      guidance={guidance}
      initial={initial}
      gps={{ coords, locating, denied }}
      onChoosePhoto={choosePhoto}
      onDraft={(flow) => {
        if (!flow.coords || !flow.severity) return;
        sendDraft({
          clientRef,
          severity: flow.severity,
          lat: flow.coords.latitude,
          lng: flow.coords.longitude,
          isLitter: flow.isLitter,
          language: language as ReportLanguage,
          catId: catIdOf(flow),
        });
      }}
      onSend={send}
      onClose={close}
      sending={sending}
      offerEmail={offerEmail}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[4] },
  column: { width: '100%', maxWidth: 640, alignSelf: 'center' },
});
