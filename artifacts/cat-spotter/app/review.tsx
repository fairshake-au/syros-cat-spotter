import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import {
  resolveSighting,
  type MatchCandidate,
  type ResolveResult,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useOffline } from '@/context/OfflineContext';
import { useDevice } from '@/context/DeviceContext';
import { absoluteUrl } from '@/lib/urls';

interface ReviewData {
  sightingId: number;
  isCatPhoto: boolean;
  candidates: MatchCandidate[];
  photoUri: string;
  localId?: string;
}

export default function ReviewScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { remove } = useOffline();
  const { deviceId } = useDevice();
  const params = useLocalSearchParams<{ data?: string }>();

  const data = useMemo<ReviewData | null>(() => {
    try {
      return params.data ? (JSON.parse(params.data) as ReviewData) : null;
    } catch {
      return null;
    }
  }, [params.data]);

  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [showNewCat, setShowNewCat] = useState(false);

  if (!data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>{t('error')}</Text>
      </View>
    );
  }

  const finishAndInvalidate = async (res: ResolveResult) => {
    setResult(res);
    if (data.localId) await remove(data.localId);
    queryClient.invalidateQueries();
  };

  const confirm = async (catId: number) => {
    if (!deviceId) return;
    setBusy(true);
    try {
      await finishAndInvalidate(
        await resolveSighting(data.sightingId, { deviceId, catId }),
      );
    } catch {
      setBusy(false);
    }
  };

  const registerNew = async () => {
    if (!newName.trim() || !deviceId) return;
    setBusy(true);
    try {
      await finishAndInvalidate(
        await resolveSighting(data.sightingId, {
          deviceId,
          newCatName: newName.trim(),
        }),
      );
    } catch {
      setBusy(false);
    }
  };

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  // ----- Success state -----
  if (result) {
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: colors.background, padding: 24, gap: 14 },
        ]}
      >
        <View style={[styles.successIcon, { backgroundColor: colors.accent }]}>
          <Feather name="check" size={34} color={colors.accentForeground} />
        </View>
        <Text style={[styles.successTitle, { color: colors.foreground }]}>
          {result.isNewCat ? t('newCatRegistered') : t('matchConfirmed')}
        </Text>
        <Text style={[styles.successCat, { color: colors.primary }]}>
          {result.cat.name}
        </Text>
        <Text style={[styles.points, { color: colors.foreground }]}>
          +{result.pointsAwarded} {t('pointsAwarded')}
        </Text>
        {result.newBadges.map((b) => (
          <View
            key={b}
            style={[styles.badgePill, { backgroundColor: colors.secondary }]}
          >
            <Feather name="award" size={16} color={colors.secondaryForeground} />
            <Text
              style={[styles.badgePillText, { color: colors.secondaryForeground }]}
            >
              {t('newBadge')} {t(`badge_${b}`)}
            </Text>
          </View>
        ))}
        <Pressable
          onPress={() => {
            router.replace({
              pathname: '/cat/[id]',
              params: { id: String(result.cat.id) },
            });
          }}
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
            {result.cat.name} →
          </Text>
        </Pressable>
      </View>
    );
  }

  // ----- Not a cat -----
  if (!data.isCatPhoto) {
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: colors.background, padding: 24, gap: 14 },
        ]}
      >
        <Feather name="help-circle" size={44} color={colors.mutedForeground} />
        <Text style={[styles.successTitle, { color: colors.foreground }]}>
          {t('notACat')}
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: colors.mutedForeground, textAlign: 'center' },
          ]}
        >
          {t('notACatMsg')}
        </Text>
        <Pressable
          onPress={close}
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
            {t('tryAgain')}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={close} hitSlop={8}>
          <Feather name="x" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t('reviewMatch')}
        </Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 16,
          paddingBottom: insets.bottom + 32,
        }}
      >
        <View style={styles.photoRow}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[styles.photoLabel, { color: colors.mutedForeground }]}>
              {t('yourPhoto')}
            </Text>
            <Image
              source={{ uri: data.photoUri }}
              style={[styles.photo, { borderColor: colors.border }]}
              contentFit="cover"
            />
          </View>
        </View>

        {data.candidates.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {t('matchesFound')} — {t('matchQuestion')}
            </Text>
            {data.candidates.map((c) => (
              <View
                key={c.catId}
                style={[
                  styles.candidate,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Image
                  source={{ uri: absoluteUrl(c.photoUrl) }}
                  style={styles.candidatePhoto}
                  contentFit="cover"
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.candidateName, { color: colors.foreground }]}>
                    {c.name}
                  </Text>
                  <Text style={[styles.confidence, { color: colors.accent }]}>
                    {Math.round(c.confidence * 100)}% {t('confidence')}
                  </Text>
                  <Text
                    style={[styles.reasoning, { color: colors.mutedForeground }]}
                    numberOfLines={3}
                  >
                    {c.reasoning}
                  </Text>
                  <Pressable
                    onPress={() => confirm(c.catId)}
                    disabled={busy}
                    style={[
                      styles.confirmBtn,
                      { backgroundColor: colors.primary, opacity: busy ? 0.5 : 1 },
                    ]}
                  >
                    {busy ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.primaryForeground}
                      />
                    ) : (
                      <Text
                        style={[
                          styles.confirmBtnText,
                          { color: colors.primaryForeground },
                        ]}
                      >
                        {t('confirmMatch')}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        ) : (
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {t('noMatches')}
          </Text>
        )}

        {showNewCat || data.candidates.length === 0 ? (
          <View
            style={[
              styles.newCatBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {t('newCatTitle')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {t('newCatSubtitle')}
            </Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder={t('nameYourCat')}
              placeholderTextColor={colors.mutedForeground}
              maxLength={40}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.input,
                  backgroundColor: colors.background,
                },
              ]}
            />
            <Pressable
              onPress={registerNew}
              disabled={busy || !newName.trim()}
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: colors.accent,
                  opacity: busy || !newName.trim() ? 0.5 : 1,
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.accentForeground} />
              ) : (
                <Text
                  style={[styles.primaryBtnText, { color: colors.accentForeground }]}
                >
                  {t('registerCat')}
                </Text>
              )}
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setShowNewCat(true)}
            style={[styles.secondaryBtn, { backgroundColor: colors.secondary }]}
          >
            <Text
              style={[styles.primaryBtnText, { color: colors.secondaryForeground }]}
            >
              {t('notThisCat')}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  title: { fontSize: 18, fontFamily: 'Poppins_700Bold' },
  subtitle: { fontSize: 13, fontFamily: 'Nunito_400Regular' },
  photoRow: { flexDirection: 'row', gap: 12 },
  photoLabel: { fontSize: 12, fontFamily: 'Nunito_600SemiBold' },
  photo: { width: '100%', aspectRatio: 1.4, borderRadius: 14, borderWidth: 1 },
  sectionTitle: { fontSize: 16, fontFamily: 'Nunito_700Bold' },
  candidate: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  candidatePhoto: { width: 84, height: 84, borderRadius: 12 },
  candidateName: { fontSize: 15, fontFamily: 'Nunito_700Bold' },
  confidence: { fontSize: 13, fontFamily: 'Nunito_700Bold' },
  reasoning: { fontSize: 12, fontFamily: 'Nunito_400Regular' },
  confirmBtn: {
    marginTop: 6,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 10,
  },
  confirmBtnText: { fontSize: 13, fontFamily: 'Nunito_700Bold' },
  newCatBox: { gap: 10, padding: 14, borderRadius: 14, borderWidth: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 10 : 12,
    fontSize: 15,
    fontFamily: 'Nunito_400Regular',
  },
  primaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    minWidth: 180,
  },
  secondaryBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: { fontSize: 15, fontFamily: 'Nunito_700Bold' },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold' },
  successCat: { fontSize: 17, fontFamily: 'Nunito_700Bold' },
  points: { fontSize: 15, fontFamily: 'Nunito_600SemiBold' },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  badgePillText: { fontSize: 13, fontFamily: 'Nunito_600SemiBold' },
});
