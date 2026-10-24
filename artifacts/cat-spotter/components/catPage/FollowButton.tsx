import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCatQueryKey,
  useFollowCat,
  useUnfollowCat,
  type FollowState,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { fonts, fontSizes } from '@/constants/theme';

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
  React.useEffect(() => setShown(isFollowing), [isFollowing]);
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
    const before = shown;
    const want = !before;
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
    } catch {
      setFailed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFailed(false), FAILED_NOTE_MS);
      setShown(before);
    } finally {
      inFlight.current = false;
    }
  };

  const bg = shown ? colors.primary : colors.card;
  const fg = shown ? colors.primaryForeground : colors.primary;
  const note = !isOnline ? name('followNeedsConnection') : failed ? t('followFailed') : null;

  return (
    <View style={styles.wrap}>
      <Pressable
        role="button"
        aria-pressed={shown}
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
