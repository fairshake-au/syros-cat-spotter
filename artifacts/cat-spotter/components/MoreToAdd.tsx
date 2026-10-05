import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useQueryClient } from '@tanstack/react-query';
import {
  answerSightingQuestions,
  getGetMyOpenSightingsQueryKey,
  useGetMyOpenSightings,
  type OpenSighting,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { SightingQuestions } from '@/components/SightingQuestions';
import { Button } from '@/components/purropolis';
import { addLaterRequest, earTipAnswerLabel, moreToAddHeadline } from '@/lib/moreToAdd';
import { classifyAnswersError, NO_ANSWERS, type SightingAnswers } from '@/lib/sightingAnswers';
import { registerModalOpen } from '@/lib/modalVisibility';
import { photoSource } from '@/lib/urls';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';

/**
 * "You spotted Agatha on 3 October. Anything to add?" (SYC-117 part 2,
 * docs/specs/add-details-later.md §3). Only for someone who photographed
 * this cat in the last month and still has something to add; only with
 * signal, because it asks the server what's still open. Everything added is
 * tied to that sighting's photo and date.
 */
export function MoreToAdd({ catId, catName }: { catId: number; catName: string }) {
  const colors = useColors();
  const { t } = useLanguage();
  const { deviceId } = useDevice();
  const { isOnline } = useOffline();
  const [openSighting, setOpenSighting] = useState<OpenSighting | null>(null);

  const query = useGetMyOpenSightings(deviceId ?? '', catId, {
    query: {
      enabled: !!deviceId && isOnline && Number.isFinite(catId),
      queryKey: getGetMyOpenSightingsQueryKey(deviceId ?? '', catId),
    },
  });
  const data = query.data;
  if (!deviceId || !isOnline || !data || data.sightings.length === 0) return null;

  return (
    <View
      testID="more-to-add"
      style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.card }]}
    >
      <Text style={[styles.headline, { color: colors.foreground }]}>
        {moreToAddHeadline(
          catName,
          data.sightings.map((s) => s.takenAt),
          t,
        )}{' '}
        {t('moreToAddAsk')}
      </Text>
      {data.sightings.map((s) => (
        <View key={s.sightingId} style={styles.row}>
          {s.photoUrl ? (
            <Image
              source={photoSource(s.photoUrl)}
              style={[styles.thumb, { borderColor: colors.border }]}
              contentFit="cover"
            />
          ) : null}
          <Text style={[styles.date, { color: colors.mutedForeground }]}>
            {new Date(s.takenAt).toLocaleDateString()}
          </Text>
          <Button variant="primary" size="sm" onPress={() => setOpenSighting(s)}>
            {t('moreToAddButton')}
          </Button>
        </View>
      ))}
      {openSighting ? (
        <MoreToAddSheet
          catId={catId}
          catName={catName}
          deviceId={deviceId}
          sighting={openSighting}
          earTip={data.earTip}
          onClose={() => setOpenSighting(null)}
        />
      ) : null}
    </View>
  );
}

function MoreToAddSheet({
  catId,
  catName,
  deviceId,
  sighting,
  earTip,
  onClose,
}: {
  catId: number;
  catName: string;
  deviceId: string;
  sighting: OpenSighting;
  earTip: Parameters<typeof addLaterRequest>[2];
  onClose: () => void;
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<SightingAnswers>(NO_ANSWERS);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  // Keep the Home Screen nudge from floating over this sheet (SYC-134).
  useEffect(() => registerModalOpen(), []);

  const done = () => {
    queryClient.invalidateQueries({ queryKey: getGetMyOpenSightingsQueryKey(deviceId, catId) });
    onClose();
  };

  const send = async () => {
    const body = addLaterRequest(deviceId, answers, earTip);
    if (!body) {
      onClose();
      return;
    }
    setSending(true);
    setFailed(false);
    try {
      await answerSightingQuestions(sighting.sightingId, body);
      done();
    } catch (err) {
      setSending(false);
      // "Already answered" or "checked" means there's nothing to retry: the
      // card refreshes and shows what's really left.
      if (classifyAnswersError(err) === 'retry') setFailed(true);
      else done();
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <Text style={[styles.headline, { color: colors.foreground }]}>
              {t('moreToAddSheetTitle').replace(
                '{date}',
                new Date(sighting.takenAt).toLocaleDateString(),
              )}
            </Text>
            {sighting.photoUrl ? (
              <Image
                source={photoSource(sighting.photoUrl)}
                style={[styles.photo, { borderColor: colors.border }]}
                contentFit="cover"
              />
            ) : null}
            <SightingQuestions
              catName={catName}
              askEarTip
              earTipState={earTip.state}
              currentEarTipLabel={earTip.current ? earTipAnswerLabel(earTip.current, t) : undefined}
              show={sighting.open}
              answers={answers}
              onChange={(patch) => setAnswers((prev) => ({ ...prev, ...patch }))}
              t={t}
            />
            {failed ? (
              <Text style={[styles.error, { color: colors.destructive }]}>{t('answersFailed')}</Text>
            ) : null}
            <Button variant="primary" size="lg" block disabled={sending} onPress={send}>
              {sending ? '…' : t('answersSend')}
            </Button>
            <Button variant="ghost" size="md" onPress={onClose}>
              {t('cancel')}
            </Button>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: radii.lg, padding: spacing[4], gap: spacing[2] },
  headline: { fontSize: fontSizes.sm, fontFamily: fonts.displayBold },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  thumb: { width: 44, height: 44, borderRadius: radii.sm, borderWidth: 1 },
  date: { flex: 1, fontSize: fontSizes.xs, fontFamily: fonts.body },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '90%',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  sheetBody: { padding: spacing[5], gap: spacing[3] },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radii.md, borderWidth: 1 },
  error: { fontSize: fontSizes.xs, fontFamily: fonts.body, textAlign: 'center' },
});
