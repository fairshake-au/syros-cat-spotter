import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useIssueQueue } from '@/context/IssueQueueContext';
import { Button } from '@/components/purropolis/Button';
import { registerModalOpen } from '@/lib/modalVisibility';
import { APP_COLUMN_MAX_WIDTH } from '@/lib/appColumn';
import { displayUpperCase } from '@/lib/displayUpperCase';
import { savedWording } from '@/lib/savedWording';
import { photoSource } from '@/lib/urls';
import {
  CAT_REASONS,
  PHOTO_REASONS,
  isHidingReason,
  issueConfirmation,
  photoPublicIdFromUrl,
  type IssueConfirmation,
  type IssueReason,
} from '@/lib/issueQueue';
import type { Language } from '@/lib/i18n';
import type { ReportLanguage } from '@/lib/reportQueue';
import { fonts, radii, spacing } from '@/constants/theme';
import { setReportHandoff } from '@/lib/reportHandoff';

/** Reasons with a short hint under them (spec §2). `wrong_cat`'s is about a photo. */
const HINTS: Partial<Record<IssueReason, string>> = {
  photo_private: 'issueHint_photo_private',
  photo_not_cat: 'issueHint_photo_not_cat',
  wrong_info: 'issueHint_wrong_info',
};
const PHOTO_HINTS: Partial<Record<IssueReason, string>> = { ...HINTS, wrong_cat: 'issueHint_wrong_cat' };

const NOTE_MAX = 1000;

type Step = 'reasons' | 'details' | 'confirm' | 'done';

/**
 * "Report an issue" (SYC-44 PR 6.2; report-an-issue.md §2, §4.1, §4.2).
 *
 * 1. The reasons as large plain buttons: the cat reasons from the cat page,
 *    the photo reasons from a photo. The first line sends anyone with a hurt
 *    cat to "This cat needs help" instead.
 * 2. One optional box, "Anything we should know?" (no email box, D9).
 * 3. For a reason that hides, the confirm step in the approved words, with
 *    **Report and hide** and **Cancel**. Nothing is saved or sent before it.
 * 4. The report is saved on the phone, then sent with a fresh safety check.
 * 5. The confirmation, chosen from what the server did (`hidden`), never
 *    from the reason. Until the server answers it never says "hidden".
 *
 * `initialReason` opens it with a reason already chosen (`wrong_info`, for
 * the "Think this cat is alive?" link, choose-a-different-cat.md; plan C11),
 * and the box then asks "What do you know?".
 */
export function ReportIssueSheet({
  catId,
  catName,
  photoUrl,
  initialReason,
  onClose,
}: {
  catId: number;
  catName: string;
  /** Set when reporting one photo: its address (the server knows it by its public id). */
  photoUrl?: string | null;
  initialReason?: IssueReason;
  onClose: () => void;
}) {
  const colors = useColors();
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { submitIssue, issues, replies, syncing, retryFailed } = useIssueQueue();
  useEffect(() => registerModalOpen(), []);

  const photoPublicId = photoPublicIdFromUrl(photoUrl);
  const forPhoto = photoPublicId !== null;
  const reasons = forPhoto ? PHOTO_REASONS : CAT_REASONS;
  const hints = forPhoto ? PHOTO_HINTS : HINTS;

  const [reason, setReason] = useState<IssueReason | null>(initialReason ?? null);
  const [step, setStep] = useState<Step>(initialReason ? 'details' : 'reasons');
  const [note, setNote] = useState('');
  const [sentId, setSentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A ref as well as state: two quick taps land before a re-render (review finding 7).
  const savingRef = useRef(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // A failed save is about that attempt: going back or choosing again clears it (ship review, finding 5).
  useEffect(() => {
    if (step === 'reasons') setSaveFailed(false);
  }, [step]);

  const isWeb = Platform.OS === 'web';
  // On the website a waiting report is saved in the browser, not on a phone.
  const saved = (text: string) => savedWording(text, language as Language, isWeb);

  const send = async () => {
    if (!reason || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      const id = await submitIssue({
        reason,
        catId,
        photoPublicId,
        note: note.slice(0, NOTE_MAX),
        language: (['en', 'el', 'fr'].includes(language) ? language : 'en') as ReportLanguage,
      });
      setSentId(id);
      setStep('done');
    } catch {
      // Not saved (storage full or unreadable): say so, and let them try again.
      setSaveFailed(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveFailedLine = saveFailed ? (
    <Text testID="issue-save-failed" role="alert" style={[styles.body, { color: colors.destructive }]}>
      {saved(t('issueSaveFailed'))}
    </Text>
  ) : null;

  const goToNeedsHelp = () => {
    onClose();
    // SYC-504: the report is about this cat; the sheet has no photo URL to hand over.
    setReportHandoff({ cat: { id: catId, name: catName, photoUrl: null } });
    router.push('/report');
  };

  const shown: IssueConfirmation | null =
    sentId && reason ? issueConfirmation(sentId, reason, issues, replies, syncing) : null;

  const para = [styles.body, { color: colors.foreground }];
  const muted = [styles.hint, { color: colors.mutedForeground }];

  let content: React.ReactNode;
  if (step === 'reasons') {
    content = (
      <>
        <Pressable
          testID="issue-hurt-first"
          role="link"
          onPress={goToNeedsHelp}
          style={[styles.hurt, { backgroundColor: colors.muted, borderColor: colors.border }]}
        >
          <Text style={[styles.hurtText, { color: colors.foreground }]}>{t('issueHurtFirst')}</Text>
        </Pressable>
        <View style={styles.reasonList}>
          {reasons.map((r) => (
            <Pressable
              key={r}
              testID={`issue-reason-${r}`}
              // `role`, not accessibilityRole: react-native-web announces it as a button.
              role="button"
              onPress={() => {
                setReason(r);
                setStep('details');
              }}
              style={[styles.reason, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <Text style={[styles.reasonLabel, { color: colors.foreground }]}>{t(`issueReason_${r}`)}</Text>
              {hints[r] ? (
                <Text testID={`issue-hint-${r}`} style={muted}>
                  {t(hints[r]!)}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      </>
    );
  } else if (step === 'details' && reason) {
    content = (
      <>
        <Text testID="issue-chosen-reason" style={[styles.reasonLabel, { color: colors.foreground }]}>
          {t(`issueReason_${reason}`)}
        </Text>
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>
            {t(reason === 'wrong_info' && initialReason === 'wrong_info' ? 'issueNoteLabelWrongInfo' : 'issueNoteLabel')}
          </Text>
          <TextInput
            testID="issue-note"
            accessibilityLabel={t(
              reason === 'wrong_info' && initialReason === 'wrong_info' ? 'issueNoteLabelWrongInfo' : 'issueNoteLabel',
            )}
            value={note}
            onChangeText={setNote}
            maxLength={NOTE_MAX}
            multiline
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
            ]}
          />
        </View>
        {saveFailedLine}
        <Button
          variant="primary"
          size="lg"
          block
          testID="issue-send"
          disabled={saving}
          onPress={() => (isHidingReason(reason) ? setStep('confirm') : void send())}
        >
          {t('issueSend')}
        </Button>
        <Button variant="ghost" size="md" block testID="issue-back" onPress={() => setStep('reasons')}>
          {t('back')}
        </Button>
      </>
    );
  } else if (step === 'confirm') {
    content = (
      <>
        <Text testID="issue-confirm-text" role="heading" style={[styles.confirm, { color: colors.foreground }]}>
          {t('issueConfirm')}
        </Text>
        {saveFailedLine}
        <Button variant="primary" size="lg" block testID="issue-report-and-hide" disabled={saving} onPress={() => void send()}>
          {t('issueConfirmHide')}
        </Button>
        <Button variant="secondary" size="lg" block testID="issue-confirm-cancel" onPress={() => setStep('details')}>
          {t('cancel')}
        </Button>
      </>
    );
  } else {
    content = (
      <>
        {/* Announced when it changes, e.g. from "Sending…" to the server's answer. */}
        <View aria-live="polite" accessibilityLiveRegion="polite">
          {renderDone(shown)}
        </View>
        {shown === 'failed' ? (
          <Button variant="primary" size="lg" block testID="issue-try-again" onPress={() => void retryFailed()}>
            {t('reportTryAgain')}
          </Button>
        ) : null}
        <Button variant="secondary" size="lg" block testID="issue-done" onPress={onClose}>
          {t('reportDone')}
        </Button>
      </>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop} testID="report-issue-sheet">
        <Pressable testID="issue-backdrop" accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <View style={styles.titleRow}>
              {forPhoto && photoUrl ? (
                <Image source={photoSource(photoUrl)} style={[styles.thumb, { borderColor: colors.border }]} contentFit="cover" />
              ) : null}
              <View style={styles.titleText}>
                {/* Capitals via displayUpperCase: Greek capitals drop their accents (SYC-159). */}
                <Text testID="issue-eyebrow" style={[styles.eyebrow, { color: colors.mutedForeground }]}>
                  {displayUpperCase(t(forPhoto ? 'reportIssuePhoto' : 'reportIssue'))}
                </Text>
                <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
                  {catName}
                </Text>
              </View>
            </View>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
              {content}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );

  /** The confirmation (spec §4.1, §4.2), from `issueConfirmation`. */
  function renderDone(state: IssueConfirmation | null): React.ReactNode {
    const savedText = saved;
    const web = isWeb;
    const heading = [styles.doneText, { color: colors.foreground }];
    switch (state) {
      case 'hidden':
        return <Text testID="issue-done-hidden" role="heading" style={heading}>{t('issueDoneHidden')}</Text>;
      case 'notHidden':
        return <Text testID="issue-done-not-hidden" role="heading" style={heading}>{t('issueDoneNotHidden')}</Text>;
      case 'died':
        return <Text testID="issue-done-died" role="heading" style={heading}>{t('issueDoneDied')}</Text>;
      case 'thanks':
        return <Text testID="issue-done-thanks" role="heading" style={heading}>{t('issueDoneThanks')}</Text>;
      case 'sending':
      case null:
        return (
          <View style={styles.row} testID="issue-done-sending">
            <ActivityIndicator color={colors.primary} />
            <Text style={heading}>{t('reportSending')}</Text>
          </View>
        );
      case 'check':
        return <Text testID="issue-done-check" role="heading" style={heading}>{t('reportCheckUnavailable')}</Text>;
      case 'blocked':
        return <Text testID="issue-done-blocked" role="heading" style={heading}>{t('reportCheckBlocked')}</Text>;
      case 'busy':
        return <Text testID="issue-done-busy" role="heading" style={heading}>{savedText(t('reportBusy'))}</Text>;
      case 'failed':
        return (
          <Text testID="issue-done-failed" role="heading" style={[heading, { color: colors.destructive }]}>
            {savedText(t('reportFailed'))}
          </Text>
        );
      case 'queued':
      default:
        // Saved, not sent: it never says "hidden" (spec §4.2).
        return (
          <View style={styles.doneBlock}>
            <Text testID="issue-done-saved" role="heading" style={heading}>
              {savedText(t('issueSaved'))}
            </Text>
            {web ? (
              <Text testID="issue-done-browser-note" style={para}>
                {t('issueSavedBrowserNote')}
              </Text>
            ) : null}
          </View>
        );
    }
  }
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    width: '100%',
    maxWidth: APP_COLUMN_MAX_WIDTH,
    alignSelf: 'center',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleText: { flex: 1, gap: 2 },
  thumb: { width: 44, height: 44, borderRadius: radii.sm, borderWidth: 1 },
  eyebrow: { fontFamily: fonts.bodySemiBold, fontSize: 11, letterSpacing: 0.6 },
  title: { fontFamily: fonts.bodyBold, fontSize: 18 },
  scroll: { maxHeight: 520 },
  scrollBody: { gap: spacing[3], paddingBottom: spacing[2] },
  hurt: { borderWidth: 1, borderRadius: radii.md, padding: spacing[3] },
  hurtText: { fontFamily: fonts.bodySemiBold, fontSize: 14, lineHeight: 20, textDecorationLine: 'underline' },
  reasonList: { gap: spacing[2] },
  reason: { borderWidth: 1, borderRadius: radii.md, paddingVertical: 14, paddingHorizontal: 16, minHeight: 52, gap: 2 },
  reasonLabel: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22 },
  hint: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  field: { gap: 6 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14 },
  input: {
    borderWidth: 1,
    borderRadius: radii.md,
    minHeight: 96,
    padding: 12,
    fontFamily: fonts.body,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  confirm: { fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 24 },
  doneBlock: { gap: spacing[2] },
  doneText: { fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 24, flexShrink: 1 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
});
