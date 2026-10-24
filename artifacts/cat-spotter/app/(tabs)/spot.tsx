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
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  CameraView,
  useCameraPermissions,
  type CameraCapturedPicture,
} from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSighting } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { NewSpotIntro } from '@/components/NewSpotIntro';
import { ExtraPhotoBoxes } from '@/components/ExtraPhotoBoxes';
import { PhotoTipsCard } from '@/components/photoTips/PhotoTipsCard';
import { hasSeenPhotoTips, markPhotoTipsSeen, shouldOpenPhotoTips } from '@/lib/photoTipsSeen';
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
import { useAppLocation } from '@/context/LocationContext';
import { OfflineBanner } from '@/components/OfflineBanner';
import { LocationPicker } from '@/components/LocationPicker';
import { WaitingCard } from '@/components/WaitingCard';
import { useAppSettings } from '@/context/AppSettingsContext';
import { athensDay } from '@/lib/athensDay';
import { ForegroundStopwatch } from '@/lib/foregroundStopwatch';
import {
  NUDGE_ENABLED,
  chooseForWait,
  settleWait,
  shouldShowWaitingCard,
  type WaitChoice,
  type WaitingRecord,
  type WaitOutcome,
  waitOutcomeForSend,
} from '@/lib/waitingCard';
import { loadExistingWaitingRecord, loadWaitingRecord, saveWaitingRecord } from '@/lib/waitingCardStore';
import { NeedsHelpLink } from '@/components/report/NeedsHelpLink';
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
import { SpotHintBanner } from '@/components/SpotHintBanner';
import { useSpotHint } from '@/hooks/useSpotHint';
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
import {
  readPickedAsset,
  type PhotoTimeInfo,
  type PickedPhoto,
} from '@/lib/pickedAsset';
import {
  MAX_PHOTO_AGE_DAYS,
  formatPhotoDate,
  formatPhotoTaken,
} from '@/lib/photoClock';
import {
  alreadyLoggedDestination,
  entryForOutcome,
  findAlreadyLogged,
  loadRecentPhotos,
  photoFingerprint,
  recordRecentPhoto,
  replaceRecentExtraFingerprint,
  uniqueCaptureTime,
  type AlreadyLoggedDestination,
} from '@/lib/recentPhotos';
import { queuedSighting, sightingRequest } from '@/lib/sightingPayload';
import {
  checkExtraCandidate,
  coverExtra,
  fitsRequestBudget,
  photosInUse,
  recheckAfterRetake,
  type ExtraProblem,
  type ExtraRole,
  type SpotPhoto,
} from '@/lib/extraPhotos';
import { prepareExtraPhoto } from '@/lib/prepareExtraPhoto';
import { extrasOf } from '@/lib/offlineQueue';
import {
  MAP_START_WAIT_MS,
  canCheckForMatches,
  isSpotterMove,
  mapStartHintKey,
  needsHelpCoords,
  nextMapStart,
  resolveMapStart,
  type PickSource,
  type ReadyMapStart,
} from '@/lib/mapStart';
import { spokenText } from '@/lib/a11yText';
import {
  effectiveLocationAsk,
  locationAskView,
  shouldAutoAsk,
  type AskFrom,
} from '@/lib/locationAsk';
import { LocationAskCard } from '@/components/spot/LocationAskCard';

/** A library photo that can't be used, said in a card with the library offered again. */
type PhotoProblem =
  | { kind: 'tooOld'; instantMs: number }
  | { kind: 'alreadyLogged'; destination: AlreadyLoggedDestination | null };

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

export default function SpotScreen() {
  const colors = useColors();
  const { t, language } = useLanguage();
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
    removeExtraPhoto,
    replaceExtraPhoto,
    syncNow,
    syncing,
  } =
    useOffline();
  // SYC-524: Spot never asks on open. It asks from the location card after a
  // camera photo, or straight after one for a spotter who shared before.
  const {
    coords,
    denied,
    loading: locating,
    permission,
    choice,
    checked,
    askAndLocate,
    chooseMap,
  } = useAppLocation();
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
  // SYC-574 (design-review-fixes-oct22.md §2.2): the cat the spotter came to
  // spot from its page. It belongs to the photo about to be taken or staged,
  // lives only on the phone, and is never part of the request body.
  const { hintCatId, hintCat, dispatch: dispatchHint } = useSpotHint(photo !== null);
  // Stamped when the photo is picked. Submitting can happen minutes later —
  // and across local midnight — so using submit time would put the sighting on
  // the wrong day for streak purposes.
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  // SYC-166: what the library photo said about its own time ('unread' when we
  // did not read it: the camera, or an empty answer from a phone's picker).
  // Null with no photo.
  const [photoTime, setPhotoTime] = useState<PhotoTimeInfo | null>(null);
  // The picked photo's fingerprint, for "You've already logged this photo".
  // Camera photos carry one too (SYC-415), so an extra photo can't repeat them.
  const photoFingerprintRef = React.useRef<string | undefined>(undefined);
  // SYC-415: when the first photo was taken (a camera photo: now; a library
  // photo: its own time, or null when it carries none). Checked against the
  // extra photos' times: one spot, one visit.
  const [firstTakenAtMs, setFirstTakenAtMs] = useState<number | null>(null);
  // SYC-415: the optional face and body photos. Each holds the PREPARED copy
  // (sent) and the ORIGINAL's fingerprint. The ref mirrors the state so an
  // await in a handler never reads a stale copy.
  const [extras, setExtrasState] = useState<Partial<Record<ExtraRole, SpotPhoto>>>({});
  const extrasRef = React.useRef<Partial<Record<ExtraRole, SpotPhoto>>>({});
  const setExtras = React.useCallback((next: Partial<Record<ExtraRole, SpotPhoto>>) => {
    // Let go of the short-lived object URL of any extra that is going away.
    for (const role of ['face', 'body'] as const) {
      const before = extrasRef.current[role]?.uri;
      if (before && before !== next[role]?.uri) releasePhotoUri(before);
    }
    extrasRef.current = next;
    setExtrasState(next);
  }, []);
  React.useEffect(
    () => () => {
      for (const e of Object.values(extrasRef.current)) releasePhotoUri(e?.uri);
    },
    [],
  );
  // SYC-415 review: which on-screen spot this is. Bumped whenever the first
  // photo is set or cleared, and when a send starts, so a photo still being
  // picked or prepared for an earlier spot is never attached to this one.
  const spotGenerationRef = React.useRef(0);
  // True while an extra photo is being prepared: the boxes are disabled.
  const [preparingExtra, setPreparingExtra] = useState(false);
  const [photoProblem, setPhotoProblem] = useState<PhotoProblem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [optimizingUpload, setOptimizingUpload] = useState(false);
  // SYC-48 / SYC-36 (match-wait plan PR 1): the waiting card in the map's
  // place, only while a sighting is being SENT (never on an offline save:
  // plan C7). Null when there's no card.
  const [waitChoice, setWaitChoice] = useState<WaitChoice | null>(null);
  const waitRef = React.useRef<{
    choice: WaitChoice;
    /** Null when the phone's record couldn't be read: nothing is saved. */
    record: WaitingRecord | null;
    stopwatch: ForegroundStopwatch;
  } | null>(null);
  // Bumped when a submit ends, so a card still being chosen never appears late.
  const waitTokenRef = React.useRef(0);
  const { settings: matchWaitSettings, noteSent } = useAppSettings();
  // SYC-415 review: with the switch off the boxes are hidden, so no extra
  // photo is kept at all (nothing hidden can be sent, or come back later).
  React.useEffect(() => {
    if (!matchWaitSettings.extraPhotosOn && Object.keys(extrasRef.current).length > 0) {
      setExtras({});
    }
  }, [matchWaitSettings.extraPhotosOn, setExtras]);
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

  // SYC-415 spec §3.2: the photo tips card shows the first time this phone
  // reaches the camera. `cameraActive` is the tab-focus flag, so this runs when
  // the spotter arrives on the camera, not while the tab is in the background.
  const [tipsOpen, setTipsOpen] = useState(false);
  // Set synchronously when the card is dismissed, so a tab-switch re-check can't
  // beat the asynchronous storage write and re-open it.
  const seenThisSessionRef = React.useRef(false);
  React.useEffect(() => {
    if (photo) {
      // A photo arriving closes an open card without marking it seen, so it
      // doesn't pop back when the photo is cleared.
      setTipsOpen(false);
      return;
    }
    if (!cameraActive) return;
    let cancelled = false;
    void hasSeenPhotoTips(AsyncStorage).then((seen) => {
      if (
        !cancelled &&
        shouldOpenPhotoTips({
          seen,
          hasPhoto: false,
          seenThisSession: seenThisSessionRef.current,
        })
      ) {
        setTipsOpen(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [photo, cameraActive]);
  // "Got it" only closes the card and marks it seen. It must never open the
  // camera or picker itself: browsers allow that only from a direct tap.
  const closeTips = () => {
    seenThisSessionRef.current = true;
    setTipsOpen(false);
    void markPhotoTipsSeen(AsyncStorage);
  };

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

  // SYC-166 slice 4: where the map starts (lib/mapStart.ts). A library photo
  // with no usable phone position starts in Ermoupoli; the camera waits for
  // the phone, as before.
  const [pickSource, setPickSource] = useState<PickSource | null>(null);
  const [mapStart, setMapStart] = useState<ReadyMapStart | null>(null);
  // Bumped with every new start, so the map remounts there: it positions
  // itself from its first coordinates only (LocationPicker.tsx).
  const [mapStartKey, setMapStartKey] = useState(0);
  // Whether the spotter has moved the map since it started. Until then an
  // Ermoupoli start gives way to a late phone fix on Syros.
  const [mapTouched, setMapTouched] = useState(false);
  const [mapWaitedMs, setMapWaitedMs] = useState(0);
  // SYC-524: whether the spotter answered the location card (either button,
  // or the small link) for this photo. Reset in resetMapStart.
  const [answeredThisPhoto, setAnsweredThisPhoto] = useState(false);
  // Where a running ask started ('auto' = straight after the photo), so its
  // button can say "Getting your location…" and the map holds. A token, so a
  // stale ask finishing can't clear a newer one.
  const [askFrom, setAskFrom] = useState<AskFrom>(null);
  const askTokenRef = React.useRef(0);
  // The photo the 'auto-ask' already asked for: once per photo, never a loop.
  const autoAskedPhotoRef = React.useRef<PickedPhoto | null>(null);
  const rawLocationAsk = locationAskView({
    source: pickSource,
    hasPhoto: !!photo,
    permission,
    choice,
    platform: Platform.OS === 'web' ? 'web' : 'native',
    answeredThisPhoto,
    checked,
  });
  // While "Use where I am" from the card (or the automatic ask) waits for the
  // phone, the view holds at 'card' and no pin is placed: the fix, a refusal
  // or the timeout ends it, and "I'll put the pin on the map" stays available.
  const locationAsk = effectiveLocationAsk({
    raw: rawLocationAsk,
    askFrom,
    hasCoords: !!coords,
  });
  const trackAsk = React.useCallback((from: Exclude<AskFrom, null>, ask: Promise<unknown>) => {
    const token = ++askTokenRef.current;
    setAskFrom(from);
    void ask.finally(() => {
      if (askTokenRef.current === token) setAskFrom(null);
    });
  }, []);
  // A spotter who shared before ('auto-ask'): straight to the phone's box,
  // once for this photo. The map holds (no pin) while the phone's box is up.
  React.useEffect(() => {
    if (!shouldAutoAsk(rawLocationAsk, photo, autoAskedPhotoRef.current)) return;
    autoAskedPhotoRef.current = photo;
    setAnsweredThisPhoto(true);
    trackAsk('auto', askAndLocate());
  }, [photo, rawLocationAsk, askAndLocate, trackAsk]);
  const onUseWhereIAm = () => {
    setAnsweredThisPhoto(true);
    trackAsk(locationAsk === 'card' ? 'card' : 'link', askAndLocate());
  };
  const onPutPinOnMap = () => {
    // A running ask is left to finish: a late fix still moves an unmoved map
    // (nextMapStart), but the card goes now.
    askTokenRef.current += 1;
    setAskFrom(null);
    chooseMap();
    setAnsweredThisPhoto(true);
  };
  const openLocationSettings = () => {
    // Nothing better to offer if the phone can't open them: the map works.
    Linking.openSettings().catch(() => {});
  };
  // Reset in resetMapStart (with the new photo), not here: an effect's reset
  // would land a render late, after the start below had read the old value.
  React.useEffect(() => {
    if (!photo) return;
    const timer = setTimeout(() => setMapWaitedMs(MAP_START_WAIT_MS), MAP_START_WAIT_MS);
    return () => clearTimeout(timer);
  }, [photo]);
  React.useEffect(() => {
    if (!photo || !pickSource) return;
    const next = nextMapStart(
      mapStart,
      resolveMapStart({
        source: pickSource,
        phone: { coords, denied, loading: locating },
        waitedMs: mapWaitedMs,
        ask: locationAsk,
      }),
      mapTouched,
    );
    if (next && next !== mapStart) {
      setMapStart(next);
      setMapStartKey((k) => k + 1);
      setPickedCoords({ latitude: next.coords.latitude, longitude: next.coords.longitude });
    }
  }, [photo, pickSource, coords, denied, locating, mapWaitedMs, mapStart, mapTouched, locationAsk]);
  const onMapMoved = (next: { latitude: number; longitude: number }) => {
    if (mapStart && isSpotterMove(mapStart.coords, next)) setMapTouched(true);
    setPickedCoords(next);
  };
  /** A new photo, a retake or a discard: the map starts afresh. */
  const resetMapStart = () => {
    setMapStart(null);
    setMapWaitedMs(0);
    setMapTouched(false);
    setPickedCoords(null);
    // SYC-524: each new photo gets its own answer to the location card.
    setAnsweredThisPhoto(false);
    askTokenRef.current += 1;
    setAskFrom(null);
  };

  /**
   * SYC-415: the one way the first photo is set, by the picker and the live
   * camera alike. If face or body photos were already added (the first photo
   * was retaken), each is checked again against the new one: one from a
   * different visit, or the same photo, is taken out, and the spotter is told.
   */
  const setFirstPhoto = (
    next: PickedPhoto,
    timeInfo: PhotoTimeInfo,
    fingerprint: string,
    takenAtMs: number | null,
  ) => {
    spotGenerationRef.current += 1;
    resetMapStart();
    setPhoto(next);
    setPhotoTime(timeInfo);
    photoFingerprintRef.current = fingerprint;
    setFirstTakenAtMs(takenAtMs);
    // As before: the photo's own time when it has one, otherwise now.
    setCapturedAt(new Date(takenAtMs ?? Date.now()).toISOString());
    const current = extrasRef.current;
    if (!matchWaitSettings.extraPhotosOn) {
      // The boxes are hidden: nothing to re-check, nothing to say.
      if (Object.keys(current).length > 0) setExtras({});
    } else if (Object.keys(current).length > 0) {
      const { kept, removed } = recheckAfterRetake(
        { uri: next.uri, base64: next.base64, fingerprint, takenAtMs },
        current,
      );
      setExtras(kept);
      for (const r of removed) {
        notify(
          t(r.reason === 'duplicate' ? 'extraRemovedDuplicate' : 'extraRemovedAfterRetake').replace(
            '{which}',
            t(r.role === 'face' ? 'whichFace' : 'whichBody'),
          ),
        );
      }
    }
  };

  /**
   * "Retake photo" (SYC-118): back to the camera for a new first photo. Only
   * what is on screen is cleared, never the queue. SYC-415: the face and body
   * photos are KEPT, and re-checked when the new first photo arrives.
   */
  const retakeFirstPhoto = () => {
    spotGenerationRef.current += 1;
    setPhoto(null);
    setCapturedAt(null);
    setPhotoTime(null);
    photoFingerprintRef.current = undefined;
    setFirstTakenAtMs(null);
    setPhotoProblem(null);
    setPickedCoords(null);
    resetMapStart();
    setPickSource(null);
  };

  /** Discard the whole spot on screen (the back arrow, and after sending): extras too. */
  const clearPhoto = () => {
    retakeFirstPhoto();
    setExtras({});
    // SYC-574: "Start again" drops the hint too ("Retake photo" keeps it).
    dispatchHint({ kind: 'startAgain' });
  };

  const choosePhoto = async (
    fromCamera: boolean,
  ): Promise<Awaited<ReturnType<typeof readPickedAsset>> | null> => {
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
            // SYC-166: the photo's own date and time. iPhone and Android only;
            // the website's picker reads no tags, so the website reads the
            // time from the file itself (slice 2W, lib/jpegTimeTags.ts).
            // The answer also holds the photo's position: only
            // lib/pickedAsset.ts looks at it, and keeps the time alone.
            exif: Platform.OS !== 'web',
          });
      if (!result.canceled && result.assets[0]) {
        return await readPickedAsset(result.assets[0], {
          // A camera photo is taken now, so it is dated now.
          timeFrom: fromCamera ? 'nowhere' : Platform.OS === 'web' ? 'file' : 'pickerTags',
          now: Date.now(),
          shrink,
          maxUploadBytes: MAX_UPLOAD_BYTES,
        });
      }
    } catch {
      notify(t('error'));
    }
    return null;
  };

  const pickPhoto = async (fromCamera: boolean) => {
    setPhotoProblem(null);
    const picked = await choosePhoto(fromCamera);
    if (!picked) return;
    const { photo: next, timeInfo, fingerprint } = picked;
    // Every library photo, on the apps and the website (slice 2W). The camera
    // is untouched: a photo taken now is dated now and can't be a repeat.
    const fromLibrary = !fromCamera;
    if (fromLibrary) {
      // More than 21 days old: not accepted, and the library offered again.
      if (timeInfo.kind === 'tooOld') {
        releasePhotoUri(next.uri);
        setPhotoProblem({ kind: 'tooOld', instantMs: timeInfo.instantMs });
        return;
      }
      const logged = findAlreadyLogged(
        fingerprint,
        await loadRecentPhotos(AsyncStorage, Date.now()),
        new Set(pending.map((p) => p.localId)),
      );
      if (logged) {
        releasePhotoUri(next.uri);
        setPhotoProblem({
          kind: 'alreadyLogged',
          destination: alreadyLoggedDestination(logged, pending),
        });
        return;
      }
    }
    // A camera photo is taken now; a library photo has its own time, or none.
    const takenAtMs =
      timeInfo.kind === 'ok' ? timeInfo.instantMs : fromCamera ? Date.now() : null;
    setPickSource(fromCamera ? 'camera' : 'library');
    setFirstPhoto(next, timeInfo, fingerprint, takenAtMs);
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
      setPhotoProblem(null);
      setPickSource('live');
      setFirstPhoto(picked, { kind: 'unread' }, photoFingerprint(picked.base64), Date.now());
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
    // The replacement keeps the rejected item's own time on purpose: it is a
    // new photo for the same sighting, so the photo's time is not used
    // (SYC-311 decides whether it should be).
    const picked = await choosePhoto(fromCamera);
    if (!picked) return;
    try {
      await replacePhoto(localId, {
        photoBase64: picked.photo.base64,
        photoUri: picked.photo.uri,
      });
    } catch (err) {
      reportSaveFailure(await describeSaveFailure(err, durablePhotos));
    }
  };

  /** SYC-415: the message for an extra photo that can't be added. */
  const extraProblemMessage = (problem: ExtraProblem): string => {
    switch (problem.kind) {
      case 'duplicate':
        return t('extraDuplicate');
      case 'alreadyLogged':
        return t('photoAlreadyLogged');
      case 'tooOld':
        return t('photoTooOld')
          .replaceAll('{date}', formatPhotoDate(problem.instantMs, language))
          .replaceAll('{days}', String(MAX_PHOTO_AGE_DAYS));
      case 'differentVisit':
        return t('extraDifferentVisit').replace(
          '{when}',
          formatPhotoTaken(problem.takenAtMs, language),
        );
      case 'tooLarge':
        return t('extraTooLarge');
    }
  };

  /**
   * SYC-415: add a face or body photo. Everything is checked when the photo
   * is picked, never later at sending time (spec §4.3, §6.1): it must be
   * preparable (2048px, quality 0.8), not logged before, not the first photo
   * or the other box's photo, within 21 days, from the same visit, and the
   * whole spot must still fit the request budget.
   */
  const addExtra = async (role: ExtraRole, from: 'camera' | 'library') => {
    if (!photo) return;
    // The spot this photo is for. If it is retaken, discarded or sent while
    // the photo is being picked or prepared, the photo is let go, never
    // attached to whatever spot is on screen by then.
    const generation = spotGenerationRef.current;
    const stale = () => spotGenerationRef.current !== generation;
    const picked = await choosePhoto(from === 'camera');
    if (!picked) return;
    if (stale()) {
      releasePhotoUri(picked.photo.uri);
      return;
    }
    setPreparingExtra(true);
    try {
      const prepared = await prepareExtraPhoto(picked.photo.uri);
      if (prepared?.uri !== picked.photo.uri) releasePhotoUri(picked.photo.uri);
      if (stale()) {
        releasePhotoUri(prepared?.uri);
        return;
      }
      if (!prepared) {
        notify(t('extraTooLarge'));
        return;
      }
      const { timeInfo } = picked;
      const candidate: SpotPhoto = {
        ...prepared,
        // Always the ORIGINAL photo's fingerprint, never the prepared copy's,
        // so the same library photo picked again later is recognised.
        fingerprint: picked.fingerprint,
        takenAtMs:
          timeInfo.kind === 'ok' ? timeInfo.instantMs : from === 'camera' ? Date.now() : null,
      };
      const refuse = (problem: ExtraProblem) => {
        releasePhotoUri(candidate.uri);
        notify(extraProblemMessage(problem));
      };
      const logged = findAlreadyLogged(
        picked.fingerprint,
        await loadRecentPhotos(AsyncStorage, Date.now()),
        new Set(pending.map((p) => p.localId)),
      );
      if (stale()) {
        releasePhotoUri(candidate.uri);
        return;
      }
      const current = extrasRef.current;
      const otherRole: ExtraRole = role === 'face' ? 'body' : 'face';
      const problem = checkExtraCandidate({
        candidate,
        first: {
          uri: photo.uri,
          base64: photo.base64,
          fingerprint: photoFingerprintRef.current ?? '',
          takenAtMs: firstTakenAtMs,
        },
        otherExtra: current[otherRole],
        alreadyLogged: logged !== null,
        tooOld: timeInfo.kind === 'tooOld' ? { instantMs: timeInfo.instantMs } : null,
      });
      if (problem) {
        refuse(problem);
        return;
      }
      const others = current[otherRole] ? [current[otherRole]!.base64] : [];
      if (!fitsRequestBudget(photo.base64, [...others, candidate.base64])) {
        refuse({ kind: 'tooLarge' });
        return;
      }
      setExtras({ ...extrasRef.current, [role]: candidate });
    } finally {
      setPreparingExtra(false);
    }
  };

  const removeExtra = (role: ExtraRole) => {
    const next = { ...extrasRef.current };
    delete next[role];
    setExtras(next);
  };

  /**
   * SYC-415: remove the extra photo the server refused (or one of a spot too
   * large to send) from a waiting spot. Its fingerprint is forgotten, so the
   * photo can be used again (review item 10).
   */
  const removeRejectedExtra = async (localId: string, role: ExtraRole) => {
    await removeExtraPhoto(localId, role);
    await replaceRecentExtraFingerprint(AsyncStorage, localId, role, null, Date.now());
  };

  /**
   * SYC-415: replace the extra photo the server refused on a waiting spot.
   * This changes the queued spot, not the one on screen: the queue re-reads
   * the spot and does nothing if it is no longer refused.
   * Prepared like any extra; one that can't be is refused here.
   */
  const replaceRejectedExtra = async (
    localId: string,
    role: ExtraRole,
    fromCamera: boolean,
  ) => {
    const picked = await choosePhoto(fromCamera);
    if (!picked) return;
    const prepared = await prepareExtraPhoto(picked.photo.uri);
    if (prepared?.uri !== picked.photo.uri) releasePhotoUri(picked.photo.uri);
    if (!prepared) {
      notify(t('extraTooLarge'));
      return;
    }
    try {
      await replaceExtraPhoto(localId, role, {
        photoBase64: prepared.base64,
        photoUri: prepared.uri,
      });
      // The new photo counts as logged in the old one's place.
      await replaceRecentExtraFingerprint(AsyncStorage, localId, role, picked.fingerprint, Date.now());
    } catch (err) {
      reportSaveFailure(await describeSaveFailure(err, durablePhotos));
    } finally {
      releasePhotoUri(prepared.uri);
    }
  };

  /** Discard / retry on a queued card: a failed save is said, not swallowed. */
  const changeQueue = (change: () => Promise<void>) => {
    change().catch(() => notify(t('error')));
  };

  React.useEffect(() => {
    const sub = AppState.addEventListener?.('change', (s) => {
      const w = waitRef.current;
      if (!w) return;
      if (s === 'active') w.stopwatch.resume(Date.now());
      else w.stopwatch.pause(Date.now());
    });
    return () => sub?.remove?.();
  }, []);

  /** Choose what this wait shows and put it in the map's place. Runs beside
   * the upload, never in front of it. */
  const startWaitingCard = async (device: string) => {
    const token = waitTokenRef.current;
    const stored = await loadWaitingRecord(AsyncStorage, device);
    if (token !== waitTokenRef.current) return;
    const { choice, record } = chooseForWait(stored, matchWaitSettings, {
      signedInRole: null,
      nudgeEnabled: NUDGE_ENABLED,
      today: athensDay(Date.now()),
      random: Math.random,
    });
    if (record) void saveWaitingRecord(AsyncStorage, device, record);
    waitRef.current = {
      choice,
      record,
      stopwatch: new ForegroundStopwatch(Date.now(), AppState.currentState !== 'background'),
    };
    setWaitChoice(choice);
  };

  const submit = () =>
    submitOnce(async () => {
      // Require the explicitly confirmed location — never raw GPS.
      const finalCoords = pickedCoords;
      if (!photo || !finalCoords || !deviceId) return;
      // The busy flag covers the offline branch too.
      setSubmitting(true);
      // A photo still being picked for the boxes must not join this spot.
      spotGenerationRef.current += 1;
      // SYC-574: the hint this spot leaves with. It goes to review (online)
      // or onto the queued item (offline), never into the request body.
      const hint = hintCatId;
      try {
        // Two different photos from the same second would otherwise be one
        // sighting to the server (SYC-166 Decision 2 B): move this one on by
        // a millisecond. Same list, same answer, so a retry sends the same
        // time. On the website too (slice 2W), where the list lives in this
        // browser's own storage.
        const pickedMs = Date.parse(capturedAt ?? new Date().toISOString());
        const sightingMs = uniqueCaptureTime(
          pickedMs,
          await loadRecentPhotos(AsyncStorage, Date.now()),
        );
        const sightingTime = new Date(sightingMs).toISOString();
        const fingerprint = photoFingerprintRef.current;
        const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // SYC-415: the face and body photos go only while the boxes are on
        // screen. Turned off meanwhile, the boxes are hidden and nothing
        // hidden is sent.
        const inUse = photosInUse(extras, matchWaitSettings.extraPhotosOn);
        const extraPhotos = inUse.map(({ role, photo: extra }) => ({
          role,
          photoBase64: extra.base64,
        }));
        let extraNotKept = false;
        let keptRoles: ExtraRole[] = [];
        const outcome = await submitSighting({
          isOnline,
          canSaveForLater: !queueReadOnly,
          send: async () => {
            void startWaitingCard(deviceId).catch(() => undefined);
            let uploadPhoto = photo;
            if (isConstrainedNetwork) {
              setOptimizingUpload(true);
              const optimizedBase64 = await optimizePhotoForUpload(photo.uri);
              if (optimizedBase64) {
                uploadPhoto = { ...photo, base64: optimizedBase64 };
              }
              setOptimizingUpload(false);
            }
            return createSighting(
              sightingRequest({
                deviceId,
                photoBase64: uploadPhoto.base64,
                pin: finalCoords,
                capturedAt: sightingTime,
                extraPhotos,
              }),
            );
          },
          save: () =>
            enqueue(
              queuedSighting({
                localId,
                photo,
                pin: finalCoords,
                capturedAt: sightingTime,
                extras: inUse.map(({ role, photo: extra }) => ({
                  role,
                  uri: extra.uri,
                  base64: extra.base64,
                })),
              }),
              // SYC-574: set on the stored item AFTER queuedSighting builds
              // it, so the saved-for-later shape (test 6b) stays exactly as
              // it was. The replay builds its body field by field and never
              // reads it.
              { hintCatId: hint },
            ).then((result) => {
              extraNotKept = result.extraNotKept;
              keptRoles = result.keptRoles;
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

        // SYC-48: how the wait ended, taken now (before the photo is saved for
        // the result screen). A card still being chosen must not appear late.
        waitTokenRef.current += 1;
        const wait = waitRef.current;
        waitRef.current = null;
        const waitOutcome: WaitOutcome = waitOutcomeForSend(
          outcome.kind === 'sent' ? outcome.result : null,
        );
        // Only a wait that reached a result changes the record. It is read
        // again first, so nothing written meanwhile is lost, and a record wiped
        // meanwhile ("Delete my data") isn't brought back.
        if (wait?.record && waitOutcome.kind === 'result') {
          const current = await loadExistingWaitingRecord(AsyncStorage, deviceId);
          if (current) {
            await saveWaitingRecord(
              AsyncStorage,
              deviceId,
              settleWait(current, wait.choice, waitOutcome, wait.stopwatch.elapsed(Date.now())),
            );
          }
        }
        if (outcome.kind === 'sent') noteSent();

        // Only a send or a save that succeeded is remembered, and a photo
        // the server said is not a cat keeps its time but not its
        // fingerprint, so it can be picked again. SYC-415: the extra photos
        // too, except any that couldn't be kept with a spot saved for later.
        const rememberedExtras = inUse
          .filter(({ role }) => outcome.kind !== 'saved' || keptRoles.includes(role))
          .map(({ role, photo: extra }) => ({ role, fingerprint: extra.fingerprint }));
        const remembered = entryForOutcome(
          outcome.kind,
          sightingMs,
          fingerprint,
          outcome.kind === 'sent'
            ? {
                sightingId: outcome.result.sightingId,
                isCatPhoto: outcome.result.isCatPhoto,
              }
            : { localId },
          rememberedExtras,
        );
        if (remembered) {
          await recordRecentPhoto(AsyncStorage, remembered, Date.now());
        }

        switch (outcome.kind) {
          case 'sent': {
            const result = outcome.result;
            // The review screen gets the photo from the phone's own store, by
            // a short name — never through the route. If it cannot be kept,
            // the review screen shows a placeholder. SYC-415: it is the spot's
            // cover photo, the face photo when there is one (spec §5.1).
            const cover = coverExtra(inUse) ?? photo;
            const kept = await savePendingPhoto(
              reviewPhotoKey(result.sightingId),
              cover.uri,
              cover.base64,
            );
            dispatchHint({ kind: 'sent' });
            clearPhoto();
            router.push({
              pathname: '/review',
              params: buildReviewParams({
                sightingId: result.sightingId,
                isCatPhoto: result.isCatPhoto,
                candidates: result.candidates,
                matchCheck: result.matchCheck,
                canRecheck: result.canRecheck,
                photoRef: kept.ok ? kept.ref : undefined,
                // SYC-119: where the photo was taken, for "Find the cat".
                lat: finalCoords.latitude,
                lng: finalCoords.longitude,
                hintCatId: hint, // SYC-574
              }),
            });
            break;
          }
          case 'saved':
            dispatchHint({ kind: 'sent' });
            clearPhoto();
            notify(
              outcome.reason === 'offline' ? t('queuedOffline') : t('savedForLater'),
              // SYC-415: the extra photos couldn't be kept outside the list, so the
              // spot waits with its first photo only. Said, not hidden.
              extraNotKept ? t('extraNotKeptNote') : undefined,
            );
            break;
          case 'save-failed':
            // Nothing says "queued", and the photo stays on screen.
            reportSaveFailure(outcome.failure);
            break;
          case 'rejected':
            // SYC-415: when it was a face or body photo, say which. Everything
            // stays on screen, so the spotter can remove that photo and send.
            notify(
              t('photoRejectedTitle'),
              outcome.role === 'face' || outcome.role === 'body'
                ? `${t('extraPhotoRejected').replace(
                    '{which}',
                    t(outcome.role === 'face' ? 'whichFace' : 'whichBody'),
                  )} ${t(outcome.rejectionKey)}`
                : t(outcome.rejectionKey),
            );
            break;
          case 'send-failed':
            notify(t('error'));
            break;
          case 'not-saved':
            // The user chose to keep the photo on screen and try again.
            break;
        }
      } finally {
        waitTokenRef.current += 1;
        waitRef.current = null;
        setWaitChoice(null);
        setOptimizingUpload(false);
        setSubmitting(false);
      }
    });

  const openAlreadyLogged = (destination: AlreadyLoggedDestination) => {
    setPhotoProblem(null);
    if (destination.kind === 'cat') {
      router.push({ pathname: '/cat/[id]', params: { id: String(destination.catId) } });
      return;
    }
    const item = pending.find((p) => p.localId === destination.localId);
    if (item) reviewPending(item);
  };

  const reviewPending = (item: (typeof pending)[number]) => {
    // Only the queued item's id: the review screen finds its photo through
    // the queue.
    router.push({
      pathname: '/review',
      params: buildReviewParams({
        sightingId: item.sightingId,
        isCatPhoto: item.isCatPhoto,
        candidates: item.candidates,
        matchCheck: item.matchCheck,
        canRecheck: item.canRecheck,
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
            {item.status === 'rejected' &&
              (item.rejectedRole === 'face' || item.rejectedRole === 'body' ? (
                // SYC-415: the server refused one extra photo. Say which, and
                // let the spotter replace or remove just that photo.
                <>
                  <Text
                    style={[styles.pendingDate, { color: colors.mutedForeground }]}
                  >
                    {`${t('extraPhotoRejected').replace(
                      '{which}',
                      t(item.rejectedRole === 'face' ? 'whichFace' : 'whichBody'),
                    )} ${t(item.rejectionKey ?? 'photoRejectedQueued')}`}
                  </Text>
                  <View style={[styles.errorActions, styles.replaceBtn]}>
                    <Pressable
                      onPress={() => {
                        requestPersistentStorage();
                        void replaceRejectedExtra(item.localId, item.rejectedRole as ExtraRole, true);
                      }}
                      style={[styles.errorBtn, { backgroundColor: colors.secondary }]}
                      accessibilityRole="button"
                      accessibilityLabel={t('takePhoto')}
                      testID={`replace-extra-camera-${item.localId}`}
                    >
                      <Feather name="camera" size={13} color={colors.secondaryForeground} />
                      <Text style={[styles.errorBtnText, { color: colors.secondaryForeground }]}>
                        {t('takePhoto')}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        requestPersistentStorage();
                        void replaceRejectedExtra(item.localId, item.rejectedRole as ExtraRole, false);
                      }}
                      style={[styles.errorBtn, { backgroundColor: colors.secondary }]}
                      accessibilityRole="button"
                      accessibilityLabel={t('chooseFromLibrary')}
                      testID={`replace-extra-library-${item.localId}`}
                    >
                      <Feather name="image" size={13} color={colors.secondaryForeground} />
                      <Text style={[styles.errorBtnText, { color: colors.secondaryForeground }]}>
                        {t('chooseFromLibrary')}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        changeQueue(() =>
                          removeRejectedExtra(item.localId, item.rejectedRole as ExtraRole),
                        )
                      }
                      style={[styles.errorBtn, { backgroundColor: colors.secondary }]}
                      accessibilityRole="button"
                      accessibilityLabel={t(
                        item.rejectedRole === 'face' ? 'removeFaceA11y' : 'removeBodyA11y',
                      )}
                      testID={`remove-extra-${item.localId}`}
                    >
                      <Feather name="x" size={13} color={colors.secondaryForeground} />
                      <Text style={[styles.errorBtnText, { color: colors.secondaryForeground }]}>
                        {t('removePhoto')}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : item.rejectionKey === 'spotTooLarge' && extrasOf(item).length > 0 ? (
                // SYC-415 spec §6.4: a spot too large to send is fixed by
                // removing a photo, never treated as unfixable.
                <>
                  <Text
                    style={[styles.pendingDate, { color: colors.mutedForeground }]}
                  >
                    {t('spotTooLarge')}
                  </Text>
                  <View style={[styles.errorActions, styles.replaceBtn]}>
                    {extrasOf(item).map((extra) => (
                      <Pressable
                        key={extra.role}
                        onPress={() =>
                          changeQueue(() => removeRejectedExtra(item.localId, extra.role))
                        }
                        style={[styles.errorBtn, { backgroundColor: colors.secondary }]}
                        accessibilityRole="button"
                        accessibilityLabel={t(extra.role === 'face' ? 'removeFaceA11y' : 'removeBodyA11y')}
                        testID={`remove-extra-${extra.role}-${item.localId}`}
                      >
                        <Feather name="x" size={13} color={colors.secondaryForeground} />
                        <Text style={[styles.errorBtnText, { color: colors.secondaryForeground }]}>
                          {t(extra.role === 'face' ? 'removeFaceA11y' : 'removeBodyA11y')}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : (
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
              ))}
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
              accessibilityRole="button"
              accessibilityLabel={t('discard')}
              style={styles.clearHit}
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
            <Pressable
              onPress={clearPhoto}
              disabled={submitting}
              hitSlop={8}
              accessibilityRole="button"
              // SYC-415: this throws the whole spot away, extras too, so it
              // is not "Retake photo" (that button keeps the extras).
              accessibilityLabel={t('startAgain')}
            >
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
        {/* SYC-574: "Spotting {name}", above the camera (and above a
            staged photo, which the hint applies to). */}
        {hintCat ? (
          <SpotHintBanner
            catName={hintCat.name}
            photoUrl={hintCat.photoUrl}
            onStop={() => dispatchHint({ kind: 'stop' })}
          />
        ) : null}
        {!photo && photoProblem && (
          // SYC-166: a library photo we can't use. The library is offered from
          // this card's own button: a browser only opens a file chooser from
          // a direct tap, never after an awaited dialog.
          <View testID="photo-problem">
            <Card padding={spacing[4]} style={{ gap: spacing[3] }}>
              <Text style={[styles.problemText, { color: colors.foreground }]}>
                {photoProblem.kind === 'tooOld'
                  ? t('photoTooOld')
                      .replaceAll('{date}', formatPhotoDate(photoProblem.instantMs, language))
                      .replaceAll('{days}', String(MAX_PHOTO_AGE_DAYS))
                  : t('photoAlreadyLogged')}
              </Text>
              {photoProblem.kind === 'alreadyLogged' && photoProblem.destination && (
                <Button
                  variant="secondary"
                  block
                  onPress={() => openAlreadyLogged(photoProblem.destination!)}
                >
                  {t('photoAlreadyLoggedOpen')}
                </Button>
              )}
              <Button variant="primary" block onPress={() => void pickPhoto(false)}>
                {t('chooseFromLibrary')}
              </Button>
            </Card>
          </View>
        )}
        {photo ? (
          // ── Details state: captured photo, location confirm, submit ──
          <>
            <NewSpotIntro
              photoUri={photo.uri}
              title={t('niceShot')}
              hint={t('spotLocationHint')}
              retakeLabel={t('retakePhoto')}
              onRetake={retakeFirstPhoto}
              disabled={submitting}
            />
            {/* SYC-415: the face and body boxes, only once the switch is on. */}
            {matchWaitSettings.extraPhotosOn && (
              <ExtraPhotoBoxes
                extras={extras}
                onAdd={(role, from) => void addExtra(role, from)}
                onRemove={removeExtra}
                disabled={submitting || preparingExtra}
              />
            )}
            {/* SYC-166: only what the photo itself said. Nothing when we did not
                read it (the camera, an empty answer from a phone's picker). */}
            {photoTime?.kind === 'ok' ? (
              <Text
                style={[styles.subtitle, { color: colors.mutedForeground }]}
                testID="photo-taken-at"
              >
                {t('photoTakenAt').replace(
                  '{when}',
                  formatPhotoTaken(photoTime.instantMs, language),
                )}
              </Text>
            ) : photoTime?.kind === 'none' ? (
              <Text
                style={[styles.subtitle, { color: colors.mutedForeground }]}
                testID="photo-no-time"
              >
                {t('photoNoTime')}
              </Text>
            ) : null}

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
              {/* SYC-48: the map is hidden while the waiting card shows.
                  SYC-524: so is the map's line while the location card asks. */}
              {waitChoice || locationAsk === 'card' ? null : (
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                  {t(mapStartHintKey(mapStart))}
                </Text>
              )}
              {/* SYC-524: the explain-first card, the small link or the
                  "location is off" line, above the map. */}
              {/* Nothing during the automatic ask: the phone's box is the UI. */}
              {!waitChoice &&
                askFrom !== 'auto' &&
                (locationAsk === 'card' ||
                  locationAsk === 'link' ||
                  locationAsk === 'off-native' ||
                  locationAsk === 'off-web') && (
                  <LocationAskCard
                    view={locationAsk}
                    busy={askFrom !== null && locating}
                    onUse={onUseWhereIAm}
                    onMap={onPutPinOnMap}
                    onOpenSettings={openLocationSettings}
                  />
                )}
              {/* SYC-48: while a sighting is being sent, the waiting card takes
                  the map's place (starter-facts.md §3.1). The pin is kept. */}
              {shouldShowWaitingCard({ waiting: waitChoice !== null }) && waitChoice ? (
                <WaitingCard choice={waitChoice} t={t} />
              ) : pickedCoords && locationAsk !== 'card' && (
                <LocationPicker
                  key={mapStartKey}
                  latitude={pickedCoords.latitude}
                  longitude={pickedCoords.longitude}
                  onChange={onMapMoved}
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
              disabled={!canCheckForMatches(mapStart, locationAsk) || !pickedCoords || submitting || !deviceId}
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
            {/* SYC-42: quiet, below the main action; reuses this photo and place. */}
            {photo && !submitting && (
              <NeedsHelpLink
                handoff={{ photo, coords: needsHelpCoords(mapStart, pickedCoords, mapTouched) }}
                style={{ alignSelf: 'center' }}
              />
            )}
          </>
        ) : (
          // ── Capture state: dark viewfinder treatment ──
          <>
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
              <Text
                style={styles.captureHint}
                accessibilityLabel={spokenText(liveCameraReady ? t('captureHint') : t('captureHintPicker'))}
              >
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
          {/* SYC-415 spec §3.2: reopens the tips any time. Below the viewfinder,
              left-aligned, well away from the shutter (and clear of the location chip). */}
          <Pressable
            testID="photo-tips-link"
            onPress={() => setTipsOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t('photoTipsLink')}
            style={styles.photoTipsLink}
          >
            <MaterialCommunityIcons
              name="lightbulb-on-outline"
              size={18}
              color={colors.primary}
            />
            <Text style={[styles.photoTipsLinkText, { color: colors.primary }]}>
              {t('photoTipsLink')}
            </Text>
          </Pressable>
          </>
        )}

        {permission === 'granted' && locating && !coords && !photo && (
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
      <PhotoTipsCard visible={tipsOpen && !photo} onClose={closeTips} />
    </View>
  );
}

const styles = StyleSheet.create({
  // SYC-509: 44pt tap area around a 16pt icon; the negative margins keep the row height without covering the text beside it.
  clearHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginVertical: -14, marginHorizontal: -4 },
  container: { flex: 1 },
  header: { paddingHorizontal: spacing[4], paddingBottom: spacing[2], gap: spacing[1] },
  title: { fontSize: fontSizes.xl, fontFamily: fonts.displayBold },
  subtitle: { fontSize: fontSizes.xs, fontFamily: fonts.body },
  problemText: { fontSize: fontSizes.sm, fontFamily: fonts.body, lineHeight: 20 },
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
  photoTipsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[1] + 2,
    minHeight: 44,
  },
  photoTipsLinkText: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.sm },
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
