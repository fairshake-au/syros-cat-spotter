import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button } from '@/components/purropolis';
import { useColors } from '@/hooks/useColors';
import { borderWidths, fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import {
  exchangeRestoreCode,
  isCodeNotValid,
  isInvalidEmail,
  isTooManyTries,
  looksLikeEmail,
  normaliseCode,
  requestRestore,
} from '@/lib/keepSafe';
import { clearWaiting, noteRequest, noteWrongTry, readWaiting, setMovingHandle } from '@/lib/restoreWaiting';
import { RestoreChooser } from './RestoreChooser';

const CODE_LENGTH = 8;
const MAX_REQUESTS = 3;
const MAX_WRONG_TRIES = 5;
const RESEND_AFTER_MS = 60_000;

/**
 * "Already a spotter? Get your spots back" (SYC-3, SYC-664). Three states:
 * `address` (type the address, we email an 8-digit code), `code` (type it
 * here) and `chooser` (a right code leads to the shared chooser, the same
 * steps as the link). The reply to the address is the same whether or not we
 * know it. The code only works on the phone that asked. Needs a connection.
 *
 * What survives a reload (web only, 15 minutes) is in lib/restoreWaiting:
 * the time asked, the counts and a handle mid-move. Never the address or code.
 */
type Step = { kind: 'address' } | { kind: 'code'; viaLink: boolean } | { kind: 'chooser'; handle: string };

export function RestoreRequestScreen({
  onBack,
  intro,
  startOnCode,
}: {
  onBack: () => void;
  intro?: React.ReactNode;
  startOnCode?: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { deviceId } = useDevice();
  const { isOnline } = useOffline();
  const [step, setStep] = useState<Step>(() => {
    const waiting = readWaiting();
    if (waiting?.movingHandle) return { kind: 'chooser', handle: waiting.movingHandle };
    if (startOnCode) return { kind: 'code', viaLink: !waiting?.requests };
    return { kind: 'address' };
  });
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [askedThrice, setAskedThrice] = useState(false);
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [codeProblem, setCodeProblem] = useState<'refused' | 'too-many' | 'failed' | null>(null);
  const [dead, setDead] = useState(() => (readWaiting()?.wrongTries ?? 0) >= MAX_WRONG_TRIES);
  const [, setTick] = useState(0);
  const lastSent = useRef<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  // Re-render each second on the code screen so "send another" wakes up after a minute.
  useEffect(() => {
    if (step.kind !== 'code') return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [step.kind]);

  const send = async () => {
    if (sending || !deviceId) return;
    if (!looksLikeEmail(email)) {
      setError(t('keepSafeInvalidEmail'));
      return;
    }
    if ((readWaiting()?.requests ?? 0) >= MAX_REQUESTS) {
      setAskedThrice(true);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await requestRestore(deviceId, email.trim());
      noteRequest();
      lastSent.current = null;
      setCode('');
      setCodeProblem(null);
      setDead(false);
      setStep({ kind: 'code', viaLink: false });
    } catch (err) {
      setError(isInvalidEmail(err) ? t('keepSafeInvalidEmail') : t('restoreAskFailed'));
    } finally {
      setSending(false);
    }
  };

  const submitCode = async (value: string) => {
    const norm = normaliseCode(value);
    if (inFlight.current || dead || !deviceId || norm.length !== CODE_LENGTH || norm === lastSent.current) return;
    lastSent.current = norm;
    inFlight.current = true;
    setChecking(true);
    setCodeProblem(null);
    try {
      const { handle } = await exchangeRestoreCode(deviceId, norm);
      // Only the newest handle works, so the newest is the one remembered.
      setMovingHandle(handle);
      if (alive.current) setStep({ kind: 'chooser', handle });
    } catch (err) {
      if (!alive.current) return;
      if (isCodeNotValid(err)) {
        const note = noteWrongTry();
        if (note.wrongTries >= MAX_WRONG_TRIES) setDead(true);
        else setCodeProblem('refused');
      } else if (isTooManyTries(err)) {
        lastSent.current = null;
        setCodeProblem('too-many');
      } else {
        lastSent.current = null;
        setCodeProblem('failed');
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setChecking(false);
    }
  };

  const onCodeChange = (v: string) => {
    setCode(v);
    setCodeProblem(null);
    const norm = normaliseCode(v);
    if (norm.length !== CODE_LENGTH) lastSent.current = null;
    void submitCode(v);
  };

  const askedAt = readWaiting()?.askedAt;
  const canResend = askedAt === undefined || Date.now() - askedAt >= RESEND_AFTER_MS;
  const backToAddress = () => {
    setCode('');
    setCodeProblem(null);
    lastSent.current = null;
    setStep({ kind: 'address' });
  };

  const danger = colors.destructive ?? '#c0392b';

  /** Out of the chooser (I2): the handle is forgotten, and the code box starts empty. */
  const leaveChooser = (to: 'code' | 'address') => {
    setMovingHandle(null);
    setCode('');
    setCodeProblem(null);
    lastSent.current = null;
    setStep(to === 'code' ? { kind: 'code', viaLink: !readWaiting()?.requests } : { kind: 'address' });
  };

  if (step.kind === 'chooser') {
    return <RestoreChooser secret={step.handle} fromCode onMoved={clearWaiting} onExit={leaveChooser} />;
  }

  return (
    <View testID="restore-request-screen" style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t('back')} hitSlop={10}>
          <Feather name="chevron-left" size={24} color={colors.mutedForeground} />
        </Pressable>
      </View>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          paddingHorizontal: spacing[5],
          paddingTop: spacing[4],
          paddingBottom: insets.bottom + spacing[5],
          gap: spacing[4],
        }}
      >
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
          {step.kind === 'code' ? t('restoreCodeTitle') : t('restoreAskTitle')}
        </Text>
        {step.kind === 'address' ? intro : null}
        {step.kind === 'code' ? (
          !isOnline ? (
            <Text style={[styles.body, { color: colors.mutedForeground }]}>{t('restoreAskOffline')}</Text>
          ) : dead ? (
            <>
              <Text testID="restore-code-dead" style={[styles.body, { color: colors.foreground }]}>
                {t('restoreCodeDead')}
              </Text>
              <Button variant="primary" size="lg" block onPress={backToAddress}>
                {t('restoreCodeNewEmail')}
              </Button>
            </>
          ) : (
            <>
              <Text style={[styles.body, { color: colors.foreground }]}>{t('restoreCodeBody')}</Text>
              <View
                style={[
                  styles.inputWrap,
                  { backgroundColor: colors.card, borderColor: codeProblem ? danger : colors.border },
                ]}
              >
                <TextInput
                  testID="restore-code-input"
                  value={code}
                  onChangeText={onCodeChange}
                  placeholder="48291376"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={10}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!checking}
                  accessibilityLabel={t('restoreCodeTitle')}
                  style={[styles.input, { color: colors.foreground }]}
                />
              </View>
              {step.viaLink ? (
                <Text style={[styles.note, { color: colors.mutedForeground }]}>{t('restoreHaveCodeNote')}</Text>
              ) : null}
              {codeProblem === 'refused' ? (
                <Text testID="restore-code-refused" style={[styles.note, { color: danger }]}>
                  {t('restoreCodeRefused')}
                </Text>
              ) : null}
              {codeProblem === 'too-many' ? (
                <Text testID="restore-too-many" style={[styles.note, { color: danger }]}>
                  {t('restoreTooManyTries')}
                </Text>
              ) : null}
              {codeProblem === 'failed' ? (
                <Text testID="restore-code-failed" style={[styles.note, { color: danger }]}>{t('restoreCodeFailed')}</Text>
              ) : null}
              <View testID="restore-code-submit">
                <Button
                  variant="primary"
                  size="lg"
                  block
                  disabled={checking || normaliseCode(code).length !== CODE_LENGTH}
                  onPress={() => void submitCode(code)}
                >
                  {t('restoreCodeSubmit')}
                </Button>
              </View>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                {t('restoreCodeNoEmail')}{' '}
                <Text
                  testID="restore-code-resend"
                  role="button"
                  aria-disabled={!canResend}
                  onPress={canResend ? backToAddress : undefined}
                  accessibilityRole="button"
                  style={{ color: canResend ? colors.primary : colors.mutedForeground, textDecorationLine: 'underline' }}
                >
                  {t('restoreCodeResend')}
                </Text>
              </Text>
            </>
          )
        ) : !isOnline ? (
          <Text style={[styles.body, { color: colors.mutedForeground }]}>{t('restoreAskOffline')}</Text>
        ) : (
          <>
            <Text style={[styles.body, { color: colors.foreground }]}>{t('restoreAskBody')}</Text>
            <View
              style={[
                styles.inputWrap,
                { backgroundColor: colors.card, borderColor: error ? danger : colors.border },
              ]}
            >
              <TextInput
                testID="restore-email"
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  setError(null);
                  setAskedThrice(false);
                }}
                placeholder={t('keepSafePlaceholder')}
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                inputMode="email"
                returnKeyType="send"
                onSubmitEditing={send}
                editable={!sending}
                accessibilityLabel={t('keepSafePlaceholder')}
                style={[styles.input, { color: colors.foreground }]}
              />
            </View>
            {error ? <Text style={[styles.note, { color: danger }]}>{error}</Text> : null}
            {askedThrice ? (
              <Text testID="restore-asked-thrice" style={[styles.note, { color: danger }]}>
                {t('restoreAskedThrice')}
              </Text>
            ) : null}
            <Button variant="primary" size="lg" block disabled={sending} onPress={send}>
              {t('restoreAskSend')}
            </Button>
            <Pressable
              testID="restore-have-code"
              onPress={() => setStep({ kind: 'code', viaLink: true })}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={[styles.body, { color: colors.primary, textDecorationLine: 'underline' }]}>
                {t('restoreHaveCode')}
              </Text>
            </Pressable>
          </>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[5], paddingBottom: 6 },
  title: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 30 },
  body: { fontFamily: fonts.body, fontSize: fontSizes.sm, lineHeight: 21 },
  note: { fontFamily: fonts.bodyExtraBold, fontSize: fontSizes['2xs'] },
  inputWrap: {
    borderRadius: radii.md,
    borderWidth: borderWidths.thin,
    paddingHorizontal: spacing[4],
    paddingVertical: 12,
  },
  input: { fontFamily: fonts.bodyBold, fontSize: fontSizes.md, padding: 0 },
});
