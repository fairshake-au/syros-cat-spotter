import React from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { telHref, type WelfareGuidance } from '@workspace/welfare-guidance';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { formatKm, orderVets, type LatLng } from '@/lib/vetOrder';
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
  block = false,
}: {
  href: string;
  children: React.ReactNode;
  style?: object;
  label: string;
  /** Lay the children out as a block (a column), not as inline text. */
  block?: boolean;
}) {
  // On the web a real <a href> (react-native-web renders `href`), so tel:
  // and map links work with the browser's own handling.
  if (Platform.OS === 'web' && block) {
    return (
      <View
        // @ts-expect-error react-native-web supports href on View
        href={href}
        accessibilityRole="link"
        accessibilityLabel={label}
        style={style}
      >
        {children}
      </View>
    );
  }
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

/** The Municipality's tap-to-call card (spec §5.7). */
export function MunicipalityCard({ guidance }: { guidance: WelfareGuidance }) {
  const colors = useColors();
  const { copy, municipality, language } = guidance;
  const v = copy.vetList;
  return (
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
  );
}

/**
 * The vet cards inside the report (SYC-570; Samuel, 24 Oct 2026). The same
 * card as the Help tab, tightened to about 150px so all three clinics fit one
 * phone screen: name, area, each labelled number as a big tap-to-call button,
 * both map links, and how accurate the pin is. Every required piece stays
 * (after-hours labelled as the clinic's published number). The Municipality
 * sits in the "Who pays, and who to call" fold instead.
 *
 * When the phone's position is known the nearest clinic comes first and says
 * so ("Closest to you · about 1.2 km"); every other clinic shows its
 * distance. With no position the fixed order is kept and nothing is tagged
 * (lib/vetOrder.ts).
 */
function ReportVetCards({
  guidance,
  from,
  heading,
}: {
  guidance: WelfareGuidance;
  from: LatLng | null;
  heading: string;
}) {
  const colors = useColors();
  const { t, language } = useLanguage();
  const v = guidance.copy.vetList;
  const ordered = orderVets(guidance.vets, from);
  const measured = ordered.some((o) => o.closest);
  // Greek and French write the decimal with a comma.
  const km = (n: number) => (language === 'en' ? formatKm(n) : formatKm(n).replace('.', ','));
  return (
    <View style={tight.list}>
      <Text role="heading" style={[tight.heading, { color: colors.foreground }]}>
        {measured ? t('reportVetsClosest') : heading}
      </Text>
      {ordered.map(({ clinic, km: away, closest }) => {
        const tag = [
          closest ? t('reportClosestToYou') : null,
          away !== null ? t('reportVetDistance').replace('{km}', km(away)) : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <View
            key={clinic.id}
            testID={closest ? 'vet-closest' : undefined}
            style={[
              tight.card,
              { backgroundColor: colors.card, borderColor: closest ? colors.success : colors.border },
              closest && { borderWidth: 2 },
            ]}
          >
            {tag ? (
              <View style={[tight.tag, { backgroundColor: closest ? colors.successSoft : colors.muted }]}>
                <Text style={[tight.tagText, { color: closest ? colors.success : colors.mutedForeground }]}>{tag}</Text>
              </View>
            ) : null}
            <Text style={[tight.name, { color: colors.foreground }]}>{clinic.name}</Text>
            <Text style={[tight.meta, { color: colors.mutedForeground }]}>{clinic.area}</Text>
            <View style={tight.phones}>
              {clinic.phones.map((phone) => (
                <ExternalLink
                  key={phone.tel}
                  block
                  href={telHref(phone)}
                  label={`${v.call} ${clinic.name}: ${phone.display} (${v.phoneKinds[phone.kind]})`}
                  style={[tight.phone, { backgroundColor: colors.secondary }]}
                >
                  {/* Never truncated: a number someone may dial by hand must be whole. */}
                  <Text style={[tight.number, { color: colors.primary }]}>
                    <Feather name="phone" size={12} color={colors.primary} /> {phone.display}
                  </Text>
                  <Text style={[tight.kind, { color: colors.mutedForeground }]}>{v.phoneKindsShort[phone.kind]}</Text>
                </ExternalLink>
              ))}
            </View>
            <View style={tight.maps}>
              <ExternalLink
                href={clinic.googleMapsUrl}
                label={`${v.googleMaps}: ${clinic.name}`}
                style={[tight.mapButton, { borderColor: colors.border }]}
              >
                <Text style={[tight.mapText, { color: colors.primary }]}>{v.googleMaps}</Text>
              </ExternalLink>
              <ExternalLink
                href={clinic.appleMapsUrl}
                label={`${v.appleMaps}: ${clinic.name}`}
                style={[tight.mapButton, { borderColor: colors.border }]}
              >
                <Text style={[tight.mapText, { color: colors.primary }]}>{v.appleMaps}</Text>
              </ExternalLink>
            </View>
            {/* Only the clinic without a landmark pin says so on its card. */}
            {clinic.pin === 'search' && (
              <Text style={[tight.note, { color: colors.mutedForeground }]}>{v.pinSearch}</Text>
            )}
          </View>
        );
      })}
      <Text style={[tight.note, { color: colors.mutedForeground }]}>
        {v.pinLandmark} {v.publishedNote}
      </Text>
    </View>
  );
}

export function VetList({
  guidance,
  compact: isCompact = false,
  from = null,
  heading,
}: {
  guidance: WelfareGuidance;
  /** The tightened report cards (SYC-570), nearest first when `from` is known. */
  compact?: boolean;
  /** The phone's own position, for "closest first". The Help tab never passes it. */
  from?: LatLng | null;
  /** The list's heading (compact only); "closest first" replaces it when the phone's position is known. */
  heading?: string;
}) {
  const colors = useColors();
  const { copy, vets, language } = guidance;
  const v = copy.vetList;
  if (isCompact) return <ReportVetCards guidance={guidance} from={from} heading={heading ?? guidance.copy.urgent.vetListHeading} />;

  return (
    <View style={styles.list}>
      {vets.map((clinic) => (
        <View
          key={clinic.id}
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={[styles.name, { color: colors.foreground }]}>{clinic.name}</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {/* A landmark is only published for the clinics opposite a petrol station. */}
            {clinic.pin === 'landmark' ? `${clinic.area} · ${clinic.landmark[language]}` : clinic.area}
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
            {clinic.pin === 'search' ? v.pinSearch : v.pinLandmark}
          </Text>
        </View>
      ))}
      <MunicipalityCard guidance={guidance} />
    </View>
  );
}

const tight = StyleSheet.create({
  list: { gap: 6 },
  heading: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 18 },
  card: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 9, gap: 4 },
  tag: { alignSelf: 'flex-start', borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 2 },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 12, lineHeight: 16 },
  name: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17 },
  // Two big buttons side by side; on a 320px phone they stack so a number is never cut.
  phones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  phone: {
    flexGrow: 1,
    flexBasis: 156,
    minHeight: 48,
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  number: { fontFamily: fonts.bodyBold, fontSize: 13, lineHeight: 18 },
  kind: { fontFamily: fonts.body, fontSize: 12, lineHeight: 15 },
  maps: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mapButton: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5, minHeight: 30, justifyContent: 'center' },
  mapText: { fontFamily: fonts.bodySemiBold, fontSize: 12 },
  note: { fontFamily: fonts.body, fontSize: 11, lineHeight: 14 },
});

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
