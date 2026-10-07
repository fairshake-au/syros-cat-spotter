import React, { useState } from 'react';
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
import { isInvalidEmail, looksLikeEmail, requestRestore } from '@/lib/keepSafe';

/**
 * "Already a spotter? Get your spots back" (SYC-3 plan, Slice 1 step 8): type
 * the address, and we email a link to it. The reply is the same whether or
 * not we know the address, so the screen says "If that address is keeping a
 * spotter safe, we've sent a link". The link only works on this phone
 * (Decision 2). Needs a connection.
 */
export function RestoreRequestScreen({ onBack, intro }: { onBack: () => void; intro?: React.ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { deviceId } = useDevice();
  const { isOnline } = useOffline();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (sending || !deviceId) return;
    if (!looksLikeEmail(email)) {
      setError(t('keepSafeInvalidEmail'));
      return;
    }
    setSending(true);
    setError(null);
    try {
      await requestRestore(deviceId, email.trim());
      setSent(true);
    } catch (err) {
      setError(isInvalidEmail(err) ? t('keepSafeInvalidEmail') : t('restoreAskFailed'));
    } finally {
      setSending(false);
    }
  };

  const danger = colors.destructive ?? '#c0392b';

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
          {t('restoreAskTitle')}
        </Text>
        {intro}
        {sent ? (
          <Text testID="restore-request-sent" style={[styles.body, { color: colors.foreground }]}>
            {t('restoreAskSent')}
          </Text>
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
            <Button variant="primary" size="lg" block disabled={sending} onPress={send}>
              {t('restoreAskSend')}
            </Button>
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
