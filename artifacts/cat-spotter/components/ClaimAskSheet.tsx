import React, { useEffect } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { CONTACT_EMAIL } from '@/lib/contactMail';
import { registerModalOpen } from '@/lib/modalVisibility';
import { Button } from '@/components/purropolis/Button';
import { fonts, spacing } from '@/constants/theme';

/**
 * The quiet text link that opens the sheet (§1.1): the same style as "Report
 * an issue", a 44pt tap height, role "button", labelled with its own text.
 * `linkRef` lets the cat page hand focus back here when the sheet closes.
 */
export const ClaimAskLink = React.forwardRef<
  View,
  { catName: string; onPress: () => void }
>(function ClaimAskLink({ catName, onPress }, ref) {
  const colors = useColors();
  const { t } = useLanguage();
  const label = t('claimAskLink').split('{name}').join(catName);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={styles.link}
      testID="claim-ask-link"
    >
      <Text style={[styles.linkText, { color: colors.mutedForeground }]}>{label}</Text>
    </Pressable>
  );
});

export type ClaimAskMode = 'street' | 'homed';

/**
 * "Does {name} live with you?" (design-review-fixes-oct22.md §1.2). A small
 * sheet that changes nothing on the server and needs no connection. Street
 * cats get the "spot first" text; cats with a home get the "email us" text.
 *
 * In "homed" mode the address inside the sentence is selectable text and a
 * mailto link, as on the Help tab. Who reads that inbox is unchecked (SYC-30).
 *
 * Focus: the Modal covers the screen behind it (iOS `accessibilityViewIsModal`,
 * the web's `role="dialog"` + `aria-modal`, and react-native-web's own focus
 * trap), and the cat page returns focus to the link when it closes.
 */
export function ClaimAskSheet({
  mode,
  catName,
  onClose,
}: {
  mode: ClaimAskMode;
  catName: string;
  onClose: () => void;
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  // Keep the Home Screen nudge from floating over this (SYC-134).
  useEffect(() => registerModalOpen(), []);

  // The cat's name, never "he" or "she".
  const named = (key: string) => t(key).split('{name}').join(catName);
  const bodyStyle = [styles.body, { color: colors.foreground }];

  const openMail = () => {
    Linking.openURL(`mailto:${CONTACT_EMAIL}`).catch(() => {});
  };

  let body: React.ReactNode;
  if (mode === 'homed') {
    const [before, ...rest] = named('claimAskHomed').split(CONTACT_EMAIL);
    body = (
      <Text selectable testID="claim-ask-body" style={bodyStyle}>
        {before}
        <Text
          role="link"
          accessibilityRole="link"
          testID="claim-ask-mailto"
          onPress={openMail}
          style={[styles.address, { color: colors.primary }]}
        >
          {CONTACT_EMAIL}
        </Text>
        {rest.join(CONTACT_EMAIL)}
      </Text>
    );
  } else {
    body = (
      <Text testID="claim-ask-body" style={bodyStyle}>
        {named('claimAskStreet')}
      </Text>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop} testID="claim-ask-sheet" accessibilityViewIsModal>
        <Pressable
          testID="claim-ask-backdrop"
          accessible={false}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View
          role="dialog"
          aria-modal
          aria-label={named('claimAskTitle')}
          style={[
            styles.sheet,
            { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text role="heading" style={[styles.title, { color: colors.foreground }]}>
            {named('claimAskTitle')}
          </Text>
          {body}
          <Button variant="secondary" size="lg" block testID="claim-ask-close" onPress={onClose}>
            {t('claimAskClose')}
          </Button>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  linkText: { fontFamily: fonts.body, fontSize: 13, textDecorationLine: 'underline' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: spacing[3],
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  title: { fontFamily: fonts.bodyBold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  address: { textDecorationLine: 'underline', fontFamily: fonts.bodySemiBold },
});
