import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useClaimCat,
  useUpdateCat,
  getGetCatQueryKey,
  getListCatsQueryKey,
  type Cat,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';

type Mode = 'claim' | 'edit';

/**
 * Bottom sheet for claiming a cat (owner name + home description) or, for the
 * cat's owner, renaming it and updating the home description.
 */
export function ClaimCatSheet({
  visible,
  mode,
  cat,
  onClose,
}: {
  visible: boolean;
  mode: Mode;
  cat: Cat;
  onClose: () => void;
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { deviceId, username, addOwnedCat } = useDevice();
  const queryClient = useQueryClient();

  const [ownerName, setOwnerName] = useState('');
  const [homeDescription, setHomeDescription] = useState('');
  const [catName, setCatName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Re-seed fields each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setOwnerName(cat.ownerName ?? username ?? '');
      setHomeDescription(cat.homeDescription ?? '');
      setCatName(cat.name);
      setError(null);
    }
  }, [visible, cat, username]);

  const onSuccess = (updated: Cat) => {
    if (mode === 'claim') addOwnedCat(updated.id);
    queryClient.setQueryData(
      getGetCatQueryKey(updated.id),
      (prev: { cat: Cat; sightings: unknown[] } | undefined) =>
        prev ? { ...prev, cat: { ...prev.cat, ...updated } } : prev,
    );
    queryClient.invalidateQueries({ queryKey: getGetCatQueryKey(updated.id) });
    queryClient.invalidateQueries({ queryKey: getListCatsQueryKey() });
    onClose();
  };

  const onError = (err: unknown) => {
    const status = (err as { status?: number })?.status;
    if (status === 409) setError(t('claimAlreadyClaimed'));
    else if (status === 403) setError(t('claimNotOwner'));
    else setError(t('claimNetworkError'));
  };

  const claim = useClaimCat({ mutation: { onSuccess, onError } });
  const update = useUpdateCat({ mutation: { onSuccess, onError } });
  const isPending = claim.isPending || update.isPending;

  const trimmedOwner = ownerName.trim();
  const trimmedHome = homeDescription.trim();
  const trimmedCatName = catName.trim();
  const canSubmit =
    !!deviceId &&
    !isPending &&
    (mode === 'claim'
      ? trimmedOwner.length > 0 && trimmedHome.length > 0
      : trimmedCatName.length > 0 && trimmedHome.length > 0);

  const submit = () => {
    if (!canSubmit || !deviceId) return;
    setError(null);
    if (mode === 'claim') {
      claim.mutate({
        catId: cat.id,
        data: { deviceId, ownerName: trimmedOwner, homeDescription: trimmedHome },
      });
    } else {
      update.mutate({
        catId: cat.id,
        data: { deviceId, name: trimmedCatName, homeDescription: trimmedHome },
      });
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.background,
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <View style={styles.titleRow}>
              <Feather name="home" size={18} color={colors.primary} />
              <Text style={[styles.title, { color: colors.foreground }]}>
                {mode === 'claim' ? t('claimTitle') : t('editCatTitle')}
              </Text>
            </View>
            {mode === 'claim' ? (
              <Text style={[styles.intro, { color: colors.mutedForeground }]}>
                {t('claimIntro')}
              </Text>
            ) : null}

            {mode === 'claim' ? (
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.foreground }]}>
                  {t('ownerNameLabel')}
                </Text>
                <TextInput
                  value={ownerName}
                  onChangeText={setOwnerName}
                  placeholder={t('ownerNamePlaceholder')}
                  placeholderTextColor={colors.mutedForeground}
                  maxLength={60}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                />
              </View>
            ) : (
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.foreground }]}>
                  {t('catNameLabel')}
                </Text>
                <TextInput
                  value={catName}
                  onChangeText={setCatName}
                  maxLength={60}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                />
              </View>
            )}

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>
                {t('homeDescriptionLabel')}
              </Text>
              <TextInput
                value={homeDescription}
                onChangeText={setHomeDescription}
                placeholder={t('homeDescriptionPlaceholder')}
                placeholderTextColor={colors.mutedForeground}
                maxLength={200}
                multiline
                style={[
                  styles.input,
                  styles.multiline,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                  },
                ]}
              />
            </View>

            {error && (
              <View style={styles.errorRow}>
                <Feather
                  name="alert-circle"
                  size={14}
                  color={colors.destructive ?? '#c0392b'}
                />
                <Text
                  style={[
                    styles.errorText,
                    { color: colors.destructive ?? '#c0392b' },
                  ]}
                >
                  {error}
                </Text>
              </View>
            )}

            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              style={[
                styles.submitBtn,
                { backgroundColor: colors.primary, opacity: canSubmit ? 1 : 0.5 },
              ]}
            >
              {isPending ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.submitText, { color: colors.primaryForeground }]}>
                  {mode === 'claim' ? t('confirmClaim') : t('saveChanges')}
                </Text>
              )}
            </Pressable>
            <Pressable onPress={onClose} style={styles.cancelBtn} hitSlop={6}>
              <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>
                {t('cancel')}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontFamily: 'Poppins_700Bold' },
  intro: { fontSize: 13, fontFamily: 'Nunito_400Regular' },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: 'Nunito_700Bold' },
  input: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { flex: 1, fontSize: 13, fontFamily: 'Nunito_600SemiBold' },
  submitBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { fontSize: 15, fontFamily: 'Nunito_700Bold' },
  cancelBtn: { alignItems: 'center', paddingVertical: 4 },
  cancelText: { fontSize: 13, fontFamily: 'Nunito_600SemiBold' },
});
