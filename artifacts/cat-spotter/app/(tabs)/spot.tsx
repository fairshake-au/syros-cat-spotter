import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  CameraView,
  useCameraPermissions,
  type CameraCapturedPicture,
} from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createSighting } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import {
  optimizePhotoForUpload,
} from '@/lib/photoUpload';
import { useLocation } from '@/hooks/useLocation';
import { photoRejectionKey } from '@/lib/photoRejection';
import { OfflineBanner } from '@/components/OfflineBanner';
import { LocationPicker } from '@/components/LocationPicker';
import { useOfflineTiles } from '@/lib/offlineTiles';
import { SightingPhoto } from '@/components/SightingPhoto';
import { Button } from '@/components/purropolis/Button';
import { IconButton } from '@/components/purropolis/IconButton';
import { Card } from '@/components/purropolis/Card';
import { Badge } from '@/components/purropolis/Badge';
import { fonts, fontSizes, radii, spacing, shadows } from '@/constants/theme';
import {
  cameraCaptureToPhoto,
  getCameraMode,
  shutterKindFor,
} from '@/lib/cameraMode';

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
  const {
    isOnline,
    isConstrainedNetwork,
    pending,
    enqueue,
    remove,
    retry,
    replacePhoto,
    syncNow,
    syncing,
  } =
    useOffline();
  const { coords, denied, loading: locating, refresh } = useLocation();
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  // Stamped when the photo is picked. Submitting can happen minutes later —
  // and across local midnight — so using submit time would put the sighting on
  // the wrong day for streak purposes.
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [optimizingUpload, setOptimizingUpload] = useState(false);
  const cameraRef = React.useRef<CameraView>(null);
  // `get: false` because we run the initial lookup ourselves: the hook's own
  // effect calls getPermissionsAsync() with no catch, and expo-camera's web
  // implementation *throws* when navigator.permissions.query is missing (older
  // Safari, and Android in-app WebViews — which is how testers arriving from an
  // email link get here). Unguarded, that leaves the permission null forever and
  // pins the screen to a spinner with no way to take a photo.
  const [
    cameraPermission,
    requestCameraPermission,
    refreshCameraPermission,
  ] = useCameraPermissions({ get: false });
  const [permissionLookupFailed, setPermissionLookupFailed] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const cameraState = getCameraMode(
    Platform.OS,
    cameraPermission,
    permissionLookupFailed,
  );
  const shutterKind = shutterKindFor(cameraState, cameraFailed, cameraActive);
  const liveCameraReady = shutterKind === 'live';

  useFocusEffect(
    React.useCallback(() => {
      setCameraActive(true);
      return () => setCameraActive(false);
    }, []),
  );

  React.useEffect(() => {
    let cancelled = false;
    refreshCameraPermission().catch(() => {
      if (!cancelled) setPermissionLookupFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshCameraPermission]);

  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshCameraPermission().catch(() =>
          setPermissionLookupFailed(true),
        );
      }
    });
    return () => subscription.remove();
  }, [refreshCameraPermission]);
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
    setCapturedAt(null);
    setPickedCoords(null);
  };

  const choosePhoto = async (
    fromCamera: boolean,
  ): Promise<PickedPhoto | null> => {
    try {
      if (fromCamera && Platform.OS !== 'web') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return null;
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
        return await toPickedPhoto(result.assets[0]);
      }
    } catch {
      Alert.alert(t('error'));
    }
    return null;
  };

  const pickPhoto = async (fromCamera: boolean) => {
    const picked = await choosePhoto(fromCamera);
    if (picked) {
      setPhoto(picked);
      setCapturedAt(new Date().toISOString());
    }
  };

  const captureLivePhoto = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const capture: CameraCapturedPicture | undefined =
        await cameraRef.current.takePictureAsync({
          quality: 1,
          base64: true,
        });
      if (!capture) throw new Error('Camera returned no photo');
      const directPhoto = cameraCaptureToPhoto(capture);
      const picked =
        directPhoto &&
        directPhoto.base64.length * 0.75 <= MAX_UPLOAD_BYTES
          ? directPhoto
          : await shrink(capture.uri);
      setPhoto(picked);
      setCapturedAt(new Date().toISOString());
    } catch {
      Alert.alert(t('cameraUnavailable'), t('cameraUnavailableHint'));
    } finally {
      setCapturing(false);
    }
  };

  const requestLiveCamera = async () => {
    try {
      await requestCameraPermission();
    } catch {
      // Requesting is unsupported in this browser — drop to the picker shutter
      // rather than leaving the user stuck on a permission panel.
      setPermissionLookupFailed(true);
      Alert.alert(t('cameraUnavailable'), t('cameraUnavailableHint'));
    }
  };

  const openCameraSettings = async () => {
    if (Platform.OS === 'web') {
      Alert.alert(t('cameraUnavailable'), t('browserCameraSettings'));
      return;
    }
    try {
      await Linking.openSettings();
    } catch {
      Alert.alert(t('cameraUnavailable'), t('cameraUnavailableHint'));
    }
  };

  const retryLiveCamera = () => {
    setCameraFailed(false);
    setCameraAttempt((n) => n + 1);
  };

  const replaceRejectedPhoto = async (
    localId: string,
    fromCamera: boolean,
  ) => {
    const picked = await choosePhoto(fromCamera);
    if (picked) {
      await replacePhoto(localId, {
        photoBase64: picked.base64,
        photoUri: picked.uri,
      });
    }
  };

  const offerPhotoReplacement = (localId: string) => {
    Alert.alert(t('replacePhoto'), t('replacePhotoHint'), [
      ...(Platform.OS === 'web'
        ? []
        : [
            {
              text: t('takePhoto'),
              onPress: () => void replaceRejectedPhoto(localId, true),
            },
          ]),
      {
        text: t('chooseFromLibrary'),
        onPress: () => void replaceRejectedPhoto(localId, false),
      },
      { text: t('cancel'), style: 'cancel' },
    ]);
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
        createdAt: capturedAt ?? new Date().toISOString(),
      });
      clearPhoto();
      Alert.alert(t('queuedOffline'));
      return;
    }
    setSubmitting(true);
    try {
      let uploadPhoto = photo;
      if (isConstrainedNetwork) {
        setOptimizingUpload(true);
        const optimizedBase64 = await optimizePhotoForUpload(photo.uri);
        if (optimizedBase64) {
          uploadPhoto = { ...photo, base64: optimizedBase64 };
        }
        setOptimizingUpload(false);
      }
      const result = await createSighting({
        deviceId,
        photoBase64: uploadPhoto.base64,
        lat: finalCoords.latitude,
        lng: finalCoords.longitude,
        // Capture time, not submit time, and sent on the online path too so a
        // sighting's day is decided the same way however it reached the server.
        capturedAt: capturedAt ?? new Date().toISOString(),
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
      setOptimizingUpload(false);
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

  // Short "📍 lat, lng" chip text — we have no reverse-geocoded place name,
  // so we show rounded coordinates instead of the design's mock "Vaporia".
  const locationChipText = pickedCoords
    ? `📍 ${pickedCoords.latitude.toFixed(3)}, ${pickedCoords.longitude.toFixed(3)}`
    : coords
      ? `📍 ${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`
      : locating
        ? `📍 ${t('locating')}`
        : null;

  const badgeToneForStatus = (
    status: (typeof pending)[number]['status'],
  ): 'success' | 'warning' | 'danger' | 'info' => {
    switch (status) {
      case 'review':
        return 'info';
      case 'error':
      case 'rejected':
        return 'danger';
      default:
        return 'warning';
    }
  };

  const pendingSection = pending.length > 0 && (
    <View style={{ gap: spacing[3] }}>
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
        <Card
          key={item.localId}
          padding={spacing[3]}
          onPress={
            item.status === 'review'
              ? () => reviewPending(item)
              : item.status === 'rejected'
                ? () => offerPhotoReplacement(item.localId)
                : undefined
          }
          style={styles.pendingItem}
        >
          <SightingPhoto
            uri={item.photoUri}
            base64={item.photoBase64}
            style={styles.pendingThumb}
            contentFit="cover"
          />
          <View style={{ flex: 1, gap: spacing[1] }}>
            <Badge tone={badgeToneForStatus(item.status)}>
              {item.status === 'review'
                ? t('needsReview')
                : item.status === 'error'
                  ? item.errorKind === 'stale'
                    ? t('syncFailedStale')
                    : t('syncFailedServer')
                  : item.status === 'rejected'
                    ? t('photoRejectedTitle')
                    : t('queued')}
            </Badge>
            {item.status === 'rejected' && (
              <>
                <Text
                  style={[styles.pendingDate, { color: colors.mutedForeground }]}
                >
                  {t(item.rejectionKey ?? 'photoRejectedQueued')}
                </Text>
                <Pressable
                  onPress={() => offerPhotoReplacement(item.localId)}
                  style={[styles.errorBtn, styles.replaceBtn, { backgroundColor: colors.secondary }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('replacePhoto')}
                  testID={`replace-photo-${item.localId}`}
                >
                  <Feather
                    name="camera"
                    size={13}
                    color={colors.secondaryForeground}
                  />
                  <Text
                    style={[
                      styles.errorBtnText,
                      { color: colors.secondaryForeground },
                    ]}
                  >
                    {t('replacePhoto')}
                  </Text>
                </Pressable>
              </>
            )}
            <Text style={[styles.pendingDate, { color: colors.mutedForeground }]}>
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
                  style={[styles.errorBtn, { backgroundColor: colors.destructive }]}
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
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          ) : item.status === 'queued' ? (
            <Pressable onPress={() => remove(item.localId)} hitSlop={8}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </Card>
      ))}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        {photo ? (
          <View style={styles.detailsHeaderRow}>
            <Pressable onPress={clearPhoto} hitSlop={8}>
              <Feather name="chevron-left" size={24} color={colors.mutedForeground} />
            </Pressable>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t('newSpotTitle')}
            </Text>
          </View>
        ) : (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t('spotTitle')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {t('spotSubtitle')}
            </Text>
          </>
        )}
      </View>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{
          padding: spacing[4],
          gap: spacing[4],
          paddingBottom: insets.bottom + (Platform.OS === 'web' ? 110 : 100),
        }}
      >
        {photo ? (
          // ── Details state: captured photo, location confirm, submit ──
          <>
            <View style={styles.detailsIntroRow}>
              <Image
                source={{ uri: photo.uri }}
                style={[styles.thumb, { borderColor: colors.border }]}
                contentFit="cover"
              />
              <View style={{ flex: 1, gap: spacing[1] }}>
                <Text style={[styles.niceShot, { color: colors.foreground }]}>
                  {t('niceShot')}
                </Text>
                <Text style={[styles.niceShotHint, { color: colors.mutedForeground }]}>
                  {t('addDetailsHint')}
                </Text>
                <Pressable onPress={clearPhoto}>
                  <Text style={[styles.addAnother, { color: colors.primary }]}>
                    {t('addAnotherPhoto')}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={{ gap: spacing[2] }}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                {t('whereDidYouSeeIt')}
              </Text>
              {locationChipText && (
                <View
                  style={[
                    styles.locationField,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.locationFieldText, { color: colors.foreground }]}>
                    {locationChipText}
                  </Text>
                </View>
              )}
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                {t('confirmLocationHint')}
              </Text>
              {denied && (
                <Pressable onPress={refresh}>
                  <Text style={[styles.denied, { color: colors.destructive }]}>
                    {t('locationDenied')}
                  </Text>
                </Pressable>
              )}
              {pickedCoords && (
                <LocationPicker
                  latitude={pickedCoords.latitude}
                  longitude={pickedCoords.longitude}
                  onChange={setPickedCoords}
                  pinColor={colors.accent}
                  style={styles.locationPicker}
                />
              )}
              {tiles.downloading && (
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                  {t('mapDownloading').replace(
                    '{pct}',
                    String(Math.round(tiles.progress * 100)),
                  )}
                </Text>
              )}
            </View>

            <Button
              variant="primary"
              size="lg"
              block
              disabled={!pickedCoords || submitting || !deviceId}
              onPress={submit}
              iconLeft={
                submitting ? (
                  <ActivityIndicator color={colors.primaryForeground} size="small" />
                ) : undefined
              }
            >
              {submitting
                ? optimizingUpload
                  ? t('optimizingPhoto')
                  : t('submitting')
                : t('checkForMatches')}
            </Button>
          </>
        ) : (
          // ── Capture state: dark viewfinder treatment ──
          <View style={[styles.viewfinder, shadows.md]}>
            {liveCameraReady ? (
              <CameraView
                key={cameraAttempt}
                ref={cameraRef}
                facing="back"
                mode="picture"
                style={StyleSheet.absoluteFillObject}
                testID="live-camera-view"
                onCameraReady={() => setCameraFailed(false)}
                onMountError={() => setCameraFailed(true)}
              />
            ) : (
              <LinearGradient
                colors={['#3a5266', '#1b2a38']}
                style={StyleSheet.absoluteFillObject}
              />
            )}
            {/* textAlignVertical is Android-only, so centre with flexbox or the
                stand-in rides the top edge on iOS and web. */}
            {(cameraState !== 'ready' || cameraFailed) && (
              <View style={styles.viewfinderEmojiWrap}>
                {cameraState === 'loading' ? (
                  <ActivityIndicator color="#fff" size="large" />
                ) : (
                  <>
                    <Text style={styles.viewfinderEmoji} pointerEvents="none">
                      🐈‍⬛
                    </Text>
                    {cameraFailed ? (
                      <View style={styles.cameraPermissionPanel}>
                        <Text style={styles.cameraPermissionText}>
                          {t('cameraUnavailableHint')}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          onPress={retryLiveCamera}
                          style={styles.cameraPermissionButton}
                          testID="retry-live-camera"
                        >
                          <Text style={styles.cameraPermissionButtonText}>
                            {t('tryAgain')}
                          </Text>
                        </Pressable>
                      </View>
                    ) : (cameraState === 'request' || cameraState === 'settings') && (
                      <View style={styles.cameraPermissionPanel}>
                        <Text style={styles.cameraPermissionText}>
                          {t('cameraPermissionHint')}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          onPress={
                            cameraState === 'settings'
                              ? openCameraSettings
                              : requestLiveCamera
                          }
                          style={styles.cameraPermissionButton}
                          testID={
                            cameraState === 'settings'
                              ? 'open-camera-settings'
                              : 'request-camera-permission'
                          }
                        >
                          <Text style={styles.cameraPermissionButtonText}>
                            {cameraState === 'settings'
                              ? t('openSettings')
                              : t('allowCamera')}
                          </Text>
                        </Pressable>
                      </View>
                    )}
                  </>
                )}
              </View>
            )}
            <View style={styles.viewfinderTopRow}>
              <View style={styles.viewfinderSpacer} />
              {locationChipText ? (
                <View style={styles.locationChip}>
                  <Text style={styles.locationChipText}>{locationChipText}</Text>
                </View>
              ) : (
                <View style={styles.viewfinderSpacer} />
              )}
              <View style={styles.viewfinderSpacer} />
            </View>
            <View style={styles.framingRect} pointerEvents="none" />
            <Text style={styles.captureHint}>{t('captureHint')}</Text>
            <View style={styles.controlRow}>
              <IconButton
                label={t('chooseFromLibrary')}
                onPress={() => pickPhoto(false)}
                style={styles.translucentIconBtn}
              >
                <Feather name="image" size={20} color="#fff" />
              </IconButton>
              {/* A shutter ALWAYS renders. When the live preview is up it
                  captures from it; otherwise it falls back to the system
                  camera app via launchCameraAsync, which sets `capture` on the
                  file input. Leaving the user with no camera button at all —
                  while permission is pending, refused, or the preview failed —
                  is the original Android bug (SYC-71). */}
              {shutterKind === 'live' ? (
                <Pressable
                  onPress={captureLivePhoto}
                  disabled={capturing}
                  accessibilityRole="button"
                  accessibilityLabel={t('takePhoto')}
                  testID="live-camera-shutter"
                  style={({ pressed }) => [
                    styles.shutter,
                    { opacity: pressed || capturing ? 0.65 : 1 },
                  ]}
                />
              ) : (
                <Pressable
                  onPress={() => pickPhoto(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('takePhoto')}
                  testID="picker-camera-shutter"
                  style={({ pressed }) => [
                    styles.shutter,
                    { opacity: pressed ? 0.85 : 1 },
                  ]}
                />
              )}
            </View>
          </View>
        )}

        {denied && !photo && (
          <Pressable onPress={refresh}>
            <Text style={[styles.denied, { color: colors.destructive }]}>
              {t('locationDenied')}
            </Text>
          </Pressable>
        )}
        {locating && !coords && !photo && (
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {t('locating')}
          </Text>
        )}

        {pendingSection}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: spacing[4], paddingBottom: spacing[2], gap: spacing[1] },
  title: { fontSize: fontSizes.xl, fontFamily: fonts.displayBold },
  subtitle: { fontSize: fontSizes.xs, fontFamily: fonts.body },
  detailsHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },

  // Capture (viewfinder) state
  viewfinder: {
    height: 420,
    borderRadius: radii.xl,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  viewfinderEmojiWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinderEmoji: {
    textAlign: 'center',
    fontSize: 130,
  },
  cameraPermissionPanel: {
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[6],
  },
  cameraPermissionText: {
    color: '#fff',
    textAlign: 'center',
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.sm,
  },
  cameraPermissionButton: {
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  cameraPermissionButtonText: {
    color: '#1b2a38',
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.xs,
  },
  viewfinderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
  },
  viewfinderSpacer: { width: 38, height: 38 },
  locationChip: {
    paddingVertical: spacing[1] + 2,
    paddingHorizontal: spacing[3],
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  locationChipText: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.xs, color: '#fff' },
  framingRect: {
    flex: 1,
    marginHorizontal: spacing[7],
    marginVertical: spacing[2],
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: radii.xl,
  },
  captureHint: {
    textAlign: 'center',
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.sm,
    color: 'rgba(255,255,255,0.92)',
    marginBottom: spacing[3],
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[7],
    paddingBottom: spacing[6],
  },
  translucentIconBtn: { backgroundColor: 'rgba(255,255,255,0.2)' },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#fff',
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.4)',
  },

  // Details state
  detailsIntroRow: { flexDirection: 'row', gap: spacing[3], alignItems: 'center' },
  thumb: { width: 88, height: 88, borderRadius: radii.lg, borderWidth: 1 },
  niceShot: { fontSize: fontSizes.md, fontFamily: fonts.displayBold },
  niceShotHint: { fontSize: fontSizes.xs, fontFamily: fonts.body, lineHeight: fontSizes.xs * 1.45 },
  addAnother: { marginTop: spacing[1], fontSize: fontSizes['2xs'], fontFamily: fonts.displayBold },
  fieldLabel: { fontSize: fontSizes['2xs'], fontFamily: fonts.bodyBold, textTransform: 'uppercase' },
  locationField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  locationFieldText: { fontFamily: fonts.bodySemiBold, fontSize: fontSizes.sm },
  locationPicker: { height: 220 },
  denied: { fontSize: fontSizes.xs, fontFamily: fonts.bodyBold },

  // Pending list
  pendingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: fontSizes.md, fontFamily: fonts.bodyBold },
  syncText: { fontSize: fontSizes.xs, fontFamily: fonts.bodyBold },
  pendingItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  pendingThumb: { width: 48, height: 48, borderRadius: radii.sm },
  pendingDate: { fontSize: fontSizes['2xs'], fontFamily: fonts.body },
  errorActions: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[1] },
  errorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1] + 2,
    paddingVertical: spacing[1] + 2,
    paddingHorizontal: spacing[3],
    borderRadius: radii.xs,
  },
  errorBtnText: { fontSize: fontSizes['2xs'], fontFamily: fonts.bodyBold },
  replaceBtn: { alignSelf: 'flex-start', marginTop: spacing[1] },
});
