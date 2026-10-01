import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useReportQueue } from '@/context/ReportQueueContext';
import { useLocation } from '@/hooks/useLocation';
import { useWelfareGuidance } from '@/hooks/useWelfareGuidance';
import { LocationPicker } from '@/components/LocationPicker';
import { Button, IconButton } from '@/components/purropolis';
import { UrgentAdvice } from '@/components/report/UrgentAdvice';
import { AttentionAdvice } from '@/components/report/AttentionAdvice';
import { LitterAdvice } from '@/components/report/LitterAdvice';
import { ReportConfirmation } from '@/components/report/ReportConfirmation';
import { takeReportHandoff } from '@/lib/reportHandoff';
import {
  confirmationState,
  newClientRef,
  type ReportLanguage,
  type ReportSeverity,
} from '@/lib/reportQueue';
import { notify } from '@/lib/notify';
import { fonts, radii, spacing } from '@/constants/theme';

/**
 * "This cat needs help" (spec §4; SYC-42 plan, Slice 1 item 1.9).
 *
 * In the spec's order: photo → where → how bad → the advice for that choice
 * → kittens? → what you saw → Send. The advice is guidance BEFORE the report,
 * never instead of it: nothing on this screen blocks sending (spec §5.2).
 * A draft goes to the server once severity and location are both set (§4.2),
 * so an abandoned report still tells Syros Cats somebody saw a cat there.
 */

const HOWTO_SEEN_KEY = 'cat-spotter/report-howto-seen';
// Ermoupoli: where the map starts if the phone can't (or won't) say where it is.
const FALLBACK = { latitude: 37.4449, longitude: 24.9427 };
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

type Photo = { uri: string; base64: string };

async function toPhoto(asset: ImagePicker.ImagePickerAsset): Promise<Photo> {
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
  const { submitReport, sendDraft, reports, acceptedIds, syncing } = useReportQueue();
  const { coords, loading: locating, denied } = useLocation();

  const handoff = useRef(takeReportHandoff()).current;
  const clientRef = useRef(newClientRef()).current;
  const [photo, setPhoto] = useState<Photo | null>(handoff?.photo ?? null);
  const [picked, setPicked] = useState<{ latitude: number; longitude: number } | null>(
    handoff?.coords ?? null,
  );
  const [severity, setSeverity] = useState<ReportSeverity | null>(null);
  const [isLitter, setIsLitter] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sentLocalId, setSentLocalId] = useState<string | null>(null);
  const [howToFirstUse, setHowToFirstUse] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(HOWTO_SEEN_KEY)
      .then((v) => setHowToFirstUse(v !== '1'))
      .catch(() => setHowToFirstUse(true));
  }, []);

  // Where: the phone's fix, or Ermoupoli if there isn't one, then the person moves the pin.
  useEffect(() => {
    if (picked) return;
    if (coords) setPicked({ latitude: coords.latitude, longitude: coords.longitude });
    else if (!locating || denied) setPicked(FALLBACK);
  }, [coords, locating, denied, picked]);

  // Urgent advice seen once: the how-to starts collapsed next time (§5.2).
  useEffect(() => {
    if (severity === 'urgent') AsyncStorage.setItem(HOWTO_SEEN_KEY, '1').catch(() => undefined);
  }, [severity]);

  // §4.2: the draft, once severity and location are both set. Best effort.
  const draftKey = picked && severity ? `${severity}:${picked.latitude.toFixed(5)},${picked.longitude.toFixed(5)}:${isLitter}` : null;
  useEffect(() => {
    if (!draftKey || !picked || !severity || sentLocalId) return;
    const timer = setTimeout(
      () =>
        sendDraft({
          clientRef,
          severity,
          lat: picked.latitude,
          lng: picked.longitude,
          isLitter,
          language: language as ReportLanguage,
        }),
      800,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const choosePhoto = async (fromCamera: boolean) => {
    try {
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, base64: true });
      if (!result.canceled && result.assets[0]) setPhoto(await toPhoto(result.assets[0]));
    } catch {
      notify(t('error'));
    }
  };

  const send = async () => {
    if (!picked || !severity || sending) return;
    setSending(true);
    try {
      const localId = await submitReport({
        severity,
        isLitter,
        lat: picked.latitude,
        lng: picked.longitude,
        note,
        language: language as ReportLanguage,
        clientRef,
        photo,
      });
      setSentLocalId(localId);
    } catch {
      notify(t('error'));
    } finally {
      setSending(false);
    }
  };

  const state = useMemo(
    () => (sentLocalId ? confirmationState(sentLocalId, reports, acceptedIds, syncing) : null),
    [sentLocalId, reports, acceptedIds, syncing],
  );

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderColor: colors.border }]}>
        <IconButton variant="ghost" label={t('back') ?? 'Back'} onPress={close}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </IconButton>
        <Text role="heading" style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {t('reportNeedsHelp')}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.column}>
          {state ? (
            <ReportConfirmation state={state} guidance={guidance} onDone={close} />
          ) : (
            <>
              {/* 1. A photo */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('reportPhotoTitle')}</Text>
                {photo ? (
                  <View style={styles.photoRow}>
                    <Image
                      source={{
                        uri: photo.uri.startsWith('blob:')
                          ? `data:image/jpeg;base64,${photo.base64}`
                          : photo.uri,
                      }}
                      style={styles.photo}
                      contentFit="cover"
                    />
                    <Pressable onPress={() => setPhoto(null)} hitSlop={8} accessibilityRole="button">
                      <Text style={[styles.linkText, { color: colors.mutedForeground }]}>{t('reportRemovePhoto')}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Text style={[styles.hint, { color: colors.mutedForeground }]}>{t('reportPhotoHint')}</Text>
                    <View style={styles.photoButtons}>
                      <Button variant="secondary" size="md" onPress={() => void choosePhoto(true)}
                        iconLeft={<Feather name="camera" size={16} color={colors.foreground} />}>
                        {t('takePhoto')}
                      </Button>
                      <Button variant="ghost" size="md" onPress={() => void choosePhoto(false)}>
                        {t('chooseFromLibrary')}
                      </Button>
                    </View>
                  </>
                )}
              </View>

              {/* 2. Where */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('reportWhereTitle')}</Text>
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>{t('reportWhereHint')}</Text>
                {picked ? (
                  <LocationPicker
                    latitude={picked.latitude}
                    longitude={picked.longitude}
                    onChange={setPicked}
                    pinColor={colors.accent}
                    style={styles.map}
                  />
                ) : (
                  <View style={[styles.map, styles.mapLoading, { borderColor: colors.border }]}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={[styles.hint, { color: colors.mutedForeground }]}>{t('reportWaitingLocation')}</Text>
                  </View>
                )}
              </View>

              {/* 3. How bad */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('reportHowBadTitle')}</Text>
                {(['attention', 'urgent'] as const).map((s) => {
                  const selected = severity === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => setSeverity(s)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      testID={`severity-${s}`}
                      style={[
                        styles.choice,
                        {
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.card : 'transparent',
                          borderWidth: selected ? 2 : 1,
                        },
                      ]}
                    >
                      <Feather
                        name={selected ? 'check-circle' : 'circle'}
                        size={20}
                        color={selected ? colors.primary : colors.mutedForeground}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.choiceTitle, { color: colors.foreground }]}>
                          {t(s === 'urgent' ? 'reportSeverityUrgent' : 'reportSeverityAttention')}
                        </Text>
                        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                          {t(s === 'urgent' ? 'reportSeverityUrgentHint' : 'reportSeverityAttentionHint')}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {/* 4. The advice for that choice: guidance before the report, never instead of it */}
              {severity === 'urgent' && howToFirstUse !== null && (
                <UrgentAdvice guidance={guidance} firstUse={howToFirstUse} />
              )}
              {severity === 'attention' && <AttentionAdvice guidance={guidance} />}

              {/* 5. Kittens? */}
              <Pressable
                onPress={() => setIsLitter((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isLitter }}
                testID="litter-checkbox"
                style={styles.checkRow}
              >
                <Feather name={isLitter ? 'check-square' : 'square'} size={22} color={colors.primary} />
                <Text style={[styles.checkLabel, { color: colors.foreground }]}>{t('reportLitter')}</Text>
              </Pressable>
              {isLitter && <LitterAdvice guidance={guidance} />}

              {/* 6. What you saw (optional, no counter, no format) */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('reportNoteTitle')}</Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  multiline
                  placeholder={t('reportNotePlaceholder')}
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.note, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
                  testID="report-note"
                />
              </View>

              <Button
                variant="primary"
                size="lg"
                block
                disabled={!picked || !severity || sending}
                onPress={() => void send()}
                iconLeft={sending ? <ActivityIndicator color={colors.primaryForeground} size="small" /> : undefined}
              >
                {t('reportSend')}
              </Button>
            </>
          )}
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
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontFamily: fonts.displayBold, fontSize: 18, flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[4] },
  column: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: spacing[5] },
  section: { gap: spacing[2] },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: 16 },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  linkText: { fontFamily: fonts.bodySemiBold, fontSize: 14, textDecorationLine: 'underline' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  photo: { width: 96, height: 96, borderRadius: radii.md },
  photoButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  map: { height: 240, borderRadius: radii.md, overflow: 'hidden' },
  mapLoading: { borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
  choice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radii.md,
    minHeight: 56,
  },
  choiceTitle: { fontFamily: fonts.bodyBold, fontSize: 16 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], minHeight: 44 },
  checkLabel: { fontFamily: fonts.body, fontSize: 15, flex: 1 },
  note: {
    borderWidth: 1,
    borderRadius: radii.md,
    minHeight: 96,
    padding: spacing[3],
    fontFamily: fonts.body,
    fontSize: 15,
    textAlignVertical: 'top',
  },
});
