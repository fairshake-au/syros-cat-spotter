import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useOffline } from '@/context/OfflineContext';

/**
 * Lightweight in-app prompt shown after queued offline sightings finish
 * syncing. Tapping it opens the review screen for the first ready item.
 */
export function ReviewReadyBanner() {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { pending, reviewReadyCount, reviewPromptVisible, dismissReviewPrompt } =
    useOffline();

  if (!reviewPromptVisible || reviewReadyCount === 0) return null;
  // Don't nag while the user is already reviewing.
  if (pathname === '/review') return null;

  const first = pending.find((p) => p.status === 'review');
  if (!first) return null;

  const openReview = () => {
    dismissReviewPrompt();
    router.push({
      pathname: '/review',
      params: {
        data: JSON.stringify({
          sightingId: first.sightingId,
          isCatPhoto: first.isCatPhoto,
          candidates: first.candidates ?? [],
          photoUri: first.photoUri,
          localId: first.localId,
        }),
      },
    });
  };

  const message =
    reviewReadyCount === 1
      ? t('reviewReadyOne')
      : t('reviewReadyMany').replace('{count}', String(reviewReadyCount));

  return (
    <Pressable
      onPress={openReview}
      style={[
        styles.banner,
        {
          top: insets.top + 8,
          backgroundColor: colors.accent,
          shadowColor: '#000',
        },
      ]}
    >
      <Feather name="check-circle" size={16} color={colors.accentForeground} />
      <Text style={[styles.text, { color: colors.accentForeground }]}>
        {message}
      </Text>
      <Pressable onPress={dismissReviewPrompt} hitSlop={10}>
        <Feather name="x" size={16} color={colors.accentForeground} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
});
