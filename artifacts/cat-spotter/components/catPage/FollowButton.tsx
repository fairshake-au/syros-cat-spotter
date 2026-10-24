import React from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  getGetCatQueryKey,
  useFollowCat,
  useUnfollowCat,
  type FollowState,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { fonts, fontSizes } from '@/constants/theme';

/** 403 OWNER_CANNOT_UNFOLLOW and 409 CAT_DECEASED: the page was out of date, not a hiccup. */
function isStaleRefusal(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const code = (err.data as { code?: unknown } | null)?.code;
  return (err.status === 403 && code === 'OWNER_CANNOT_UNFOLLOW') || (err.status === 409 && code === 'CAT_DECEASED');
}

/** How long "Couldn't update that" stays on screen. */
const FAILED_NOTE_MS = 4000;

export interface FollowButtonProps {
  catId: number;
  catName: string;
  deviceId: string;
  isFollowing: boolean;
  isOnline: boolean;
}

/**
 * SYC-624 D1: Follow / Following, top right of the cat page. Flips at once,
 * then settles on the server's answer (isFollowing and the fans count go into
 * the cached cat page); a refused tap goes back and says so for a few seconds.
 */
export function FollowButton({ catId, catName, deviceId, isFollowing, isOnline }: FollowButtonProps) {
  const colors = useColors();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const follow = useFollowCat({ mutation: { networkMode: 'always' } });
  const unfollow = useUnfollowCat({ mutation: { networkMode: 'always' } });
  // What the button shows. Starts from the page's data; a later change to that
  // data always wins over what a tap left here.
  const [shown, setShown] = React.useState(isFollowing);
  // The latest page data, for rolling back to the truth after a refused tap.
  const latest = React.useRef(isFollowing);
  React.useEffect(() => {
    latest.current = isFollowing;
    setShown(isFollowing);
  }, [isFollowing]);
  const inFlight = React.useRef(false);
  const [failed, setFailed] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const name = (key: string) => t(key).split('{name}').join(catName);

  const onPress = async () => {
    if (inFlight.current || !isOnline) return;
    inFlight.current = true;
    const want = !shown;
    setShown(want);
    setFailed(false);
    try {
      const state: FollowState = await (want ? follow : unfollow).mutateAsync({
        catId,
        data: { deviceId },
      });
      // The cat page keys its answer by device too, so match by prefix.
      queryClient.setQueriesData(
        { queryKey: getGetCatQueryKey(catId) },
        (prev: Record<string, unknown> | undefined) =>
          prev
            ? { ...prev, isFollowing: state.isFollowing, followersCount: state.followersCount }
            : prev,
      );
      setShown(state.isFollowing);
    } catch (err) {
      setShown(latest.current);
      if (isStaleRefusal(err)) {
        // The phone's picture of the cat is out of date (it owns the cat, or the
        // cat has died): fetch the truth instead of asking for a retry.
        queryClient.invalidateQueries({ queryKey: getGetCatQueryKey(catId) });
      } else {
        setFailed(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setFailed(false), FAILED_NOTE_MS);
      }
    } finally {
      inFlight.current = false;
    }
  };

  const noteText = !isOnline ? name('followNeedsConnection') : failed ? t('followFailed') : null;
  React.useEffect(() => {
    if (noteText !== null && Platform.OS !== 'web') AccessibilityInfo.announceForAccessibility?.(noteText);
  }, [noteText]);

  const bg = shown ? colors.primary : colors.card;
  const fg = shown ? colors.primaryForeground : colors.primary;
  const note = noteText;

  return (
    <View style={styles.wrap}>
      <Pressable
        // On the phone `role` would win over `accessibilityRole`, so it is web only.
        role={Platform.OS === 'web' ? 'button' : undefined}
        aria-pressed={Platform.OS === 'web' ? shown : undefined}
        aria-label={name('followA11y')}
        accessibilityLabel={name('followA11y')}
        accessibilityRole="togglebutton"
        accessibilityState={{ checked: shown, disabled: !isOnline }}
        disabled={!isOnline}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: bg, opacity: !isOnline ? 0.6 : pressed ? 0.85 : 1 },
        ]}
      >
        <Ionicons name={shown ? 'heart' : 'heart-outline'} size={16} color={fg} aria-hidden />
        <Text style={[styles.label, { color: fg }]}>{shown ? t('followingCat') : t('followCat')}</Text>
      </Pressable>
      {note !== null && (
        <Text
          role="status"
          accessibilityLiveRegion="polite"
          style={[styles.note, { backgroundColor: colors.card, color: colors.foreground }]}
        >
          {note}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end', maxWidth: 220 },
  button: {
    minHeight: 48,
    minWidth: 44,
    paddingHorizontal: 16,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  label: { fontFamily: fonts.bodyBold, fontSize: fontSizes.sm },
  note: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
    fontFamily: fonts.body,
    fontSize: fontSizes.xs,
    textAlign: 'right',
  },
});
