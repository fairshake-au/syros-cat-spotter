import React, { useState } from 'react';
import {
  ActivityIndicator,
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
import { notify, confirmChoice } from '@/lib/notify';
import {
  createSingleFlight,
  describeSaveFailure,
  submitSighting,
  type SaveFailure,
} from '@/lib/submitFlow';
import {
  optimizePhotoForUpload,
} from '@/lib/photoUpload';
import { useLocation } from '@/hooks/useLocation';
import { OfflineBanner } from '@/components/OfflineBanner';
import { LocationPicker } from '@/components/LocationPicker';
import { useOfflineTiles } from '@/lib/offlineTiles';
import { SightingPhoto } from '@/components/SightingPhoto';
import {
  durablePhotos,
  requestPersistentStorage,
  reviewPhotoKey,
  savePendingPhoto,
} from '@/lib/pendingPhotos';
import { buildReviewParams } from '@/lib/reviewParams';
import { CaptureControls } from '@/components/CaptureControls';
import { Button } from '@/components/purropolis/Button';
import { Card } from '@/components/purropolis/Card';
import { Badge } from '@/components/purropolis/Badge';
import { fonts, fontSizes, radii, spacing, shadows } from '@/constants/theme';
import {
  cameraCaptureToPhoto,
  captureLiveWithRetry,
  getCameraMode,
  shutterKindFor,
} from '@/lib/cameraMode';
import { createSequencedRunner } from '@/lib/sequencedCall';

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

/**
 * Let go of a photo's short-lived object URL (the live camera's, or the web
 * picker's). Nothing downstream reads it any more: the review screen gets the
 * photo from the phone's own store, never through the route.
 */
function releasePhotoUri(uri: string | undefined | null) {
  if (!uri || !uri.startsWith('blob:')) return;
  try {
    URL.revokeObjectURL(uri);
  } catch {
    // nothing to release
  }
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
    ready: queueReady,
    readOnly: queueReadOnly,
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
  const [photo, setPhotoState] = useState<PickedPhoto | null>(null);
  // The on-screen photo's object URL, revoked when it is replaced or cleared.
  const photoUriRef = React.useRef<string | null>(null);
  const setPhoto = React.useCallback((next: PickedPhoto | null) => {
    const previous = photoUriRef.current;
    if (previous && previous !== next?.uri) releasePhotoUri(previous);
    photoUriRef.current = next?.uri ?? null;
    setPhotoState(next);
  }, []);
  React.useEffect(() => () => releasePhotoUri(photoUriRef.current), []);
  // Stamped when the photo is picked. Submitting can happen minutes later —
  // and across local midnight — so using submit time would put the sighting on
  // the wrong day for streak purposes.
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [optimizingUpload, setOptimizingUpload] = useState(false);
  // One submit at a time, checked before any re-render could disable the
  // button: a double tap must not queue a sighting twice.
  const submitOnce = React.useRef(createSingleFlight()).current;
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
  // expo-camera's web permission request always reports canAskAgain: true (an
  // upstream bug), so once a web user has explicitly declined, asking again
  // would just show the same dead-end pill forever. Sticky for the session.
  const [webCameraDeclined, setWebCameraDeclined] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const cameraState = getCameraMode(
    Platform.OS,
    cameraPermission,
    permissionLookupFailed,
    webCameraDeclined,
  );
  const shutterKind = shutterKindFor(cameraState, cameraFailed, cameraActive);
  const liveCameraReady = shutterKind === 'live';

  useFocusEffect(
    React.useCallback(() => {
      setCameraActive(true);
      return () => setCameraActive(false);
    }, []),
  );

  // Self-healing: a lookup that succeeds CLEARS the flag. A one-way latch would
  // mean a single transient rejection on resume (module not ready, activity
  // recreated) permanently downgrades the screen to the picker — including for
  // the user who just granted the permission in Settings and came back.
  //
  // Called from three places — mount, Android AppState resume, and retry —
  // so overlapping calls are common; runPermissionLookup makes sure a stale
  // completion can never overwrite a newer one (Cursor Bugbot finding: a
  // slow failing lookup used to unmount a working live preview after a
  // faster, more recent lookup had already succeeded).
  const runPermissionLookup = React.useRef(createSequencedRunner<void>()).current;
  const syncCameraPermission = React.useCallback(
    () =>
      runPermissionLookup(() => refreshCameraPermission().then(() => undefined)).then(
        (result) => {
          if (!result.applied) return;
          setPermissionLookupFailed(Boolean(result.error));
        },
      ),
    [refreshCameraPermission, runPermissionLookup],
  );

  React.useEffect(() => {
    void syncCameraPermission();
  }, [syncCameraPermission]);

  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncCameraPermission();
    });
    return () => subscription.remove();
  }, [syncCameraPermission]);
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
        if (!perm.granted) {
          // Returning null here used to make the shutter a dead tap: nothing
          // happened and nothing explained why. Once canAskAgain is false the
          // OS shows no prompt, so the only way out is Settings — say so.
          if (perm.canAskAgain) {
            notify(t('cameraUnavailable'), t('cameraPermissionHint'));
          } else {
            const openSettings = await confirmChoice({
              title: t('cameraUnavailable'),
              message: t('cameraDeniedHint'),
              confirmLabel: t('openSettings'),
              cancelLabel: t('cancel'),
            });
            if (openSettings) void openCameraSettings();
          }
          return null;
        }
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({
            quality: 1,
            base64: true,
            // Without this the web picker sets capture="camera", a value that
            // is not in the HTML Media Capture spec; browsers fall back to an
            // implementation default that is commonly the selfie camera.
            cameraType: ImagePicker.CameraType.back,
          })
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
      notify(t('error'));
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
      // expo-camera's web takePicture throws ERR_CAMERA_NOT_READY until the
      // <video> element has produced its first frame — a common race right
      // after the preview mounts. That specific failure gets one retry;
      // anything else, or a second failure, falls back to the system camera
      // (the existing 'picker' shutter) instead of leaving a dead shutter.
      const outcome = await captureLiveWithRetry<CameraCapturedPicture>(
        () =>
          cameraRef.current!.takePictureAsync({
            quality: 1,
            base64: true,
          }),
        (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      );
      if (outcome.kind === 'fallback') {
        // Do NOT call launchCameraAsync here: browsers only open a file
        // picker from a direct tap, and a programmatic open after an
        // awaited failure may be silently blocked. Switch the shutter and
        // let the user tap it themselves. The failed state's centre panel
        // carries the one message; an alert on top of it gave two messages
        // with different advice (Samuel's decision E, 27 Sep).
        setCameraFailed(true);
        return;
      }
      const capture = outcome.capture;
      const directPhoto = cameraCaptureToPhoto(capture);
      const picked =
        directPhoto &&
        directPhoto.base64.length * 0.75 <= MAX_UPLOAD_BYTES
          ? directPhoto
          : // Shrink from the normalised uri, not the raw capture: on web the
            // raw one is the whole image inlined as a data URL.
            await shrink(directPhoto?.uri ?? capture.uri);
      if (directPhoto && picked !== directPhoto) releasePhotoUri(directPhoto.uri);
      setPhoto(picked);
      setCapturedAt(new Date().toISOString());
    } catch {
      // Same as a failed capture: fall back to the system camera and let the
      // centre panel say so, rather than an alert over a still-live shutter.
      setCameraFailed(true);
    } finally {
      setCapturing(false);
    }
  };

  const requestLiveCamera = async () => {
    try {
      const result = await requestCameraPermission();
      if (Platform.OS === 'web' && !result.granted) {
        // The upstream canAskAgain: true bug means asking again would just
        // show the same dead-end pill forever — stop showing it.
        setWebCameraDeclined(true);
      }
    } catch {
      // Native only in practice: expo-camera's web request never throws — a
      // refusal resolves not-granted and is handled above. The picker shutter
      // is already on screen in this state, so the user is not stranded; just
      // say the live preview is not available.
      notify(t('cameraUnavailable'), t('cameraUnavailableHint'));
    }
  };

  const openCameraSettings = async () => {
    if (Platform.OS === 'web') {
      notify(t('cameraUnavailable'), t('browserCameraSettings'));
      return;
    }
    try {
      await Linking.openSettings();
    } catch {
      // Only reached when camera access is switched off for good. The phone's
      // camera button needs the same permission, so pointing at it would send
      // the user round in a loop; say how to turn access on, or use a photo.
      notify(t('cameraUnavailable'), t('cameraDeniedHint'));
    }
  };

  // Re-reads the permission as well as clearing the failure: re-rendering an
  // identical CameraView is what the previous version did, and it told a user
  // with a persistent problem nothing new.
  const retryLiveCamera = () => {
    setCameraFailed(false);
    void syncCameraPermission();
  };

  /** Say plainly that a save did not happen. The photo stays where it is. */
  const reportSaveFailure = (failure: SaveFailure) => {
    notify(
      t('saveFailedTitle'),
      failure === 'read-only'
        ? t('queueReadOnly')
        : failure === 'open-in-browser'
          ? t('saveFailedOpenInBrowser')
          : t('saveFailedHint'),
    );
  };

  const replaceRejectedPhoto = async (
    localId: string,
    fromCamera: boolean,
  ) => {
    const picked = await choosePhoto(fromCamera);
    if (!picked) return;
    try {
      await replacePhoto(localId, {
        photoBase64: picked.base64,
        photoUri: picked.uri,
      });
    } catch (err) {
      reportSaveFailure(await describeSaveFailure(err, durablePhotos));
    }
  };

  /** Discard / retry on a queued card: a failed save is said, not swallowed. */
  const changeQueue = (change: () => Promise<void>) => {
    change().catch(() => notify(t('error')));
  };

  const submit = () =>
    submitOnce(async () => {
      // Require the explicitly confirmed location — never raw GPS.
      const finalCoords = pickedCoords;
      if (!photo || !finalCoords || !deviceId) return;
      const sightingTime = capturedAt ?? new Date().toISOString();
      // The busy flag covers the offline branch too.
      setSubmitting(true);
      try {
        const outcome = await submitSighting({
          isOnline,
          canSaveForLater: !queueReadOnly,
          send: async () => {
            let uploadPhoto = photo;
            if (isConstrainedNetwork) {
              setOptimizingUpload(true);
              const optimizedBase64 = await optimizePhotoForUpload(photo.uri);
              if (optimizedBase64) {
                uploadPhoto = { ...photo, base64: optimizedBase64 };
              }
              setOptimizingUpload(false);
            }
            return createSighting({
              deviceId,
              photoBase64: uploadPhoto.base64,
              lat: finalCoords.latitude,
              lng: finalCoords.longitude,
              // Capture time, not submit time, and sent on the online path too
              // so a sighting's day is decided the same way however it reached
              // the server.
              capturedAt: sightingTime,
            });
          },
          save: () =>
            enqueue({
              localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              photoBase64: photo.base64,
              photoUri: photo.uri,
              lat: finalCoords.latitude,
              lng: finalCoords.longitude,
              createdAt: sightingTime,
            }),
          // R5: one bar of signal — the send failed though the phone says
          // it is connected.
          offerSaveForLater: () =>
            confirmChoice({
              title: t('sendFailedTitle'),
              message: t('saveAndSendLaterPrompt'),
              confirmLabel: t('saveAndSendLater'),
              cancelLabel: t('cancel'),
            }),
          photosKeepable: durablePhotos,
        });

        switch (outcome.kind) {
          case 'sent': {
            const result = outcome.result;
            // The review screen gets the photo from the phone's own store, by
            // a short name — never through the route. If it cannot be kept,
            // the review screen shows a placeholder.
            const kept = await savePendingPhoto(
              reviewPhotoKey(result.sightingId),
              photo.uri,
              photo.base64,
            );
            clearPhoto();
            router.push({
              pathname: '/review',
              params: buildReviewParams({
                sightingId: result.sightingId,
                isCatPhoto: result.isCatPhoto,
                candidates: result.candidates,
                photoRef: kept.ok ? kept.ref : undefined,
                // SYC-119: where the photo was taken, so "Find the cat" can
                // list the cats near it.
                lat: finalCoords.latitude,
                lng: finalCoords.longitude,
              }),
            });
            break;
          }
          case 'saved':
            clearPhoto();
            notify(
              outcome.reason === 'offline' ? t('queuedOffline') : t('savedForLater'),
            );
            break;
          case 'save-failed':
            // Nothing says "queued", and the photo stays on screen.
            reportSaveFailure(outcome.failure);
            break;
          case 'rejected':
            notify(t('photoRejectedTitle'), t(outcome.rejectionKey));
            break;
          case 'send-failed':
            notify(t('error'));
            break;
          case 'not-saved':
            // The user chose to keep the photo on screen and try again.
            break;
        }
      } finally {
        setOptimizingUpload(false);
        setSubmitting(false);
      }
    });

  const reviewPending = (item: (typeof pending)[number]) => {
    // Only the queued item's id: the review screen finds its photo through
    // the queue.
    router.push({
      pathname: '/review',
      params: buildReviewParams({
        sightingId: item.sightingId,
        isCatPhoto: item.isCatPhoto,
        candidates: item.candidates,
        localId: item.localId,
      }),
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
          <Pressable
            onPress={() => {
              // Only ever from a tap here, never mid-save (spec §3.2).
              requestPersistentStorage();
              void syncNow();
            }}
            disabled={syncing}
          >
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
              ? () => {
                  requestPersistentStorage();
                  reviewPending(item);
                }
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
                    : item.errorKind === 'cleared'
                      ? t('syncFailedCleared')
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
                <Text style={[styles.replaceLabel, { color: colors.foreground }]}>
                  {t('replacePhoto')}
                </Text>
                <Text style={[styles.pendingDate, { color: colors.mutedForeground }]}>
                  {t('replacePhotoHint')}
                </Text>
                <View style={[styles.errorActions, styles.replaceBtn]}>
                  <Pressable
                    onPress={() => {
                      requestPersistentStorage();
                      void replaceRejectedPhoto(item.localId, true);
                    }}
                    style={[styles.errorBtn, { backgroundColor: colors.secondary }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('takePhoto')}
                    testID={`replace-photo-camera-${item.localId}`}
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
                      {t('takePhoto')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      requestPersistentStorage();
                      void replaceRejectedPhoto(item.localId, false);
                    }}
                    style={[styles.errorBtn, { backgroundColor: colors.secondary }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('chooseFromLibrary')}
                    testID={`replace-photo-library-${item.localId}`}
                  >
                    <Feather
                      name="image"
                      size={13}
                      color={colors.secondaryForeground}
                    />
                    <Text
                      style={[
                        styles.errorBtnText,
                        { color: colors.secondaryForeground },
                      ]}
                    >
                      {t('chooseFromLibrary')}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
            <Text style={[styles.pendingDate, { color: colors.mutedForeground }]}>
              {new Date(item.createdAt).toLocaleString()}
            </Text>
            {item.status === 'error' && (
              <View style={styles.errorActions}>
                {item.errorKind !== 'stale' && item.errorKind !== 'cleared' && (
                  <Pressable
                    onPress={() => changeQueue(() => retry(item.localId))}
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
                  onPress={() => changeQueue(() => remove(item.localId))}
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
            <Pressable
              onPress={() => changeQueue(() => remove(item.localId))}
              hitSlop={8}
            >
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </Card>
      ))}
    </View>
  );

  // The permission / camera-failed prompt shown in the viewfinder. Null when
  // there is nothing to ask, which leaves the framing rectangle in place.
  const cameraPanel = cameraFailed ? (
    <View style={styles.cameraPermissionPanel}>
      <Text style={styles.cameraPermissionText}>{t('cameraUnavailableHint')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={retryLiveCamera}
        style={styles.cameraPermissionButton}
        testID="retry-live-camera"
      >
        <Text style={styles.cameraPermissionButtonText}>{t('tryAgain')}</Text>
      </Pressable>
    </View>
  ) : cameraState === 'request' || cameraState === 'settings' ? (
    <View style={styles.cameraPermissionPanel}>
      <Text style={styles.cameraPermissionText}>
        {cameraState === 'settings' ? t('cameraDeniedHint') : t('cameraPermissionHint')}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={cameraState === 'settings' ? openCameraSettings : requestLiveCamera}
        style={styles.cameraPermissionButton}
        testID={
          cameraState === 'settings' ? 'open-camera-settings' : 'request-camera-permission'
        }
      >
        <Text style={styles.cameraPermissionButtonText}>
          {cameraState === 'settings' ? t('openSettings') : t('showLiveView')}
        </Text>
      </Pressable>
    </View>
  ) : null;

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
                  : isOnline
                    ? t('submitting')
                    : t('savingSighting')
                : t('checkForMatches')}
            </Button>
          </>
        ) : (
          // ── Capture state: dark viewfinder treatment ──
          <View style={[styles.viewfinder, shadows.md]}>
            {liveCameraReady ? (
              <CameraView
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
            {cameraPanel ? (
              // The panel takes the framing rectangle's slot in the column so it
              // can never overlap the hint or the shutter row below it.
              <View style={styles.viewfinderMiddle}>
                <Text
                  style={[styles.viewfinderEmoji, styles.viewfinderEmojiSmall]}
                  pointerEvents="none"
                >
                  🐈‍⬛
                </Text>
                {cameraPanel}
              </View>
            ) : (
              <View style={styles.framingRect} pointerEvents="none">
                {/* textAlignVertical is Android-only, so centre with flexbox or
                    the stand-in rides the top edge on iOS and web. */}
                {cameraState === 'loading' ? (
                  <ActivityIndicator color="#fff" size="large" />
                ) : (
                  cameraState !== 'ready' && (
                    <Text style={styles.viewfinderEmoji}>🐈‍⬛</Text>
                  )
                )}
              </View>
            )}
            {/* When the centre panel is showing, it carries the one message; a
                second hint here would give competing suggestions in two places
                (Samuel's decision, 27 Sep). */}
            {!cameraPanel && (
              <Text style={styles.captureHint}>
                {liveCameraReady ? t('captureHint') : t('captureHintPicker')}
              </Text>
            )}
            <CaptureControls
              shutterKind={shutterKind}
              capturing={capturing}
              onChooseFromLibrary={() => pickPhoto(false)}
              onCaptureLive={captureLivePhoto}
              onCaptureWithPicker={() => pickPhoto(true)}
              libraryLabel={t('chooseFromLibrary')}
              shutterLabel={t('takePhoto')}
            />
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

        {queueReady && queueReadOnly && (
          <Text
            style={[styles.subtitle, { color: colors.destructive }]}
            testID="queue-read-only"
          >
            {t('queueReadOnly')}
          </Text>
        )}
        {queueReady ? (
          pendingSection
        ) : (
          // Until the saved queue has loaded, "nothing queued" would be a lie.
          <Text
            style={[styles.subtitle, { color: colors.mutedForeground }]}
            testID="loading-saved-sightings"
          >
            {t('loadingSavedSightings')}
          </Text>
        )}
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
    // A floor, not a fixed height: a long translation or large text size
    // grows the card instead of clipping the camera prompt's button.
    minHeight: 420,
    borderRadius: radii.xl,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  viewfinderMiddle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    marginVertical: spacing[2],
  },
  viewfinderEmoji: {
    textAlign: 'center',
    fontSize: 130,
  },
  viewfinderEmojiSmall: { fontSize: 64 },
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureHint: {
    textAlign: 'center',
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.sm,
    color: 'rgba(255,255,255,0.92)',
    marginBottom: spacing[3],
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
  replaceLabel: { fontSize: fontSizes['2xs'], fontFamily: fonts.bodyBold, marginTop: spacing[1] },
  replaceBtn: { alignSelf: 'flex-start', marginTop: spacing[1] },
});
