import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createSighting } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { useLocation } from '@/hooks/useLocation';
import { photoRejectionKey } from '@/lib/photoRejection';
import { OfflineBanner } from '@/components/OfflineBanner';
import { LocationPicker } from '@/components/LocationPicker';
import { useOfflineTiles } from '@/lib/offlineTiles';
import { SightingPhoto } from '@/components/SightingPhoto';

interface PickedPhoto {
  uri: string;
  base64: string;
}

// The server accepts native HEIC/HEIF (plus JPEG/PNG/WebP) and normalizes
// everything to JPEG itself, so photos are uploaded as captured — no
// on-device JPEG re-encode. `shrink` remains only as a fallback for assets
// the picker couldn't return base64 for, or that are too big to upload raw
// (the server rejects inputs over 20 MB).
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

async function shrink(uri: string): Promise<PickedPhoto> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 900 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  return { uri: result.uri, base64: result.base64 ?? '' };
}

async function toPickedPhoto(
  asset: ImagePicker.ImagePickerAsset,
): Promise<PickedPhoto> {
  // base64 length * 3/4 ≈ decoded byte size.
  if (asset.base64 && asset.base64.length * 0.75 <= MAX_UPLOAD_BYTES) {
    return { uri: asset.uri, base64: asset.base64 };
  }
  return shrink(asset.uri);
}

export default function SpotScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { deviceId } = useDevice();
  const { isOnline, pending, enqueue, remove, retry, syncNow, syncing } =
    useOffline();
  const { coords, denied, loading: locating, refresh } = useLocation();
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The location the user confirms on the map (initialized from GPS).
  const [pickedCoords, setPickedCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const tiles = useOfflineTiles();

  React.useEffect(() => {
    if (photo && coords && !pickedCoords) {
      setPickedCoords({ latitude: coords.latitude, longitude: coords.longitude });
    }
  }, [photo, coords, pickedCoords]);

  const clearPhoto = () => {
    setPhoto(null);
    setPickedCoords(null);
  };

  const pickPhoto = async (fromCamera: boolean) => {
    try {
      if (fromCamera && Platform.OS !== 'web') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 1, base64: true })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 1,
            base64: true,
            // Hand over the library asset in its native representation
            // (HEIC on iPhones) instead of transcoding to JPEG on-device.
            preferredAssetRepresentationMode:
              ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
          });
      if (!result.canceled && result.assets[0]) {
        setPhoto(await toPickedPhoto(result.assets[0]));
      }
    } catch {
      Alert.alert(t('error'));
    }
  };

  const submit = async () => {
    // Require the explicitly confirmed location — never raw GPS.
    const finalCoords = pickedCoords;
    if (!photo || !finalCoords || !deviceId) return;
    if (!isOnline) {
      await enqueue({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        photoBase64: photo.base64,
        photoUri: photo.uri,
        lat: finalCoords.latitude,
        lng: finalCoords.longitude,
        createdAt: new Date().toISOString(),
      });
      clearPhoto();
      Alert.alert(t('queuedOffline'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await createSighting({
        deviceId,
        photoBase64: photo.base64,
        lat: finalCoords.latitude,
        lng: finalCoords.longitude,
      });
      clearPhoto();
      router.push({
        pathname: '/review',
        params: {
          data: JSON.stringify({
            sightingId: result.sightingId,
            isCatPhoto: result.isCatPhoto,
            candidates: result.candidates,
            photoUri: photo.uri,
          }),
        },
      });
    } catch (err) {
      const rejectionKey = photoRejectionKey(err);
      if (rejectionKey) {
        Alert.alert(t('photoRejectedTitle'), t(rejectionKey));
      } else {
        Alert.alert(t('error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reviewPending = (item: (typeof pending)[number]) => {
    router.push({
      pathname: '/review',
      params: {
        data: JSON.stringify({
          sightingId: item.sightingId,
          isCatPhoto: item.isCatPhoto,
          candidates: item.candidates ?? [],
          photoUri: item.photoUri,
          localId: item.localId,
        }),
      },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t('spotTitle')}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {t('spotSubtitle')}
        </Text>
      </View>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 16,
          paddingBottom: insets.bottom + (Platform.OS === 'web' ? 110 : 100),
        }}
      >
        {photo ? (
          <View style={styles.previewWrap}>
            <Image
              source={{ uri: photo.uri }}
              style={[styles.preview, { borderColor: colors.border }]}
              contentFit="cover"
            />
            <Pressable
              onPress={clearPhoto}
              style={[styles.smallBtn, { backgroundColor: colors.secondary }]}
            >
              <Feather
                name="refresh-ccw"
                size={15}
                color={colors.secondaryForeground}
              />
              <Text
                style={[styles.smallBtnText, { color: colors.secondaryForeground }]}
              >
                {t('retake')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.pickRow}>
            {Platform.OS !== 'web' && (
              <Pressable
                onPress={() => pickPhoto(true)}
                style={[styles.pickBtn, { backgroundColor: colors.primary }]}
              >
                <Feather name="camera" size={22} color={colors.primaryForeground} />
                <Text
                  style={[styles.pickBtnText, { color: colors.primaryForeground }]}
                >
                  {t('takePhoto')}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => pickPhoto(false)}
              style={[
                styles.pickBtn,
                {
                  backgroundColor:
                    Platform.OS === 'web' ? colors.primary : colors.secondary,
                },
              ]}
            >
              <Feather
                name="image"
                size={22}
                color={
                  Platform.OS === 'web'
                    ? colors.primaryForeground
                    : colors.secondaryForeground
                }
              />
              <Text
                style={[
                  styles.pickBtnText,
                  {
                    color:
                      Platform.OS === 'web'
                        ? colors.primaryForeground
                        : colors.secondaryForeground,
                  },
                ]}
              >
                {t('chooseFromLibrary')}
              </Text>
            </Pressable>
          </View>
        )}

        {denied && (
          <Pressable onPress={refresh}>
            <Text style={[styles.denied, { color: colors.destructive }]}>
              {t('locationDenied')}
            </Text>
          </Pressable>
        )}
        {locating && !coords && (
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {t('locating')}
          </Text>
        )}

        {photo && pickedCoords && (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {t('confirmLocation')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {t('confirmLocationHint')}
            </Text>
            <LocationPicker
              latitude={pickedCoords.latitude}
              longitude={pickedCoords.longitude}
              onChange={setPickedCoords}
              pinColor={colors.accent}
              style={styles.locationPicker}
            />
            {tiles.downloading && (
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                {t('mapDownloading').replace(
                  '{pct}',
                  String(Math.round(tiles.progress * 100)),
                )}
              </Text>
            )}
          </View>
        )}

        <Pressable
          onPress={submit}
          disabled={!photo || !pickedCoords || submitting || !deviceId}
          style={[
            styles.submitBtn,
            {
              backgroundColor: colors.accent,
              opacity: !photo || !pickedCoords || submitting ? 0.5 : 1,
            },
          ]}
        >
          {submitting ? (
            <>
              <ActivityIndicator color={colors.accentForeground} size="small" />
              <Text
                style={[styles.submitText, { color: colors.accentForeground }]}
              >
                {t('submitting')}
              </Text>
            </>
          ) : (
            <>
              <Feather name="send" size={18} color={colors.accentForeground} />
              <Text
                style={[styles.submitText, { color: colors.accentForeground }]}
              >
                {t('submitSighting')}
              </Text>
            </>
          )}
        </Pressable>

        {pending.length > 0 && (
          <View style={{ gap: 10 }}>
            <View style={styles.pendingHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                {t('pendingSightings')}
              </Text>
              {isOnline && (
                <Pressable onPress={syncNow} disabled={syncing}>
                  <Text style={[styles.syncText, { color: colors.primary }]}>
                    {syncing ? '…' : t('syncNow')}
                  </Text>
                </Pressable>
              )}
            </View>
            {pending.map((item) => (
              <Pressable
                key={item.localId}
                onPress={() => item.status === 'review' && reviewPending(item)}
                style={[
                  styles.pendingItem,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <SightingPhoto
                  uri={item.photoUri}
                  base64={item.photoBase64}
                  style={styles.pendingThumb}
                  contentFit="cover"
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.pendingStatus,
                      {
                        color:
                          item.status === 'review'
                            ? colors.accent
                            : item.status === 'error' ||
                                item.status === 'rejected'
                              ? colors.destructive
                              : colors.mutedForeground,
                      },
                    ]}
                  >
                    {item.status === 'review'
                      ? t('needsReview')
                      : item.status === 'error'
                        ? item.errorKind === 'stale'
                          ? t('syncFailedStale')
                          : t('syncFailedServer')
                        : item.status === 'rejected'
                          ? t('photoRejectedTitle')
                          : t('queued')}
                  </Text>
                  {item.status === 'rejected' && (
                    <Text
                      style={[
                        styles.pendingDate,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {t(item.rejectionKey ?? 'photoRejectedQueued')}
                    </Text>
                  )}
                  <Text
                    style={[styles.pendingDate, { color: colors.mutedForeground }]}
                  >
                    {new Date(item.createdAt).toLocaleString()}
                  </Text>
                  {item.status === 'error' && (
                    <View style={styles.errorActions}>
                      {item.errorKind !== 'stale' && (
                        <Pressable
                          onPress={() => retry(item.localId)}
                          disabled={syncing || !isOnline}
                          style={[
                            styles.errorBtn,
                            {
                              backgroundColor: colors.secondary,
                              opacity: syncing || !isOnline ? 0.5 : 1,
                            },
                          ]}
                        >
                          <Feather
                            name="refresh-ccw"
                            size={13}
                            color={colors.secondaryForeground}
                          />
                          <Text
                            style={[
                              styles.errorBtnText,
                              { color: colors.secondaryForeground },
                            ]}
                          >
                            {t('retrySync')}
                          </Text>
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() => remove(item.localId)}
                        style={[
                          styles.errorBtn,
                          { backgroundColor: colors.destructive },
                        ]}
                      >
                        <Feather
                          name="trash-2"
                          size={13}
                          color={colors.destructiveForeground ?? '#fff'}
                        />
                        <Text
                          style={[
                            styles.errorBtnText,
                            { color: colors.destructiveForeground ?? '#fff' },
                          ]}
                        >
                          {t('discard')}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
                {item.status === 'review' ? (
                  <Feather
                    name="chevron-right"
                    size={18}
                    color={colors.mutedForeground}
                  />
                ) : item.status === 'queued' ? (
                  <Pressable onPress={() => remove(item.localId)} hitSlop={8}>
                    <Feather name="x" size={16} color={colors.mutedForeground} />
                  </Pressable>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 10, gap: 4 },
  title: { fontSize: 22, fontFamily: 'Poppins_700Bold' },
  subtitle: { fontSize: 13, fontFamily: 'Nunito_400Regular' },
  pickRow: { gap: 12 },
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
  },
  pickBtnText: { fontSize: 16, fontFamily: 'Nunito_700Bold' },
  previewWrap: { gap: 10 },
  preview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    borderWidth: 1,
  },
  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 12,
  },
  smallBtnText: { fontSize: 14, fontFamily: 'Nunito_600SemiBold' },
  locationPicker: { height: 260 },
  denied: { fontSize: 13, fontFamily: 'Nunito_600SemiBold' },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
  },
  submitText: { fontSize: 16, fontFamily: 'Nunito_700Bold' },
  pendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontSize: 16, fontFamily: 'Nunito_700Bold' },
  syncText: { fontSize: 13, fontFamily: 'Nunito_700Bold' },
  pendingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  pendingThumb: { width: 48, height: 48, borderRadius: 10 },
  pendingStatus: { fontSize: 13, fontFamily: 'Nunito_700Bold' },
  pendingDate: { fontSize: 12, fontFamily: 'Nunito_400Regular', marginTop: 2 },
  errorActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  errorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  errorBtnText: { fontSize: 12, fontFamily: 'Nunito_700Bold' },
});
