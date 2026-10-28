import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  findNodeHandle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getGetCatQueryKey,
  suggestCatNames,
  useNameCat,
  type Cat,
} from '@workspace/api-client-react';
import { SHEET_MAX_WIDTH } from '@/lib/appColumn';
import { CATALOGUE_QUERY_ROOT } from '@/lib/catalogue';
import { isDeviceMovedError } from '@/lib/deviceMoved';
import { mergedSurvivorId } from '@/lib/mergedCats';
import { classifyResolveError, isBlankName } from '@/lib/catPicker';
import { registerModalOpen } from '@/lib/modalVisibility';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { Button } from '@/components/purropolis/Button';

/**
 * SYC-677 D: a cat Syros Cats left unnamed (`namePending`) shows its SYR
 * number, and any spotter can name it. The first good name wins; someone
 * else getting there first is told so, and the page refreshes.
 */
function NameThisCatSheet({
  cat,
  onClose,
  onAlreadyNamed,
  onSaved,
}: {
  cat: Cat;
  onClose: () => void;
  onAlreadyNamed: () => void;
  onSaved: (name: string) => void;
}) {
  const colors = useColors();
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const { deviceId } = useDevice();
  const { isOnline } = useOffline();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [shown, setShown] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => registerModalOpen(), []);

  const refreshCat = () => {
    queryClient.invalidateQueries({ queryKey: getGetCatQueryKey(cat.id) });
    queryClient.invalidateQueries({ queryKey: CATALOGUE_QUERY_ROOT });
  };

  const save = useNameCat({
    mutation: {
      // A name is never saved to send later: send now, fail now.
      networkMode: 'always',
      onSuccess: (updated: Cat) => {
        // The cat page keys its answer by device too, so match by prefix.
        queryClient.setQueriesData(
          { queryKey: getGetCatQueryKey(updated.id) },
          (prev: { cat: Cat; sightings: unknown[] } | undefined) =>
            prev ? { ...prev, cat: { ...prev.cat, ...updated } } : prev,
        );
        refreshCat();
        onSaved(updated.name);
        onClose();
      },
      onError: (err: unknown) => {
        if (isDeviceMovedError(err)) {
          onClose();
          return;
        }
        // SYC-59: the team merged this record into another cat while the card
        // was open. Reload the page: it now shows that cat, with the note.
        if (mergedSurvivorId(err) !== null) {
          refreshCat();
          setError(t('mergedRefused'));
          return;
        }
        const code = ((err as { data?: { code?: string } })?.data?.code) ?? null;
        if (code === 'ALREADY_NAMED') {
          refreshCat();
          onAlreadyNamed();
          onClose();
          return;
        }
        if (code === 'EMPTY_NAME') {
          setError(t('nameYourCat'));
          return;
        }
        // SYC-709: the phone's 3 names for today are used.
        if (code === 'NAME_DAILY_LIMIT') {
          setError(t('nameThisCatDailyLimit'));
          return;
        }
        // SYC-709: the server doesn't count this phone as having met the
        // cat (an app that missed `canName`, or a sighting moved away).
        if (code === 'NEEDS_SIGHTING') {
          refreshCat();
          setError(t('nameThisCatNeedsSighting'));
          return;
        }
        const status = (err as { status?: number })?.status;
        // A 503 is the server's naming count failing, not the phone's
        // connection: "try again later", like a 429.
        if (status === 429 || status === 503) {
          setError(t('claimRefusedLater'));
          return;
        }
        if (status === 404) {
          // The cat has gone from the list: refresh so the page says so.
          refreshCat();
          setError(t('nameThisCatGone'));
          return;
        }
        const failure = classifyResolveError(err);
        if (failure.kind === 'name-taken') setError(t('nameTaken'));
        else if (failure.kind === 'offensive') setError(t('catNameRejected'));
        else if (failure.kind === 'syr-shaped') setError(t('syrShapedName'));
        else if (failure.kind === 'has-link') setError(t('nameHasLink'));
        else setError(t('claimNetworkError'));
      },
    },
  });

  const trimmed = name.trim();
  const canSave = !!deviceId && isOnline && !save.isPending && !isBlankName(trimmed);

  const submit = () => {
    if (!canSave || !deviceId) return;
    setError(null);
    save.mutate({ catId: cat.id, data: { deviceId, name: trimmed } });
  };

  const suggest = async () => {
    if (!isOnline || suggesting) return;
    setSuggesting(true);
    setError(null);
    try {
      const res = await suggestCatNames({ language, excludeNames: shown });
      setSuggestions(res.suggestions);
      setShown((s) => [...s, ...res.suggestions]);
      if (res.suggestions.length === 0) setError(t('suggestNamesError'));
    } catch {
      setError(t('suggestNamesError'));
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('extraPhotoClose')}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <View style={styles.titleRow}>
              <Feather name="edit-3" size={18} color={colors.primary} />
              <Text role="heading" style={[styles.title, { color: colors.foreground }]}>
                {t('nameThisCat')}
              </Text>
            </View>
            <TextInput
              value={name}
              onChangeText={(v) => {
                setName(v);
                setError(null);
              }}
              placeholder={t('nameYourCat')}
              placeholderTextColor={colors.mutedForeground}
              accessibilityLabel={t('catNameLabel')}
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={submit}
              style={[
                styles.input,
                { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
              ]}
            />
            {suggestions.length > 0 && (
              <View style={styles.chips}>
                {suggestions.map((s) => (
                  <Pressable
                    key={s}
                    accessibilityRole="button"
                    onPress={() => {
                      setName(s);
                      setError(null);
                    }}
                    style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.card }]}
                  >
                    <Text style={[styles.chipText, { color: colors.foreground }]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {error && (
              <View style={styles.errorRow} accessibilityRole="alert">
                <Feather name="alert-circle" size={14} color={colors.destructive} />
                <Text style={[styles.errorText, { color: colors.destructive }]}>
                  {error}
                </Text>
              </View>
            )}
            {!isOnline && (
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                {t('nameThisCatNeedsConnection')}
              </Text>
            )}
            <Button
              variant="secondary"
              size="lg"
              block
              disabled={!isOnline || suggesting}
              onPress={() => void suggest()}
            >
              {suggesting ? (
                <ActivityIndicator size="small" color={colors.secondaryForeground} />
              ) : (
                t('nameThisCatSuggest')
              )}
            </Button>
            <Button variant="primary" size="lg" block disabled={!canSave} onPress={submit}>
              {save.isPending ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                t('nameThisCatSave')
              )}
            </Button>
            <Pressable onPress={onClose} style={styles.cancelBtn} hitSlop={6} accessibilityRole="button">
              <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>{t('cancel')}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/** Hands focus back to the button that opened the sheet (SYC-709 review). */
function focusBack(ref: React.RefObject<View | null>) {
  const node = ref.current;
  if (!node) return;
  if (Platform.OS === 'web') {
    (node as unknown as { focus?: () => void }).focus?.();
    return;
  }
  const handle = findNodeHandle(node);
  if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
}

/**
 * On the cat's page while the name is pending: the SYR number, a short
 * invitation and, for a phone that has met the cat (`canName`, SYC-709), the
 * Name this cat button; any other phone is told to spot the cat first.
 * Renders nothing for a named cat, except for the line that someone else
 * named it first.
 */
export function NameThisCatCard({ cat, canName }: { cat: Cat; canName?: boolean }) {
  const colors = useColors();
  const { t } = useLanguage();
  const { isOnline } = useOffline();
  const [open, setOpen] = useState(false);
  const [justNamed, setJustNamed] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const buttonRef = useRef<View>(null);
  const close = () => {
    setOpen(false);
    // After the sheet has gone, so focus doesn't land inside it.
    setTimeout(() => focusBack(buttonRef), 0);
  };

  if (savedName !== null) {
    return (
      <Text
        accessibilityRole="alert"
        testID="name-this-cat-saved"
        style={[styles.body, { color: colors.foreground, marginBottom: 12 }]}
      >
        {t('nameThisCatSaved').split('{name}').join(savedName)}
      </Text>
    );
  }
  if (justNamed) {
    return (
      <Text
        accessibilityRole="alert"
        style={[styles.body, { color: colors.foreground, marginBottom: 12 }]}
      >
        {t('nameThisCatJustNamed')}
      </Text>
    );
  }
  if (!cat.namePending) return null;

  return (
    <View
      testID="name-this-cat"
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Text style={[styles.body, { color: colors.foreground }]}>{t(canName === true ? 'nameThisCatIntro' : 'nameThisCatIntroNotMet')}</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        {t('nameThisCatNumber').split('{number}').join(cat.name)}
      </Text>
      {canName === true ? (
        <>
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!isOnline}
            onPress={() => setOpen(true)}
            pressableRef={buttonRef}
          >
            {t('nameThisCat')}
          </Button>
          {!isOnline && (
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {t('nameThisCatNeedsConnection')}
            </Text>
          )}
        </>
      ) : (
        <Text testID="name-this-cat-spot-first" style={[styles.body, { color: colors.foreground }]}>
          {t('nameThisCatNeedsSighting')}
        </Text>
      )}
      {open && canName === true && (
        <NameThisCatSheet
          cat={cat}
          onClose={close}
          onAlreadyNamed={() => setJustNamed(true)}
          onSaved={setSavedName}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 16, padding: 16, gap: 10, marginBottom: 12 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    alignSelf: 'center',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  body: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  input: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  cancelBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  cancelText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});
