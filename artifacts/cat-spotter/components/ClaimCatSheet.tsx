import React, { useEffect, useState } from 'react';
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
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useClaimCat,
  useLetGoCat,
  useUpdateCat,
  getGetCatQueryKey,
  type Cat,
} from '@workspace/api-client-react';
import { isDeviceMovedError } from '@/lib/deviceMoved';
import { CATALOGUE_QUERY_ROOT } from '@/lib/catalogue';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { registerModalOpen } from '@/lib/modalVisibility';
import { classifyResolveError, isBlankName } from '@/lib/catPicker';
import { claimRefusal, pinMovedFrom, pinTooFar } from '@/lib/claimCat';
import { getCurrentCoords } from '@/lib/currentPosition';
import { LocationPicker } from '@/components/LocationPicker';
import { Button } from '@/components/purropolis/Button';

type Mode = 'claim' | 'edit';

type Pin = { lat: number; lng: number };

/**
 * Bottom sheet for saying "This is my cat" (two screens, claiming-a-cat.md
 * §4.2) or, for the cat's owner, renaming it, updating the home note and
 * letting go (§6).
 *
 * The owner's note and pin are only ever held in this sheet's state and sent
 * in a request body: never in a URL, a route param or a log.
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
  const { deviceId, addOwnedCat, removeOwnedCat } = useDevice();
  const { isOnline } = useOffline();
  const queryClient = useQueryClient();

  // Wording uses the cat's name, never "he" or "she" (spec §4.1).
  const named = (key: string) => t(key).split('{name}').join(cat.name);

  const [step, setStep] = useState<1 | 2>(1);
  const [livesOnSyros, setLivesOnSyros] = useState(false);
  const [pin, setPin] = useState<Pin | null>(null);
  // Where the map was last started from, so a map that reports its own
  // starting centre isn't mistaken for the person placing the pin.
  const [pickerStart, setPickerStart] = useState<Pin>({ lat: cat.lat, lng: cat.lng });
  const [pickerKey, setPickerKey] = useState(0);
  const [locating, setLocating] = useState(false);
  const [confirmingLetGo, setConfirmingLetGo] = useState(false);
  const [homeDescription, setHomeDescription] = useState('');
  const [catName, setCatName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Re-seed fields each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setStep(1);
      setLivesOnSyros(false);
      setPin(null);
      setPickerStart({ lat: cat.lat, lng: cat.lng });
      setPickerKey((k) => k + 1);
      setConfirmingLetGo(false);
      setHomeDescription(cat.homeDescription ?? '');
      setCatName(cat.name);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, cat.id]);

  // SYC-134 review round 2, item 2: let the floating Home Screen nudge
  // card know a sheet is covering the screen, so it doesn't overlap this.
  useEffect(() => {
    if (!visible) return;
    return registerModalOpen();
  }, [visible]);

  const refreshCat = () => {
    queryClient.invalidateQueries({ queryKey: getGetCatQueryKey(cat.id) });
    queryClient.invalidateQueries({ queryKey: CATALOGUE_QUERY_ROOT });
  };

  const onSuccess = (updated: Cat) => {
    if (mode === 'claim') addOwnedCat(updated.id);
    queryClient.setQueryData(
      getGetCatQueryKey(updated.id),
      (prev: { cat: Cat; sightings: unknown[] } | undefined) =>
        prev ? { ...prev, cat: { ...prev.cat, ...updated } } : prev,
    );
    refreshCat();
    onClose();
  };

  // SYC-3: this phone's spotter moved to a new phone. The app shows "Your
  // spots moved to a new phone" (the API client's device_moved listener);
  // never "Only the owner of this cat can edit it".
  const onClaimError = (err: unknown) => {
    if (isDeviceMovedError(err)) {
      onClose();
      return;
    }
    // Spec §4.4: the words come from the refusal's `code`; a 409 means the
    // page was out of date, so it refreshes.
    const refusal = claimRefusal(err);
    setError(named(refusal.key));
    if (refusal.refreshPage) refreshCat();
  };

  const onEditError = (err: unknown) => {
    if (isDeviceMovedError(err)) {
      onClose();
      return;
    }
    const status = (err as { status?: number })?.status;
    const failure = classifyResolveError(err);
    // SYC-101: a rename to a name another cat already has (the same once
    // accents, case and final sigma are folded) is a 409 too.
    if (failure.kind === 'name-taken') setError(t('nameTaken'));
    else if (failure.kind === 'offensive') setError(t('catNameRejected'));
    else if (status === 403) setError(t('claimNotOwner'));
    else setError(t('claimNetworkError'));
  };

  const onLetGoSuccess = (updated: Cat) => {
    removeOwnedCat(updated.id);
    // The owner's view is gone; the public one is what comes back.
    queryClient.removeQueries({ queryKey: getGetCatQueryKey(updated.id) });
    queryClient.invalidateQueries({ queryKey: CATALOGUE_QUERY_ROOT });
    onClose();
  };

  const onLetGoError = (err: unknown) => {
    if (isDeviceMovedError(err)) {
      onClose();
      return;
    }
    setError(named(claimRefusal(err).key));
  };

  // A claim and a let-go are never saved to send later (spec §4.4):
  // networkMode "always" makes react-query send now and fail now, instead of
  // pausing the mutation until the phone is back online.
  const claim = useClaimCat({
    mutation: { networkMode: 'always', onSuccess, onError: onClaimError },
  });
  const letGo = useLetGoCat({
    mutation: { networkMode: 'always', onSuccess: onLetGoSuccess, onError: onLetGoError },
  });
  const update = useUpdateCat({ mutation: { onSuccess, onError: onEditError } });
  const isPending = claim.isPending || update.isPending || letGo.isPending;

  const trimmedHome = homeDescription.trim();
  const trimmedCatName = catName.trim();
  const canSaveEdit =
    !!deviceId &&
    !isPending &&
    !isBlankName(trimmedCatName) &&
    trimmedHome.length > 0;
  const canClaimNow = !!deviceId && !isPending && isOnline;

  const placePin = (coords: { latitude: number; longitude: number }) => {
    if (!pinMovedFrom(pickerStart, { lat: coords.latitude, lng: coords.longitude })) return;
    setPin({ lat: coords.latitude, lng: coords.longitude });
    setError(null);
  };

  const useWhereIAm = async () => {
    setLocating(true);
    setError(null);
    const here = await getCurrentCoords();
    setLocating(false);
    if (!here) return; // They can still put the pin on the map.
    setPin({ lat: here.latitude, lng: here.longitude });
    setPickerStart({ lat: here.latitude, lng: here.longitude });
    setPickerKey((k) => k + 1);
  };

  const submitClaim = () => {
    if (!canClaimNow || !deviceId || !pin) return;
    setError(null);
    // The same check the server makes, from the same public position
    // (spec §4.2). Never says how far.
    if (pinTooFar(cat, pin)) {
      setError(named('claimRefusedTooFar'));
      return;
    }
    const note = homeDescription.trim();
    claim.mutate({
      catId: cat.id,
      data: {
        deviceId,
        livesOnSyros: true,
        livesInMyHome: true,
        homePin: pin,
        ...(note ? { homeNote: note } : {}),
      },
    });
  };

  const submitEdit = () => {
    if (!canSaveEdit || !deviceId) return;
    setError(null);
    update.mutate({
      catId: cat.id,
      data: { deviceId, name: trimmedCatName, homeDescription: trimmedHome },
    });
  };

  const submitLetGo = () => {
    if (!deviceId || isPending || !isOnline) return;
    setError(null);
    letGo.mutate({ catId: cat.id, data: { deviceId } });
  };

  const errorRow = error && (
    <View style={styles.errorRow} accessibilityRole="alert">
      <Feather name="alert-circle" size={14} color={colors.destructive ?? '#c0392b'} />
      <Text style={[styles.errorText, { color: colors.destructive ?? '#c0392b' }]}>
        {error}
      </Text>
    </View>
  );

  const offlineRow = !isOnline && (
    <Text style={[styles.intro, { color: colors.mutedForeground }]}>
      {t('claimNeedsConnection')}
    </Text>
  );

  const textBlock = (key: string, strong = false) => (
    <Text
      style={[
        strong ? styles.question : styles.body,
        { color: strong ? colors.foreground : colors.mutedForeground },
      ]}
    >
      {named(key)}
    </Text>
  );

  const field = (
    labelKey: string,
    value: string,
    onChange: (v: string) => void,
    opts: { placeholderKey?: string; multiline?: boolean; maxLength: number },
  ) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.foreground }]}>{named(labelKey)}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={opts.placeholderKey ? t(opts.placeholderKey) : undefined}
        placeholderTextColor={colors.mutedForeground}
        maxLength={opts.maxLength}
        multiline={opts.multiline}
        style={[
          styles.input,
          opts.multiline && styles.multiline,
          { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
        ]}
      />
    </View>
  );

  // Cancel is the safe default and carries the visual weight (spec §4.2).
  const cancelButton = (
    <Button variant="primary" size="lg" block onPress={onClose}>
      {t('cancel')}
    </Button>
  );

  let content: React.ReactNode;
  if (mode === 'claim' && step === 1) {
    content = (
      <>
        <ScrollView style={styles.scroll} contentContainerStyle={{ gap: 12 }}>
          <View style={styles.titleRow}>
            <Feather name="home" size={18} color={colors.primary} />
            <Text style={[styles.title, { color: colors.foreground }]}>
              {named('claimConfirmTitle')}
            </Text>
          </View>
          {textBlock('claimConfirmBody')}
          {textBlock('claimGuardianLine')}
          {textBlock('claimTrustLine')}
          <Pressable
            onPress={() => setLivesOnSyros((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: livesOnSyros }}
            style={styles.checkRow}
          >
            <View
              style={[
                styles.checkBox,
                {
                  borderColor: livesOnSyros ? colors.primary : colors.border,
                  backgroundColor: livesOnSyros ? colors.primary : colors.card,
                },
              ]}
            >
              {livesOnSyros && <Feather name="check" size={14} color={colors.primaryForeground} />}
            </View>
            <Text style={[styles.checkLabel, { color: colors.foreground }]}>
              {t('claimLiveOnSyros')}
            </Text>
          </Pressable>
        </ScrollView>
        {errorRow}
        {offlineRow}
        <Button
          variant="secondary"
          size="lg"
          block
          disabled={!livesOnSyros}
          onPress={() => {
            setError(null);
            setStep(2);
          }}
        >
          {named('claimYes')}
        </Button>
        {cancelButton}
      </>
    );
  } else if (mode === 'claim') {
    content = (
      <>
        <View style={styles.titleRow}>
          <Feather name="map-pin" size={18} color={colors.primary} />
          <Text style={[styles.title, { color: colors.foreground }]}>
            {named('claimWhereTitle')}
          </Text>
        </View>
        <View style={styles.whereRow}>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {t('claimWhereHint')}
          </Text>
          <Button
            variant="secondary"
            size="sm"
            onPress={useWhereIAm}
            disabled={locating}
            iconLeft={<Feather name="crosshair" size={14} color={colors.secondaryForeground} />}
          >
            {locating ? t('locating') : t('claimUseHere')}
          </Button>
        </View>
        <LocationPicker
          key={pickerKey}
          latitude={pickerStart.lat}
          longitude={pickerStart.lng}
          onChange={placePin}
          style={styles.map}
        />
        {field('claimNoteLabel', homeDescription, setHomeDescription, {
          placeholderKey: 'claimNotePlaceholder',
          multiline: true,
          maxLength: 200,
        })}
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {t('claimPrivateLine')}
        </Text>
        {errorRow}
        {offlineRow}
        <Button
          variant="secondary"
          size="lg"
          block
          disabled={!pin || !canClaimNow}
          onPress={submitClaim}
        >
          {isPending ? (
            <ActivityIndicator size="small" color={colors.secondaryForeground} />
          ) : (
            t('claimDone')
          )}
        </Button>
        {cancelButton}
      </>
    );
  } else if (confirmingLetGo) {
    // The confirmation (spec §6). The button names the action it takes.
    content = (
      <>
        <View style={styles.titleRow}>
          <Feather name="home" size={18} color={colors.primary} />
          <Text style={[styles.title, { color: colors.foreground }]}>{named('letGo')}</Text>
        </View>
        {textBlock('letGoConfirm')}
        {errorRow}
        {offlineRow}
        <Button
          variant="secondary"
          size="lg"
          block
          disabled={isPending || !isOnline}
          onPress={submitLetGo}
          wrapLabel
        >
          {letGo.isPending ? (
            <ActivityIndicator size="small" color={colors.secondaryForeground} />
          ) : (
            named('letGo')
          )}
        </Button>
        <Button
          variant="primary"
          size="lg"
          block
          onPress={() => {
            setConfirmingLetGo(false);
            setError(null);
          }}
        >
          {t('cancel')}
        </Button>
      </>
    );
  } else {
    content = (
      <>
        <View style={styles.titleRow}>
          <Feather name="home" size={18} color={colors.primary} />
          <Text style={[styles.title, { color: colors.foreground }]}>{t('editCatTitle')}</Text>
        </View>
        {field('catNameLabel', catName, setCatName, { maxLength: 60 })}
        {field('homeDescriptionLabel', homeDescription, setHomeDescription, {
          placeholderKey: 'homeDescriptionPlaceholder',
          multiline: true,
          maxLength: 200,
        })}
        {errorRow}
        <Pressable
          onPress={submitEdit}
          disabled={!canSaveEdit}
          style={[
            styles.submitBtn,
            { backgroundColor: colors.primary, opacity: canSaveEdit ? 1 : 0.5 },
          ]}
        >
          {update.isPending ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.submitText, { color: colors.primaryForeground }]}>
              {t('saveChanges')}
            </Text>
          )}
        </Pressable>
        <Pressable onPress={onClose} style={styles.cancelBtn} hitSlop={6}>
          <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>
            {t('cancel')}
          </Text>
        </Pressable>
        {/* At the foot of the owner's sheet (spec §6). */}
        <Pressable
          onPress={() => {
            setError(null);
            setConfirmingLetGo(true);
          }}
          style={styles.letGoBtn}
          hitSlop={6}
          accessibilityRole="button"
        >
          <Text style={[styles.letGoText, { color: colors.mutedForeground }]}>
            {named('letGo')}
          </Text>
        </Pressable>
      </>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            {content}
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
  title: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  intro: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  scroll: { maxHeight: 420 },
  question: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  body: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkLabel: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  whereRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  map: { height: 200 },
  letGoBtn: { alignItems: 'center', paddingVertical: 8, marginTop: 4 },
  letGoText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', textDecorationLine: 'underline' },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  input: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  submitBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  cancelBtn: { alignItems: 'center', paddingVertical: 4 },
  cancelText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});
