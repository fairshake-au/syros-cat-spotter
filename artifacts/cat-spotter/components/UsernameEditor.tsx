import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCheckUsernameAvailability,
  getCheckUsernameAvailabilityQueryKey,
  checkUsernameAvailability,
  getGetProfileQueryKey,
  getGetLeaderboardQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { AVAILABILITY_WAIT_MS, claimAndReconcile, withDeadline, withUpdatedUsername } from '@/lib/usernameClaim';

const MIN_LEN = 3;

/**
 * Profile-tab username editor: shows the current username with an Edit
 * button; editing reuses the landing-screen availability check and the
 * claim endpoint, with live feedback and duplicate blocking.
 */
export function UsernameEditor({ currentUsername }: { currentUsername: string | null }) {
  const colors = useColors();
  const { t } = useLanguage();
  const { deviceId, setUsername } = useDevice();
  const { isOnline } = useOffline();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [debounced, setDebounced] = useState('');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [uncertainName, setUncertainName] = useState<string | null>(null);
  const outstanding = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(draft.trim()), 400);
    return () => clearTimeout(id);
  }, [draft]);

  const trimmed = draft.trim();
  const longEnough = trimmed.length >= MIN_LEN;
  const isCurrent =
    !!currentUsername && trimmed.toLowerCase() === currentUsername.toLowerCase();
  const checkEnabled =
    isOnline && editing && debounced.length >= MIN_LEN && !isCurrent;

  const availability = useCheckUsernameAvailability(
    { name: debounced },
    {
      query: {
        enabled: checkEnabled,
        queryKey: getCheckUsernameAvailabilityQueryKey({ name: debounced }),
        staleTime: 30_000,
        retry: false,
        queryFn: ({ signal }) =>
          withDeadline(checkUsernameAvailability({ name: debounced }, { signal }), AVAILABILITY_WAIT_MS),
      },
    },
  );

  const onClaimed = (name: string) => {
    setUsername(name);
    const key = getGetProfileQueryKey(deviceId ?? '');
    queryClient.setQueryData(key, (old: object | undefined) => withUpdatedUsername(old, name));
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: getGetLeaderboardQueryKey() });
    setEditing(false);
    setUncertainName(null);
    setDraft('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const checking =
    !isCurrent && longEnough && (availability.isFetching || debounced !== trimmed);
  const available =
    !isCurrent &&
    longEnough &&
    !checking &&
    debounced === trimmed &&
    availability.data?.available === true;
  const taken =
    !isCurrent &&
    longEnough &&
    !checking &&
    debounced === trimmed &&
    availability.data?.available === false;

  const status = useMemo(() => {
    if (!editing || trimmed.length === 0 || isCurrent) return null;
    if (!longEnough)
      return { text: t('landingTooShort'), color: colors.mutedForeground, icon: 'info' as const };
    if (!isOnline)
      return { text: t('landingOffline'), color: colors.mutedForeground, icon: 'wifi-off' as const };
    if (checking)
      return { text: t('landingChecking'), color: colors.mutedForeground, icon: 'loader' as const };
    if (availability.isError)
      return { text: t('usernameCheckFailed'), color: colors.destructive ?? '#c0392b', icon: 'x-circle' as const };
    if (available)
      return { text: t('landingAvailable'), color: colors.primary, icon: 'check-circle' as const };
    if (taken)
      return {
        text:
          availability.data?.reason === 'offensive'
            ? t('usernameRejected')
            : availability.data?.reason === 'invalid'
              ? t('landingInvalid')
              : t('landingTaken'),
        color: colors.destructive ?? '#c0392b',
        icon: 'x-circle' as const,
      };
    return null;
  }, [editing, trimmed, isCurrent, longEnough, isOnline, checking, available, taken, availability.data, availability.isError, t, colors]);

  const canSubmit = (available || uncertainName === trimmed) && isOnline && !!deviceId && !pending;

  const submit = async () => {
    if (!canSubmit || !deviceId) return;
    setClaimError(null);
    setPending(true);
    outstanding.current++;
    const outcome = await claimAndReconcile(
      deviceId, uncertainName ?? trimmed, onClaimed,
      () => {
        outstanding.current--;
        if (outstanding.current === 0) setUncertainName(null);
      },
      undefined,
      (name) => name.toLowerCase() === trimmed.toLowerCase(),
    );
    setPending(false);
    if (outcome.kind === 'uncertain') {
      if (outstanding.current > 0) setUncertainName(trimmed);
      setClaimError(t('usernameClaimUncertain'));
    } else if (outcome.kind === 'rejected') {
      const e = outcome.error as { status?: number; data?: { code?: string } | null };
      setClaimError(e?.data?.code === 'offensive_username'
        ? t('usernameRejected')
        : e?.status === 409 ? t('landingTaken') : e?.status === 400 ? t('landingInvalid') : t('error'));
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        {t('usernameSection')}
      </Text>
      {!editing ? (
        <View style={styles.row}>
          <Text style={[styles.current, { color: colors.foreground }]} numberOfLines={1}>
            {currentUsername ?? '—'}
          </Text>
          {saved && (
            <Text style={[styles.statusText, { color: colors.primary }]}>{t('saved')}</Text>
          )}
          <Pressable
            onPress={() => {
              setDraft(currentUsername ?? '');
              setClaimError(null);
              setEditing(true);
            }}
            style={[styles.editBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Feather name="edit-2" size={13} color={colors.primary} />
            <Text style={[styles.editText, { color: colors.primary }]}>
              {t('usernameEdit')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <View style={styles.row}>
            <TextInput
              value={draft}
              onChangeText={(v) => {
                if (pending || uncertainName) return;
                setDraft(v);
                setClaimError(null);
              }}
              placeholder={t('landingUsernamePlaceholder')}
              placeholderTextColor={colors.mutedForeground}
              maxLength={24}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submit}
              editable={!pending && !uncertainName}
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  borderColor: available
                    ? colors.primary
                    : taken
                      ? (colors.destructive ?? '#c0392b')
                      : colors.border,
                  color: colors.foreground,
                },
              ]}
            />
            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              style={[
                styles.saveBtn,
                { backgroundColor: colors.primary, opacity: canSubmit ? 1 : 0.5 },
              ]}
            >
              {pending ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.saveText, { color: colors.primaryForeground }]}>
                  {uncertainName ? t('usernameRetryClaim') : t('save')}
                </Text>
              )}
            </Pressable>
          </View>
          {status && (
            <View style={styles.statusRow}>
              <Feather name={status.icon} size={14} color={status.color} />
              <Text style={[styles.statusText, { color: status.color }]}>{status.text}</Text>
            </View>
          )}
          {claimError && (
            <Text style={[styles.statusText, { color: colors.destructive ?? '#c0392b' }]}>
              {claimError}
            </Text>
          )}
          <Pressable
            disabled={pending || !!uncertainName}
            onPress={() => {
              setEditing(false);
              setDraft('');
              setClaimError(null);
            }}
          >
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
              {t('usernameCancel')}
            </Text>
          </Pressable>
        </View>
      )}
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        {t('usernameHint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 16, fontFamily: 'Nunito_700Bold' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  current: { flex: 1, fontSize: 15, fontFamily: 'Nunito_700Bold' },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editText: { fontSize: 12, fontFamily: 'Nunito_700Bold' },
  input: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  saveBtn: {
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 76,
  },
  saveText: { fontSize: 14, fontFamily: 'Nunito_700Bold' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 13, fontFamily: 'Nunito_600SemiBold' },
  hint: { fontSize: 12, fontFamily: 'Nunito_400Regular' },
});
