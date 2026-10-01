import React from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { telHref, type WelfareGuidance } from '@workspace/welfare-guidance';
import { useColors } from '@/hooks/useColors';
import { fonts, radii, spacing } from '@/constants/theme';

/**
 * The vets on Syros (spec §5.7; SYC-42 plan item 1.10). Each clinic with a
 * tap-to-call link per labelled number (after-hours labelled as the clinic's
 * own published number, promising nothing), its area and landmark, Google and
 * Apple map buttons, and how accurate the pin is. Read from the guidance
 * file, never from translated copy, so a number is fixed in one place.
 */
function ExternalLink({
  href,
  children,
  style,
  label,
}: {
  href: string;
  children: React.ReactNode;
  style?: object;
  label: string;
}) {
  // On the web a real <a href> (react-native-web renders `href`), so tel:
  // and map links work with the browser's own handling.
  if (Platform.OS === 'web') {
    return (
      <Text
        // @ts-expect-error react-native-web supports href on Text
        href={href}
        hrefAttrs={href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : undefined}
        accessibilityRole="link"
        accessibilityLabel={label}
        style={style}
      >
        {children}
      </Text>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => void Linking.openURL(href).catch(() => undefined)}
      style={style}
    >
      {children}
    </Pressable>
  );
}

export function VetList({ guidance }: { guidance: WelfareGuidance }) {
  const colors = useColors();
  const { copy, vets, municipality, language } = guidance;
  const v = copy.vetList;

  return (
    <View style={styles.list}>
      {vets.map((clinic) => (
        <View
          key={clinic.id}
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={[styles.name, { color: colors.foreground }]}>{clinic.name}</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {clinic.area} · {clinic.landmark[language]}
          </Text>
          {clinic.phones.map((phone) => (
            <ExternalLink
              key={phone.tel}
              href={telHref(phone)}
              label={`${v.call} ${clinic.name}: ${phone.display}`}
              style={[styles.phoneRow, { borderColor: colors.border }]}
            >
              <Text style={[styles.phoneNumber, { color: colors.primary }]}>
                <Feather name="phone" size={14} color={colors.primary} /> {phone.display}
              </Text>
              <Text style={[styles.phoneKind, { color: colors.mutedForeground }]}>
                {'  '}
                {v.phoneKinds[phone.kind]}
              </Text>
            </ExternalLink>
          ))}
          <View style={styles.mapRow}>
            <ExternalLink
              href={clinic.googleMapsUrl}
              label={`${v.googleMaps}: ${clinic.name}`}
              style={[styles.mapButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.mapText, { color: colors.primary }]}>{v.googleMaps}</Text>
            </ExternalLink>
            <ExternalLink
              href={clinic.appleMapsUrl}
              label={`${v.appleMaps}: ${clinic.name}`}
              style={[styles.mapButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.mapText, { color: colors.primary }]}>{v.appleMaps}</Text>
            </ExternalLink>
          </View>
          <Text style={[styles.pin, { color: colors.mutedForeground }]}>
            {clinic.pin === 'landmark' ? v.pinLandmark : v.pinSearch}
          </Text>
        </View>
      ))}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>{v.municipalityHeading}</Text>
        <Text style={[styles.name, { color: colors.foreground }]}>{municipality.name[language]}</Text>
        <ExternalLink
          href={telHref(municipality.phone)}
          label={`${v.call} ${municipality.name[language]}: ${municipality.phone.display}`}
          style={[styles.phoneRow, { borderColor: colors.border }]}
        >
          <Text style={[styles.phoneNumber, { color: colors.primary }]}>
            <Feather name="phone" size={14} color={colors.primary} /> {municipality.phone.display}
          </Text>
        </ExternalLink>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing[2] },
  card: { borderWidth: 1, borderRadius: radii.md, padding: spacing[3], gap: 6 },
  name: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  phoneRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
  phoneNumber: { fontFamily: fonts.bodyBold, fontSize: 16 },
  phoneKind: { fontFamily: fonts.body, fontSize: 13 },
  mapRow: { flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' },
  mapButton: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  mapText: { fontFamily: fonts.bodySemiBold, fontSize: 13 },
  pin: { fontFamily: fonts.body, fontSize: 12, fontStyle: 'italic' },
});
