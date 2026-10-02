import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WelfareGuidance } from '@workspace/welfare-guidance';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { LocationPicker } from '@/components/LocationPicker';
import { Button, IconButton } from '@/components/purropolis';
import { fonts, radii, spacing } from '@/constants/theme';
import {
  canAdvance,
  draftReady,
  flowBack,
  flowNext,
  type ReportFlow,
} from '@/lib/reportFlow';
import { UrgentAdvice } from './UrgentAdvice';
import { AttentionAdvice } from './AttentionAdvice';
import { LitterAdvice } from './LitterAdvice';

/**
 * "This cat needs help", as three screens (Samuel, 2 Oct 2026: no scrolling).
 *
 *   1 of 3  Where's the cat?   photo (optional) and the map pin   [Next]
 *   2 of 3  How bad is it?     severity, kittens?, what you saw   [Next]
 *   3 of 3  Before you send    the advice for that severity       [Send report]
 *
 * A back arrow on every screen (on screen 1 it closes the flow); back keeps
 * everything entered. The action button is pinned below the content, so it
 * can never be pushed off screen: on a small phone the content scrolls
 * behind it rather than the button moving. Nothing here blocks a report
 * beyond a place and a severity, which the server and the advice need.
 */

// Ermoupoli: where the pin starts if the phone can't (or won't) say where it is.
const FALLBACK = { latitude: 37.4449, longitude: 24.9427 };

export interface ReportWizardProps {
  guidance: WelfareGuidance;
  initial: ReportFlow;
  gps: { coords: { latitude: number; longitude: number } | null; locating: boolean; denied: boolean };
  onChoosePhoto: (fromCamera: boolean) => Promise<ReportFlow['photo']>;
  /** Spec §4.2: called (debounced) once location and severity are both set. */
  onDraft: (flow: ReportFlow) => void;
  onSend: (flow: ReportFlow) => Promise<void>;
  onClose: () => void;
  sending: boolean;
}

export function ReportWizard({
  guidance,
  initial,
  gps,
  onChoosePhoto,
  onDraft,
  onSend,
  onClose,
  sending,
}: ReportWizardProps) {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [flow, setFlow] = useState<ReportFlow>(initial);
  const scrollRef = useRef<ScrollView>(null);
  const update = (patch: Partial<ReportFlow>) => setFlow((f) => ({ ...f, ...patch }));

  // Where: the phone's fix, or Ermoupoli if there isn't one; the person moves the pin.
  useEffect(() => {
    if (flow.coords) return;
    if (gps.coords) update({ coords: gps.coords });
    else if (!gps.locating || gps.denied) update({ coords: FALLBACK });
  }, [gps.coords, gps.locating, gps.denied, flow.coords]);

  // §4.2: the draft once location and severity are both set. Best effort.
  const draftKey = draftReady(flow)
    ? `${flow.severity}:${flow.coords!.latitude.toFixed(5)},${flow.coords!.longitude.toFixed(5)}:${flow.isLitter}`
    : null;
  const flowRef = useRef(flow);
  flowRef.current = flow;
  useEffect(() => {
    if (!draftKey) return;
    const timer = setTimeout(() => onDraft(flowRef.current), 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Each screen starts at its top.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
  }, [flow.step]);

  const back = () => (flow.step === 1 ? onClose() : setFlow(flowBack));
  const title =
    flow.step === 1 ? t('reportWhereTitle') : flow.step === 2 ? t('reportHowBadTitle') : t('reportBeforeSendTitle');
  const choose = async (fromCamera: boolean) => {
    const photo = await onChoosePhoto(fromCamera);
    if (photo) update({ photo });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6, borderColor: colors.border }]}>
        <IconButton variant="ghost" label={t('back')} onPress={back}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </IconButton>
        <Text role="heading" style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.stepOf, { color: colors.mutedForeground }]} testID="report-step">
          {t('reportStepOf').replace('{n}', String(flow.step))}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        testID="report-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.column}>
          {flow.step === 1 && (
            <>
              {flow.photo ? (
                <View style={styles.photoRow}>
                  <Image
                    source={{
                      uri: flow.photo.uri.startsWith('blob:')
                        ? `data:image/jpeg;base64,${flow.photo.base64}`
                        : flow.photo.uri,
                    }}
                    style={styles.photo}
                    contentFit="cover"
                  />
                  <Pressable onPress={() => update({ photo: null })} hitSlop={8} accessibilityRole="button">
                    <Text style={[styles.linkText, { color: colors.mutedForeground }]}>{t('reportRemovePhoto')}</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.photoBlock}>
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>{t('reportPhotoHint')}</Text>
                  <View style={styles.photoButtons}>
                    <Button variant="secondary" size="md" onPress={() => void choose(true)}
                      iconLeft={<Feather name="camera" size={16} color={colors.foreground} />}>
                      {t('reportTakePhoto')}
                    </Button>
                    <Button variant="ghost" size="md" onPress={() => void choose(false)}>
                      {t('reportFromLibrary')}
                    </Button>
                  </View>
                </View>
              )}
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>{t('reportWhereHint')}</Text>
              {flow.coords ? (
                <LocationPicker
                  latitude={flow.coords.latitude}
                  longitude={flow.coords.longitude}
                  onChange={(coords) => update({ coords })}
                  pinColor={colors.accent}
                  style={styles.map}
                />
              ) : (
                <View style={[styles.map, styles.mapLoading, { borderColor: colors.border }]}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>{t('reportWaitingLocation')}</Text>
                </View>
              )}
            </>
          )}

          {flow.step === 2 && (
            <>
              {(['urgent', 'attention'] as const).map((s) => {
                const selected = flow.severity === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => update({ severity: s })}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    aria-checked={selected}
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
                      size={22}
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

              <Pressable
                onPress={() => update({ isLitter: !flow.isLitter })}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: flow.isLitter }}
                aria-checked={flow.isLitter}
                testID="litter-checkbox"
                style={styles.checkRow}
              >
                <Feather name={flow.isLitter ? 'check-square' : 'square'} size={22} color={colors.primary} />
                <Text style={[styles.checkLabel, { color: colors.foreground }]}>{t('reportLitter')}</Text>
              </Pressable>
              {flow.isLitter && <LitterAdvice guidance={guidance} />}

              <View style={styles.noteBlock}>
                <Text style={[styles.noteTitle, { color: colors.foreground }]}>{t('reportNoteTitle')}</Text>
                <TextInput
                  value={flow.note}
                  onChangeText={(note) => update({ note })}
                  multiline
                  placeholder={t('reportNotePlaceholder')}
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.note, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
                  testID="report-note"
                />
              </View>
            </>
          )}

          {flow.step === 3 &&
            (flow.severity === 'urgent' ? (
              <UrgentAdvice guidance={guidance} />
            ) : (
              <AttentionAdvice guidance={guidance} />
            ))}
        </View>
      </ScrollView>

      <View
        testID="report-footer"
        style={[styles.footer, { paddingBottom: insets.bottom + spacing[2], borderColor: colors.border, backgroundColor: colors.background }]}
      >
        <View style={styles.footerInner}>
          {flow.step < 3 ? (
            <Button variant="primary" size="lg" block disabled={!canAdvance(flow)} onPress={() => setFlow(flowNext)}>
              {t('reportNext')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              block
              disabled={sending}
              onPress={() => void onSend(flow)}
              iconLeft={sending ? <ActivityIndicator color={colors.primaryForeground} size="small" /> : undefined}
            >
              {t('reportSendReport')}
            </Button>
          )}
        </View>
      </View>
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
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontFamily: fonts.displayBold, fontSize: 18, flex: 1 },
  stepOf: { fontFamily: fonts.bodySemiBold, fontSize: 13 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: spacing[4], paddingTop: spacing[2], paddingBottom: spacing[2] },
  column: { flexGrow: 1, width: '100%', maxWidth: 640, alignSelf: 'center', gap: spacing[3] },
  hint: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  linkText: { fontFamily: fonts.bodySemiBold, fontSize: 14, textDecorationLine: 'underline' },
  photoBlock: { gap: 6 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  photo: { width: 64, height: 64, borderRadius: radii.sm },
  photoButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  // Fills the rest of screen 1; never smaller than a usable map.
  map: { flexGrow: 1, minHeight: 220, borderRadius: radii.md, overflow: 'hidden' },
  mapLoading: { borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: radii.md,
    minHeight: 64,
  },
  choiceTitle: { fontFamily: fonts.bodyBold, fontSize: 17 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], minHeight: 44 },
  checkLabel: { fontFamily: fonts.body, fontSize: 15, flex: 1 },
  noteBlock: { gap: 6 },
  noteTitle: { fontFamily: fonts.bodyBold, fontSize: 15 },
  note: {
    borderWidth: 1,
    borderRadius: radii.md,
    height: 64,
    padding: spacing[3],
    fontFamily: fonts.body,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing[2], paddingHorizontal: spacing[4] },
  footerInner: { width: '100%', maxWidth: 640, alignSelf: 'center' },
});
