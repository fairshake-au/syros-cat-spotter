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
import { addKeepSafe, isInvalidEmail, looksLikeEmail, type KeepSafeSurface } from '@/lib/keepSafe';

/**
 * "Don't lose your spots" (SYC-3 plan, Slice 1 step 8; email-capture.md §3.0,
 * word for word). The same screen is the last onboarding step, the one-time
 * offer, and Settings' "Keep my spots safe" when it's off.
 *
 * It never blocks anything: **Save my spots** and **Skip** are the same size,
 * and either one goes straight on. The news box of §3.0 is hidden until SYC-45
 * builds news (a box that sent nothing would be a broken promise).
 *
 * Adding the address needs a connection. Offline, the screen says so and lets
 * the person carry on; spotting itself still works offline.
 */
export function KeepSafeScreen({
  surface,
  onSaved,
  onSkip,
  onBack,
}: {
  surface: KeepSafeSurface;
  onSaved: () => void;
  onSkip: () => void;
  onBack?: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, language } = useLanguage();
  const { deviceId } = useDevice();
  const { isOnline } = useOffline();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving || !deviceId) return;
    if (!looksLikeEmail(email)) {
      setError(t('keepSafeInvalidEmail'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addKeepSafe(deviceId, { email: email.trim(), language, surface });
      onSaved();
    } catch (err) {
      setError(isInvalidEmail(err) ? t('keepSafeInvalidEmail') : t('keepSafeSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const danger = colors.destructive ?? '#c0392b';

  return (
    <View testID="keep-safe-screen" style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        {onBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t('back')} hitSlop={10}>
            <Feather name="chevron-left" size={24} color={colors.mutedForeground} />
          </Pressable>
        ) : (
          <View style={styles.topBarSpacer} />
        )}
        <View style={styles.topBarSpacer} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          paddingHorizontal: spacing[5],
          paddingTop: spacing[4],
          paddingBottom: insets.bottom + spacing[5],
          gap: spacing[4],
        }}
      >
        <Text style={styles.emoji} allowFontScaling={false}>
          🔒
        </Text>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
          {t('keepSafeTitle')}
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>{t('keepSafeBody')}</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          {t('keepSafeWarning')} <Text style={styles.strong}>{t('keepSafeUnder15')}</Text>
        </Text>

        {isOnline ? (
          <View
            style={[
              styles.inputWrap,
              { backgroundColor: colors.card, borderColor: error ? danger : colors.border },
            ]}
          >
            <TextInput
              testID="keep-safe-email"
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
              returnKeyType="done"
              onSubmitEditing={save}
              editable={!saving}
              accessibilityLabel={t('keepSafePlaceholder')}
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>
        ) : (
          <Text testID="keep-safe-offline" style={[styles.note, { color: colors.mutedForeground }]}>
            {t('keepSafeOffline')}
          </Text>
        )}
        {error ? <Text style={[styles.note, { color: danger }]}>{error}</Text> : null}

        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          <Text style={styles.strong}>{t('keepSafeOptional')}</Text> {t('keepSafeOptionalRest')}
        </Text>

        {/* Equal in size: skipping costs nothing (§3.0). */}
        <View style={styles.buttons}>
          {isOnline ? (
            <View testID="keep-safe-save-wrap" style={styles.button}>
              <Button variant="primary" size="lg" block disabled={saving} onPress={save}>
                {t('keepSafeSave')}
              </Button>
            </View>
          ) : null}
          <View testID="keep-safe-skip-wrap" style={styles.button}>
            <Button variant="secondary" size="lg" block disabled={saving} onPress={onSkip}>
              {isOnline ? t('keepSafeSkip') : t('continue')}
            </Button>
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[5],
    paddingBottom: 6,
  },
  topBarSpacer: { width: 24 },
  emoji: { fontSize: 40 },
  title: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 30 },
  body: { fontFamily: fonts.body, fontSize: fontSizes.sm, lineHeight: 21 },
  strong: { fontFamily: fonts.bodyExtraBold },
  note: { fontFamily: fonts.bodyExtraBold, fontSize: fontSizes['2xs'] },
  inputWrap: {
    borderRadius: radii.md,
    borderWidth: borderWidths.thin,
    paddingHorizontal: spacing[4],
    paddingVertical: 12,
  },
  input: { fontFamily: fonts.bodyBold, fontSize: fontSizes.md, padding: 0 },
  buttons: { flexDirection: 'row', gap: spacing[3] },
  button: { flex: 1 },
});
