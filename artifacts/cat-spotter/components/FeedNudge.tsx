import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/purropolis/Button';
import { Card } from '@/components/purropolis/Card';
import type { NudgeForm } from '@/lib/waitingCard';
import { fonts, fontSizes, spacing } from '@/constants/theme';

/**
 * The feeding nudge on the first result screen (SYC-36; feeding-nudge.md
 * §3.3, §4, §5; match-wait plan PR 2). Below everything the spotter needs to
 * act on, never above it.
 *
 * - `full`: the nudge the wait showed, now with its two buttons. Without a
 *   donation link (§5.2) it says only who feeds the colonies (no pointer to
 *   another tab), has no figures and no "Help feed a cat", and keeps "Got it".
 * - `line`: the visitor's daily one-liner, with "Help feed a cat" only.
 *
 * "Help feed a cat" opens the counting address in the phone's own browser
 * (never a page inside the app: Apple 3.2.2(iv)); the line under it names the
 * donation page's host. Buttons sit side by side where they fit and wrap to
 * one per line on narrow screens and at large text. Both are at least 48
 * points tall (the lg size), and reachable by keyboard on the website.
 */
export interface FeedNudgeProps {
  variant: 'full' | 'line';
  form: NudgeForm;
  t: (key: string) => string;
  /** The donation page's host, e.g. syroscats.com. */
  donateHost: string | null;
  onHelp: () => void;
  onDismiss: () => void;
}

export function FeedNudge({ variant, form, t, donateHost, onHelp, onDismiss }: FeedNudgeProps) {
  const colors = useColors();
  const linkOn = form === 'link';

  const help = linkOn ? (
    <View style={styles.helpWrap}>
      <Button variant="secondary" size="lg" onPress={onHelp} wrapLabel accessibilityLabel={t('feedNudgeHelp')}>
        {t('feedNudgeHelp')}
      </Button>
      {donateHost ? (
        <Text style={[styles.opensAt, { color: colors.mutedForeground }]}>
          {t('campaignOpensAt').replace('{host}', donateHost)}
        </Text>
      ) : null}
    </View>
  ) : null;

  if (variant === 'line') {
    return (
      <View testID="feed-nudge-line" style={styles.line}>
        <Text style={[styles.body, { color: colors.foreground }]}>{t('feedNudgeLine')}</Text>
        <View style={styles.buttons}>{help}</View>
      </View>
    );
  }

  return (
    <View testID="feed-nudge">
      <Card flat style={styles.card}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
          {t('feedNudgeTitle')}
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>{t('feedNudgeWhy')}</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          {t(linkOn ? 'feedNudgeInstead' : 'feedNudgeInsteadNoLink')}
        </Text>
        {linkOn ? <Text style={[styles.euro, { color: colors.foreground }]}>{t('feedNudgeEuro')}</Text> : null}
        <View style={styles.buttons}>
          {help}
          <View style={styles.dismissWrap}>
            <Button variant="ghost" size="lg" onPress={onDismiss} wrapLabel accessibilityLabel={t('feedNudgeDismiss')}>
              {t('feedNudgeDismiss')}
            </Button>
          </View>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing[2], width: '100%' },
  line: { gap: spacing[2], width: '100%' },
  title: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.lg, lineHeight: fontSizes.lg * 1.3 },
  body: { fontFamily: fonts.body, fontSize: fontSizes.md, lineHeight: fontSizes.md * 1.45 },
  euro: { fontFamily: fonts.bodyBold, fontSize: fontSizes.md, lineHeight: fontSizes.md * 1.45 },
  // Side by side where they fit; each takes a whole line when they don't.
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[1] },
  helpWrap: { flexGrow: 1, flexBasis: 200, gap: spacing[1] },
  dismissWrap: { flexGrow: 1, flexBasis: 120 },
  opensAt: { fontFamily: fonts.body, fontSize: fontSizes.xs, textAlign: 'center' },
});
