import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import colorTokens, { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useOffline } from '@/context/OfflineContext';
import { Button } from '@/components/purropolis';
import { BADGE_ICONS, BADGE_IDS } from '@/lib/i18n';
import type { NameNote } from '@/context/DeviceContext';

// Earned badges cycle through these, as the old grid did.
export const BADGE_TONES: { bg: string; fg: string; ring: string }[] = [
  { bg: palette.sun100, fg: '#9a6a0b', ring: palette.sun600 },
  { bg: palette.bougain100, fg: palette.bougain700, ring: palette.bougain500 },
  { bg: palette.aegean100, fg: palette.aegean800, ring: palette.aegean500 },
  { bg: palette.olive100, fg: palette.olive700, ring: palette.olive500 },
];

export function badgeTone(id: string) {
  const index = Math.max(0, (BADGE_IDS as readonly string[]).indexOf(id));
  return BADGE_TONES[index % BADGE_TONES.length];
}

/**
 * SYC-509: the light theme's muted grey (#667889) is 4.07:1 on the page,
 * under the 4.5:1 small text needs. New Profile text uses a darker stone in
 * light mode; dark mode's muted grey already passes on navy.
 */
export function useSubtleText(): string {
  const colors = useColors();
  return colors.background === colorTokens.light.background ? palette.stone700 : colors.mutedForeground;
}

/** One badge as a round medal: coloured with its icon when earned, a dashed ring when not. */
export function BadgeMedal({ id, earned, size = 40 }: { id: string; earned: boolean; size?: number }) {
  const colors = useColors();
  const tone = badgeTone(id);
  const icon = (BADGE_ICONS[id] ?? 'award') as React.ComponentProps<typeof Feather>['name'];
  return (
    <View
      style={[
        styles.medal,
        { width: size, height: size },
        earned
          ? { backgroundColor: tone.bg, borderColor: tone.ring, borderStyle: 'solid' }
          : { borderColor: colors.border, borderStyle: 'dashed' },
      ]}
    >
      <Feather
        name={icon}
        size={Math.round(size * 0.45)}
        color={earned ? tone.fg : colors.mutedForeground}
      />
    </View>
  );
}

/**
 * SYC-506: the background save gave this spotter another name. Shown on the
 * Me tab and on Settings; both read and clear the same note (spec §8.7).
 */
export function NameNoteCard({
  note,
  onChange,
  onDismiss,
}: {
  note: NameNote;
  onChange: () => void;
  onDismiss: () => void;
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const { isOnline } = useOffline();
  return (
    <View
      testID="name-note"
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Text style={[styles.noteText, { color: colors.foreground }]}>
        {t(note.reason === 'taken' ? 'nameNoteTaken' : 'nameNoteRefused')
          .replace('{from}', note.from)
          .replace('{to}', note.to)}
      </Text>
      <View style={styles.noteActions}>
        {isOnline && (
          <Button variant="primary" size="sm" onPress={onChange}>
            {t('nameNoteChange')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onPress={onDismiss}>
          {t('nameNoteDismiss')}
        </Button>
      </View>
    </View>
  );
}

export const sharedStyles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing[4], gap: spacing[3] },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: fontSizes.md },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  body: { fontFamily: fonts.body, fontSize: fontSizes.xs, lineHeight: 18 },
  center: { paddingVertical: spacing[6], alignItems: 'center', gap: spacing[3] },
});

const styles = StyleSheet.create({
  medal: {
    borderRadius: radii.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  noteText: { fontFamily: fonts.body, fontSize: fontSizes.sm, lineHeight: 20 },
  noteActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
