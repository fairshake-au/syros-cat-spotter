import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CareEvent } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { ReportIssueLink } from '@/components/report/ReportIssueLink';
import { useQuietColor } from '@/hooks/useQuietColor';
import { formatMonthYear } from '@/lib/catPageDates';
import { palette } from '@/constants/colors';
import { fonts, fontSizes } from '@/constants/theme';

const CARE_META: Record<CareEvent['type'], { icon: string; bg: string }> = {
  desexed: { icon: '✂️', bg: palette.aegean100 },
  adopted: { icon: '🏠', bg: palette.bougain100 },
  general: { icon: '📣', bg: palette.olive100 },
  discovered: { icon: '📍', bg: palette.sun100 },
};

/** 📖 Story (spec §5): "{name}'s story", the care timeline exactly as it was. */
export function StoryTab({
  catName,
  careTimeline,
  onReport,
}: {
  catName: string;
  careTimeline: CareEvent[];
  onReport: () => void;
}) {
  const colors = useColors();
  const quiet = useQuietColor();
  const { t, language } = useLanguage();
  return (
    <View style={styles.stack}>
      <Text role="heading" style={[styles.eyebrow, { color: quiet }]}>
        {t('careTimelineTitle').split('{name}').join(catName)}
      </Text>
      {careTimeline.map((event, index) => {
        // An unknown type (older/newer server, or a leaked `sighting` row)
        // must not take the whole screen down.
        const meta = CARE_META[event.type] ?? CARE_META.general;
        return (
          <View key={index} style={styles.careRow}>
            <View aria-hidden accessibilityElementsHidden importantForAccessibility="no" style={[styles.careIcon, { backgroundColor: meta.bg }]}>
              <Text aria-hidden accessibilityElementsHidden importantForAccessibility="no" style={{ fontSize: 14 }}>
                {meta.icon}
              </Text>
            </View>
            <Text style={[styles.careText, { color: colors.foreground }]}>
              {event.type === 'discovered' ? (
                <>
                  <Text style={styles.careBold}>{t('careTypeDiscoveredPrefix')}</Text>{' '}
                  {/* SYC-235: no name means the discoverer deleted their data. */}
                  {event.message ?? t('aSpotter')}
                </>
              ) : (
                <>
                  <Text style={styles.careBold}>
                    {t(
                      event.type === 'desexed'
                        ? 'careTypeDesexed'
                        : event.type === 'adopted'
                          ? 'careTypeAdopted'
                          : 'careTypeGeneral',
                    )}
                  </Text>{' '}
                  · {event.message}
                </>
              )}
            </Text>
            <Text style={[styles.careDate, { color: quiet }]}>{formatMonthYear(event.at, language)}</Text>
          </View>
        );
      })}
      <ReportIssueLink onPress={onReport} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 11 },
  eyebrow: {
    fontSize: fontSizes['2xs'],
    fontFamily: fonts.bodyBold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  careRow: { flexDirection: 'row', gap: 11, alignItems: 'center' },
  careIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  careText: { flex: 1, fontSize: fontSizes.xs + 0.5, fontFamily: fonts.body },
  careBold: { fontFamily: fonts.bodyBold },
  careDate: { fontSize: fontSizes['3xs'], fontFamily: fonts.mono },
});
