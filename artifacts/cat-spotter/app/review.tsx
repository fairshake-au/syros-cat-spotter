import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ApiError,
  RequestTimeoutError,
  answerSightingQuestions,
  getGetCatQueryKey,
  recheckSighting,
  resolveSighting,
  suggestCatNames,
  useGetCat,
  type NameTakenCat,
  type ResolveResult,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";
import { useOffline } from "@/context/OfflineContext";
import { useDevice } from "@/context/DeviceContext";
import { SightingPhoto } from "@/components/SightingPhoto";
import { CatPicker } from "@/components/CatPicker";
import { PhotoTips } from "@/components/photoTips/PhotoTips";
import { useCatsWithCache } from "@/hooks/useCatsWithCache";
import {
  classifyResolveError,
  isBlankName,
  newCatRequest,
  noSignalMessage,
  pickerList,
  type PickedFrom,
} from "@/lib/catPicker";
import { photoSource } from "@/lib/urls";
import { NeedsHelpLink } from "@/components/report/NeedsHelpLink";
import { FeedNudge } from "@/components/FeedNudge";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useResultNudge } from "@/hooks/useResultNudge";
import { SightingQuestions } from "@/components/SightingQuestions";
import {
  answersRequest,
  classifyAnswersError,
  NO_ANSWERS,
  type SightingAnswers,
} from "@/lib/sightingAnswers";
import { reviewReportHandoff } from "@/lib/reportHandoff";
import { deleteReviewPhoto } from "@/lib/pendingPhotos";
import { goToSpotTab } from "@/lib/goToSpotTab";
import { useBannerAreaReserve } from "@/lib/bannerArea";
import {
  buildReviewParams,
  parseReviewParams,
  type ReviewRouteData,
} from "@/lib/reviewParams";
import { linkRecentPhotoToCat } from "@/lib/recentPhotos";
import { coverOf, hintOf } from "@/lib/offlineQueue";
import { canSpotFromPage } from "@/lib/spotHint";
import {
  Button,
  Badge,
  Tag,
  Card,
  IconButton,
  Input,
} from "@/components/purropolis";
import { palette } from "@/constants/colors";
import { decorative, spokenText } from "@/lib/a11yText";
import {
  fonts,
  fontSizes,
  radii,
  spacing,
  lineHeights,
} from "@/constants/theme";
import { catDisplayName, catNameInSentence } from '@/lib/catDisplayName';

function catCode(id: number): string {
  return `SYR-${String(id).padStart(4, "0")}`;
}

function confidenceTone(confidence: number): "success" | "warning" | "neutral" {
  if (confidence >= 0.75) return "success";
  if (confidence >= 0.4) return "warning";
  return "neutral";
}

/** SYC-503: the part of a review a "Check again" can change. */
type RecheckAnswer = Pick<
  ReviewRouteData,
  "isCatPhoto" | "candidates" | "matchCheck" | "canRecheck"
>;
type RecheckState =
  | "idle"
  | "checking"
  | "stillFailed"
  | "limit"
  | "busy"
  | "cantRecheck"
  | "offline"
  | "error";

/** The code on a refused recheck (RESOLVED, CHECK_RUNNING, NOT_CHECKABLE). */
function recheckCode(err: ApiError): string | undefined {
  const code = (err.data as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

function answerOf(data: ReviewRouteData): RecheckAnswer {
  return {
    isCatPhoto: data.isCatPhoto,
    candidates: data.candidates,
    matchCheck: data.matchCheck,
    canRecheck: data.canRecheck,
  };
}

export default function ReviewScreen() {
  const colors = useColors();
  const { t, language } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bannerReserve = useBannerAreaReserve();
  const queryClient = useQueryClient();
  const { remove, pending, isOnline, updateReview } = useOffline();
  const { deviceId } = useDevice();
  const params = useLocalSearchParams<{ data?: string }>();
  // SYC-503: the answer from a successful "Check again", which replaces the
  // route's own answer for the rest of this screen.
  const [rechecked, setRechecked] = useState<RecheckAnswer | null>(null);
  const [recheckState, setRecheckState] = useState<RecheckState>("idle");

  // The route carries short names only (spec §3.4): a queued item's localId,
  // or photoRef for an online submission. Never the photo itself.
  const routeData = useMemo(() => parseReviewParams(params.data), [params.data]);
  const data = routeData && rechecked ? { ...routeData, ...rechecked } : routeData;
  // SYC-503: read before isCatPhoto and candidates, which mean nothing on a
  // failed check (when-the-photo-check-fails.md §4).
  const checkFailed = data?.matchCheck === "failed";
  // A recheck's answer belongs to its own sighting only (review of SYC-503,
  // finding 9): a different sighting in the same screen starts fresh.
  const sightingId = routeData?.sightingId;
  useEffect(() => {
    setRechecked(null);
    setRecheckState("idle");
    setHintAnswered(false);
    setHintMessage(null);
    setHintRefused(false);
  }, [sightingId]);
  const queuedItem = data?.localId
    ? pending.find((p) => p.localId === data.localId)
    : undefined;

  // SYC-574 (design-review-fixes-oct22.md §2.3, §2.4): the cat the spotter
  // came to spot from its page. A queued spot keeps it on its queue item
  // (read by localId, so the Spot tab's list and the "ready to review" banner
  // need no change); an online send carries it in the route. It only ever
  // asks "Is this {name}?" first: it never changes what the matcher's answer
  // shows, and nothing below reads it.
  const hintCatId = data?.localId ? hintOf(queuedItem) : data?.hintCatId;
  const [hintAnswered, setHintAnswered] = useState(false);
  const [hintBusy, setHintBusy] = useState(false);
  // The question step's OWN message slot, never confirm()'s picker or send slots.
  const [hintMessage, setHintMessage] = useState<string | null>(null);
  // A refusal (NOT_NEARBY and the like): "Yes" becomes "Carry on".
  const [hintRefused, setHintRefused] = useState(false);
  const hintQuery = useGetCat(hintCatId ?? 0, {
    query: {
      enabled: hintCatId !== undefined,
      // One retry, not react-query's three: a cat that won't load should fall
      // back to no question quickly, not leave a bare spinner for ~7 s.
      retry: 1,
      // The cat page's own key, so the page the spotter came from answers it.
      queryKey: [...getGetCatQueryKey(hintCatId ?? 0), deviceId],
    },
    request: deviceId ? { headers: { "X-Device-Id": deviceId } } : undefined,
  });
  const hintCatData =
    hintCatId !== undefined && hintQuery.data?.cat?.id === hintCatId
      ? hintQuery.data.cat
      : null;
  // A cat in care or one that has died is never asked about.
  const hintCat = hintCatData && canSpotFromPage(hintCatData.lifeStatus) ? hintCatData : null;
  const hintLoading = hintCatId !== undefined && !hintCatData && hintQuery.isLoading === true;
  // SYC-415: the queued spot's cover photo (the face photo when there is one,
  // spec §5.1). Its uri and base64 always come from the same photo.
  const cover = queuedItem ? coverOf(queuedItem) : null;

  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [showNewCat, setShowNewCat] = useState(false);
  const [nameError, setNameError] = useState<"taken" | "offensive" | "syr" | null>(
    null,
  );
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [shownSuggestions, setShownSuggestions] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState(false);
  // SYC-119: "Find the cat yourself" (choose-a-different-cat.md §3).
  const [showPicker, setShowPicker] = useState(false);
  // SYC-151: a new cat chosen after looking is weak evidence it really is
  // new (spec §4.6), so the server is told the picker was opened.
  const [openedPicker, setOpenedPicker] = useState(false);
  // SYC-398 PR D: whether "Find the cat" had a chip picked when the spotter
  // chose "Add it as a new cat" (sighting_matches.colour_filter_on, spec §5).
  const [pickerFilterOn, setPickerFilterOn] = useState<boolean | undefined>(undefined);
  const [pickerMessage, setPickerMessage] = useState<string | null>(null);
  const [sendMessage, setSendMessage] = useState<string | null>(null);
  const [nameTakenCat, setNameTakenCat] = useState<NameTakenCat | null>(null);
  // Data spine PR 7: the optional questions on the reward screen.
  const [answers, setAnswers] = useState<SightingAnswers>(NO_ANSWERS);
  const [sendingAnswers, setSendingAnswers] = useState(false);
  const [answersFailed, setAnswersFailed] = useState(false);
  // SYC-508: one "Take another photo" at a time (review of #302, finding 6).
  const retaking = useRef(false);
  // The public cat-alogue: fresh with signal, the phone's saved copy without.
  const { cats } = useCatsWithCache();

  // "Nearby" is measured from where the photo was taken, as saved with the
  // sighting, never from where the phone is now (spec §4.8).
  const from = queuedItem
    ? { lat: queuedItem.lat, lng: queuedItem.lng }
    : data?.lat != null && data?.lng != null
      ? { lat: data.lat, lng: data.lng }
      : null;
  const nearbyIds = useMemo(
    () => new Set(from ? pickerList(from, cats, "").map((c) => c.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [from?.lat, from?.lng, cats],
  );

  // SYC-36 (match-wait plan PR 2): the feeding nudge, or the visitor's daily
  // one-liner, on the screen this result OPENED on, below everything the
  // spotter acts on. Decided once; never for a queued sighting or no cat.
  const openedOn = checkFailed
    ? "couldntCheck"
    : !data?.isCatPhoto
      ? "notCat"
      : data.candidates.length === 0
        ? "naming"
        : "matches";
  const { donateHost } = useAppSettings();
  const resultNudge = useResultNudge({
    deviceId,
    sightingId: data?.sightingId ?? null,
    localId: data?.localId,
    screen: openedOn,
  });
  const feedNudge = resultNudge.show ? (
    <FeedNudge
      variant={resultNudge.show.kind === "line" ? "line" : "full"}
      form={resultNudge.show.kind === "nudge" ? resultNudge.show.form : "link"}
      t={t}
      donateHost={donateHost}
      onHelp={resultNudge.help}
      onDismiss={resultNudge.dismiss}
    />
  ) : null;

  // SYC-508 §3.4: only a broken, typed or out-of-date link gets here
  // (parseReviewParams). Trying again can't fix that, so it says where saved
  // spots are and offers the way there, with a back arrow like the other steps.
  if (!data) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + bannerReserve + 8 }]}>
          <IconButton
            variant="ghost"
            label={t("back")}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)");
            }}
          >
            <Feather name="chevron-left" size={22} color={colors.mutedForeground} />
          </IconButton>
        </View>
        <View style={styles.openFailed} testID="review-open-failed">
          <View accessibilityLiveRegion="polite" aria-live="polite" style={styles.openFailedText}>
            <Text
              role="heading"
              style={[styles.successTitle, { color: colors.foreground, textAlign: "center" }]}
            >
              {t("reviewOpenFailedTitle")}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground, textAlign: "center" }]}>
              {t("reviewOpenFailedBody")}
            </Text>
          </View>
          <Button variant="primary" size="lg" wrapLabel style={{ maxWidth: "100%" }} onPress={() => goToSpotTab(router)}>
            {t("reviewOpenFailedCta")}
          </Button>
        </View>
      </View>
    );
  }

  const finishAndInvalidate = async (res: ResolveResult) => {
    setResult(res);
    // A resolved review's photo has done its job: a queued item's goes with
    // the item; an online submission's review-<id> photo is deleted now
    // (the sweep would otherwise keep it for seven days).
    if (data.localId) await remove(data.localId);
    // Deleted by the sighting's own id, never by the route's photoRef: the
    // route can be crafted, and it must not choose what gets deleted.
    if (data.photoRef) deleteReviewPhoto(data.sightingId).catch(() => {});
    // SYC-166 Decision C2: picking this photo again offers "Open that
    // sighting", which goes to this cat's page. Never throws.
    void linkRecentPhotoToCat(
      AsyncStorage,
      { sightingId: data.sightingId, localId: data.localId },
      res.cat.id,
      Date.now(),
    );
    queryClient.invalidateQueries();
  };

  // Sending any choice needs signal (spec §4.5). It is always attempted (the
  // online flag can be wrong on a weak connection); if the request can't get
  // through, the spotter is told plainly. A queued sighting stays in the
  // review list; one sent straight away has no entry there, so that spotter
  // is asked to keep the screen open instead (noSignalMessage).
  const noSignal = noSignalMessage({ inReviewList: queuedItem != null });
  const confirm = async (
    catId: number,
    pickedFrom?: PickedFrom | "name_prompt",
    colourFilterOn?: boolean,
  ) => {
    if (!deviceId) return;
    const say = pickedFrom ? setPickerMessage : setSendMessage;
    setBusy(true);
    say(null);
    try {
      await finishAndInvalidate(
        await resolveSighting(data.sightingId, {
          deviceId,
          catId,
          ...(pickedFrom ? { pickedFrom } : {}),
          ...(colourFilterOn !== undefined ? { colourFilterOn } : {}),
        }),
      );
    } catch (err) {
      const failure = classifyResolveError(err);
      if (failure.kind === "offline") say(noSignal);
      else if (failure.kind === "not-nearby") say("pickerNotNearby");
      else say("error");
      setBusy(false);
    }
  };

  const openPicker = () => {
    setPickerMessage(null);
    setOpenedPicker(true);
    setPickerFilterOn(undefined);
    setShowPicker(true);
  };

  // SYC-503 §2: "Check again" re-runs a failed check on the photo already
  // sent. Success lands on the screen the spotter would have seen first time.
  const recheck = async () => {
    if (!deviceId || !routeData) return;
    setRecheckState("checking");
    try {
      // Ends after RECHECK_REQUEST_TIMEOUT_MS (custom-fetch.ts) with a
      // RequestTimeoutError, never "Checking…" forever.
      const res = await recheckSighting(routeData.sightingId, { deviceId });
      const next: RecheckAnswer = {
        isCatPhoto: res.isCatPhoto,
        candidates: res.candidates,
        matchCheck: res.matchCheck,
        canRecheck: res.canRecheck,
      };
      setRechecked(next);
      setRecheckState(
        res.matchCheck === "done" ? "idle" : res.canRecheck ? "stillFailed" : "cantRecheck",
      );
      keepAnswer(next);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setRecheckState("limit");
      else if (err instanceof ApiError && err.status === 409 && recheckCode(err) === "CHECK_RUNNING") {
        // An earlier tap is still being checked: try again in a moment.
        setRecheckState("busy");
      } else if (err instanceof ApiError && err.status === 409) {
        // Resolved, or the failure was never recorded: not again from here.
        setRecheckState("cantRecheck");
        setRechecked((prev) => ({ ...(prev ?? answerOf(routeData)), canRecheck: false }));
      } else if (
        err instanceof RequestTimeoutError ||
        (!(err instanceof ApiError) && err instanceof TypeError)
      ) {
        setRecheckState("offline");
      }
      else setRecheckState("error");
    }
  };

  // The new answer outlives this screen: in the queue for a waiting spot, and
  // in the route so a reload shows it. Neither failing blocks the spotter.
  const keepAnswer = (next: RecheckAnswer) => {
    if (!routeData) return;
    if (routeData.localId) updateReview(routeData.localId, next).catch(() => {});
    try {
      router.setParams(buildReviewParams({ ...routeData, ...next }));
    } catch {
      // The screen already shows the new answer.
    }
  };

  const registerNew = async () => {
    if (isBlankName(newName) || !deviceId) return;
    setBusy(true);
    setNameError(null);
    setSendMessage(null);
    try {
      await finishAndInvalidate(
        await resolveSighting(
          data.sightingId,
          newCatRequest(deviceId, newName, openedPicker, pickerFilterOn),
        ),
      );
    } catch (err) {
      const failure = classifyResolveError(err);
      if (failure.kind === "name-taken") {
        // "Is this them?" only for a cat in the nearby set (spec §3.1, §4.8).
        // A cat further away would need "Ask Syros Cats", which stays hidden
        // until the team can act on it (plan Decision 4), so the spotter is
        // simply asked for another name, as before.
        if (failure.cat && nearbyIds.has(failure.cat.id)) {
          setNameTakenCat(failure.cat);
        } else {
          setNameError("taken");
        }
      } else if (failure.kind === "offensive") setNameError("offensive");
      else if (failure.kind === "syr-shaped") setNameError("syr");
      else if (failure.kind === "offline") setSendMessage(noSignal);
      setBusy(false);
    }
  };

  const fetchSuggestions = async () => {
    setSuggesting(true);
    setSuggestError(false);
    try {
      const res = await suggestCatNames({
        language,
        excludeNames: shownSuggestions,
      });
      setSuggestions(res.suggestions);
      setShownSuggestions((shown) => [...shown, ...res.suggestions]);
      if (res.suggestions.length === 0) setSuggestError(true);
    } catch {
      setSuggestError(true);
    } finally {
      setSuggesting(false);
    }
  };

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  // SYC-508 §5, D1 Option A: "No cat found" → Take another photo. A spot
  // saved for later leaves the review list (and its photos the phone), so
  // this screen stops coming back; a sent spot's 7-day photo goes too, by the
  // sighting's own id, never the route's photoRef. No points are at stake:
  // they're only given when a spot is finished.
  const retake = async () => {
    if (retaking.current) return;
    retaking.current = true;
    if (data.localId) await remove(data.localId).catch(() => {});
    if (data.photoRef) deleteReviewPhoto(data.sightingId).catch(() => {});
    goToSpotTab(router);
  };

  const yourPhoto = (
    <SightingPhoto
      uri={cover ? cover.uri : data.photoRef}
      base64={cover?.base64}
      style={[styles.pickerPhoto, { borderColor: colors.border }]}
      contentFit="cover"
    />
  );

  // ----- Success state -----
  if (result) {
    const openCat = () =>
      router.replace({
        pathname: "/cat/[id]",
        params: { id: String(result.cat.id) },
      });
    // Data spine PR 7: any answers are sent on the way to the cat's page.
    // Skipping everything sends nothing. A failed send never blocks the
    // spotter: they can try again or carry on without sending.
    const sendAnswersAndContinue = async () => {
      const body = deviceId ? answersRequest(deviceId, answers) : null;
      if (!body) {
        openCat();
        return;
      }
      setSendingAnswers(true);
      setAnswersFailed(false);
      try {
        await answerSightingQuestions(data.sightingId, body);
        openCat();
      } catch (err) {
        if (classifyAnswersError(err) === "retry") {
          setAnswersFailed(true);
          setSendingAnswers(false);
        } else {
          openCat();
        }
      }
    };
    return (
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[
          styles.successScroll,
          {
            paddingTop: insets.top + bannerReserve + 24,
            paddingBottom: insets.bottom + 32,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.successIcon, { backgroundColor: colors.accent }]}>
          <Feather name="check" size={34} color={colors.accentForeground} />
        </View>
        <Text style={[styles.successTitle, { color: colors.foreground }]}>
          {result.isNewCat ? t("newCatRegistered") : t("matchConfirmed")}
        </Text>
        <Text style={[styles.successCat, { color: colors.primary }]}>
          {catDisplayName(result.cat, t)}
        </Text>
        <Text
          style={[
            styles.monoId,
            { color: colors.mutedForeground, backgroundColor: colors.muted },
          ]}
        >
          {catCode(result.cat.id)}
        </Text>
        <Text style={[styles.points, { color: colors.foreground }]}>
          +{result.pointsAwarded} {t("pointsAwarded")}
        </Text>
        {result.newBadges.map((b) => (
          <View
            key={b}
            style={[styles.badgePill, { backgroundColor: colors.secondary }]}
          >
            <Feather
              name="award"
              size={16}
              color={colors.secondaryForeground}
            />
            <Text
              style={[
                styles.badgePillText,
                { color: colors.secondaryForeground },
              ]}
            >
              {t("newBadge")} {t(`badge_${b}`)}
            </Text>
          </View>
        ))}
        <View style={styles.questions}>
          <Text style={[styles.questionsHeading, { color: colors.foreground }]}>
            {t("questionsHeading")}
          </Text>
          <SightingQuestions
            catName={catNameInSentence(result.cat)}
            askEarTip={result.askEarTip}
            answers={answers}
            onChange={(patch) => setAnswers((prev) => ({ ...prev, ...patch }))}
            t={t}
          />
        </View>
        {answersFailed ? (
          <Text
            style={[styles.subtitle, { color: colors.destructive, textAlign: "center" }]}
          >
            {t("answersFailed")}
          </Text>
        ) : null}
        <Button
          variant="primary"
          size="lg"
          disabled={sendingAnswers}
          onPress={sendAnswersAndContinue}
        >
          {sendingAnswers
            ? "…"
            : answersFailed
              ? t("answersSend")
              : `${catNameInSentence(result.cat)} →`}
        </Button>
        {answersFailed ? (
          <Button variant="ghost" size="md" onPress={openCat}>
            {t("answersContinueWithout")}
          </Button>
        ) : null}
      </ScrollView>
    );
  }

  // ----- Not a cat -----
  // SYC-503: a failed check never looked at the photo, so never says this.
  if (!checkFailed && !data.isCatPhoto) {
    // SYC-415 spec §3.2: the photo tips always show here, when someone most
    // needs them. A ScrollView, so the tips fit on a short screen.
    return (
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 14,
        }}
      >
        <Feather name="help-circle" size={44} color={colors.mutedForeground} />
        <Text style={[styles.successTitle, { color: colors.foreground }]}>
          {t("notACat")}
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: colors.mutedForeground, textAlign: "center" },
          ]}
        >
          {t("notACatMsg")}
        </Text>
        {/* SYC-508 §5, D1 Option A (Samuel, 24 Oct): say what happens. */}
        <Text
          style={[
            styles.subtitle,
            { color: colors.foreground, textAlign: "center" },
          ]}
        >
          {t("notACatNotAdded")}
        </Text>
        <PhotoTips compact />
        <Button variant="primary" size="lg" wrapLabel style={{ maxWidth: "100%" }} onPress={retake}>
          {t("notACatRetake")}
        </Button>
      </ScrollView>
    );
  }

  // ----- "Is this {name}?" (SYC-574, §2.3): its own first step -----
  // Shown, identically, for every result except "not a cat" (which returned
  // above and drops the hint): matches, no candidates and couldn't-check. It
  // never looks at the candidates. "No" and "Carry on" open the screen the
  // result would have opened; openedOn already names that screen.
  if (hintCatId !== undefined && !hintAnswered && hintLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (hintCat && !hintAnswered) {
    const named = (key: string) => t(key).split("{name}").join(catNameInSentence(hintCat));
    const sayYes = async () => {
      if (!deviceId) return;
      setHintBusy(true);
      setHintMessage(null);
      try {
        await finishAndInvalidate(
          await resolveSighting(data.sightingId, {
            deviceId,
            catId: hintCat.id,
            // Decision D3 (R): recorded on every pick from this step,
            // suggestion or not. The server still decides the label.
            pickedFrom: "cat_page",
          }),
        );
      } catch (err) {
        const failure = classifyResolveError(err);
        if (failure.kind === "offline") {
          // Not a refusal: "Yes" stays, to try again with signal.
          setHintMessage(noSignal);
        } else {
          setHintMessage(failure.kind === "not-nearby" ? "hintNotNearby" : "hintCantAdd");
          setHintRefused(true);
        }
        setHintBusy(false);
      }
    };
    const carryOn = () => {
      setHintMessage(null);
      setHintAnswered(true);
    };
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="hint-question">
        <View style={[styles.header, { paddingTop: insets.top + bannerReserve + 8 }]}>
          <View style={{ width: 44 }} />
          <IconButton variant="ghost" label={t("extraPhotoClose")} onPress={close}>
            <Feather name="x" size={20} color={colors.mutedForeground} />
          </IconButton>
        </View>
        <ScrollView
          contentContainerStyle={[styles.nameTakenBody, { paddingBottom: insets.bottom + 32 }]}
        >
          <Text
            role="heading"
            style={[styles.nameTakenTitle, { color: colors.foreground }]}
            testID="hint-question-title"
          >
            {named("hintQuestion")}
          </Text>
          <View style={styles.compareRow}>
            <View style={{ flex: 1, gap: 6 }}>
              {/* One line each, so a long name can't push one photo below
                  the other (seen with "Bartholomew Whiskerton" at 390px). */}
              <Text
                numberOfLines={1}
                style={[styles.photoLabel, { color: colors.mutedForeground }]}
              >
                {t("yourPhoto")}
              </Text>
              {yourPhoto}
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text
                numberOfLines={1}
                style={[styles.photoLabel, { color: colors.mutedForeground }]}
              >
                {named("hintTheirPhoto")}
              </Text>
              <Image
                source={photoSource(hintCat.photoUrl)}
                style={[styles.pickerPhoto, { borderColor: colors.border }]}
                contentFit="cover"
                accessibilityLabel={named("hintTheirPhoto")}
              />
            </View>
          </View>
          {/* Separate keys: "Carry on" is a new button, never the "Yes" that
              was just tapped (a second tap on Yes must not carry on). */}
          {hintRefused ? (
            <Button
              key="hint-carry-on"
              variant="primary"
              size="lg"
              block
              wrapLabel
              testID="hint-carry-on"
              onPress={carryOn}
            >
              {t("hintCarryOn")}
            </Button>
          ) : (
            <Button
              key="hint-yes"
              variant="primary"
              size="lg"
              block
              wrapLabel
              disabled={hintBusy}
              testID="hint-yes"
              accessibilityLabel={named("hintYes")}
              onPress={sayYes}
            >
              {hintBusy ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                named("hintYes")
              )}
            </Button>
          )}
          {/* "No" has the same weight as "Yes" (§2.6: primed answers). */}
          {hintRefused ? null : (
            <Button
              variant="secondary"
              size="lg"
              block
              wrapLabel
              disabled={hintBusy}
              testID="hint-no"
              accessibilityLabel={named("hintNo")}
              onPress={carryOn}
            >
              {named("hintNo")}
            </Button>
          )}
          {hintMessage ? (
            <Text
              style={[styles.sendMessage, { color: colors.foreground }]}
              testID="hint-message"
            >
              {named(hintMessage)}
            </Text>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  // ----- Find the cat yourself (SYC-119) -----
  if (showPicker) {
    return (
      <CatPicker
        from={from}
        cats={cats}
        isOffline={!isOnline}
        busy={busy}
        message={pickerMessage}
        yourPhoto={yourPhoto}
        onPick={(catId, pickedFrom, colourFilterOn) => confirm(catId, pickedFrom, colourFilterOn)}
        onAddNew={(colourFilterOn) => {
          setPickerFilterOn(colourFilterOn);
          setShowPicker(false);
          setShowNewCat(true);
        }}
        onClose={() => setShowPicker(false)}
        insetTop={insets.top + bannerReserve}
        insetBottom={insets.bottom}
      />
    );
  }

  // ----- The name is taken by a cat near here: is this them? -----
  if (nameTakenCat) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + bannerReserve + 8 }]}>
          <IconButton
            variant="ghost"
            label={t("back")}
            onPress={() => setNameTakenCat(null)}
          >
            <Feather name="chevron-left" size={22} color={colors.mutedForeground} />
          </IconButton>
          <View style={{ width: 44 }} />
        </View>
        <ScrollView
          contentContainerStyle={[
            styles.nameTakenBody,
            { paddingBottom: insets.bottom + 32 },
          ]}
        >
          <Text style={[styles.nameTakenTitle, { color: colors.foreground }]}>
            {t("nameTakenIsThis").replace("{name}", nameTakenCat.name)}
          </Text>
          <View style={styles.compareRow}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[styles.photoLabel, { color: colors.mutedForeground }]}>
                {t("yourPhoto")}
              </Text>
              {yourPhoto}
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text
                style={[styles.photoLabel, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {nameTakenCat.name} · {catCode(nameTakenCat.id)}
              </Text>
              <Image
                source={photoSource(nameTakenCat.photoUrl)}
                style={[styles.pickerPhoto, { borderColor: colors.border }]}
                contentFit="cover"
              />
            </View>
          </View>
          {pickerMessage ? (
            <Text style={[styles.sendMessage, { color: colors.foreground }]}>
              {t(pickerMessage)}
            </Text>
          ) : null}
          <Button
            variant="primary"
            size="lg"
            block
            disabled={busy}
            onPress={() => confirm(nameTakenCat.id, "name_prompt")}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              t("nameTakenYes")
            )}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            block
            disabled={busy}
            onPress={() => {
              setNameTakenCat(null);
              setPickerMessage(null);
              setNameError("taken");
            }}
          >
            {t("nameTakenNo")}
          </Button>
        </ScrollView>
      </View>
    );
  }

  // ----- We couldn't check (SYC-503, when-the-photo-check-fails.md §2) -----
  if (checkFailed && !showNewCat) {
    const canRecheck = data.canRecheck && recheckState !== "cantRecheck";
    const line =
      recheckState === "stillFailed"
        ? t("couldntCheckStill")
        : recheckState === "limit"
          ? t("couldntCheckLimit")
          : recheckState === "busy"
            ? t("couldntCheckBusy")
          : recheckState === "cantRecheck" || !data.canRecheck
            ? t("couldntCheckCant")
            : recheckState === "offline"
              ? t(noSignal)
              : recheckState === "error"
                ? t("error")
                : null;
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + bannerReserve + 8 }]}>
          <View style={{ width: 44 }} />
          <IconButton variant="ghost" label={t("extraPhotoClose")} onPress={close}>
            <Feather name="x" size={20} color={colors.mutedForeground} />
          </IconButton>
        </View>
        <ScrollView
          contentContainerStyle={[styles.couldntCheckBody, { paddingBottom: insets.bottom + 32 }]}
          testID="couldnt-check"
        >
          <SightingPhoto
            uri={cover ? cover.uri : data.photoRef}
            base64={cover?.base64}
            style={[styles.couldntCheckPhoto, { borderColor: colors.border }]}
            contentFit="cover"
          />
          <Text style={[styles.couldntCheckTitle, { color: colors.foreground }]}>
            {t("couldntCheckTitle")}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, textAlign: "center" }]}>
            {t("couldntCheckBody")}
          </Text>
          {line ? (
            <Text
              style={[styles.sendMessage, { color: colors.foreground, textAlign: "center" }]}
              testID="couldnt-check-line"
            >
              {line}
            </Text>
          ) : null}
          <Button
            variant="primary"
            size="lg"
            block
            onPress={openPicker}
            testID="couldnt-check-find"
          >
            {t("couldntCheckFind")}
          </Button>
          {canRecheck ? (
            <Button
              variant="secondary"
              size="lg"
              block
              disabled={recheckState === "checking"}
              onPress={recheck}
              testID="couldnt-check-again"
            >
              {recheckState === "checking" ? t("couldntCheckChecking") : t("couldntCheckAgain")}
            </Button>
          ) : null}
          <Pressable
            onPress={() => setShowNewCat(true)}
            accessibilityRole="button"
            testID="couldnt-check-new"
            style={styles.couldntCheckNew}
          >
            <Text style={[styles.findItInstead, { color: colors.primary, fontFamily: fonts.bodyBold }]}>
              {t("couldntCheckNew")}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ----- ④ Name — a new furriend -----
  if (showNewCat || data.candidates.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LinearGradient
          colors={[palette.bougain500, palette.terra600]}
          style={[styles.celebrateHero, { paddingTop: insets.top + bannerReserve + 8 }]}
        >
          <View style={styles.celebrateHeaderRow}>
            {data.candidates.length > 0 || checkFailed ? (
              <IconButton
                variant="ghost"
                label={t("back")}
                onPress={() => setShowNewCat(false)}
              >
                <Feather name="chevron-left" size={22} color="#fff" />
              </IconButton>
            ) : (
              <View style={{ width: 44, height: 44 }} />
            )}
            <IconButton variant="ghost" label={t("extraPhotoClose")} onPress={close}>
              <Feather name="x" size={20} color="rgba(255,255,255,0.85)" />
            </IconButton>
          </View>
          <View style={styles.celebrateBody}>
            <View style={styles.celebrateAvatar}>
              {/* The spotter names the cat they can see (SYC-503); the
                  emoji only when this phone has no copy of the photo. */}
              {cover || data.photoRef ? (
                <SightingPhoto
                  uri={cover ? cover.uri : data.photoRef}
                  base64={cover?.base64}
                  style={styles.celebratePhoto}
                  contentFit="cover"
                  testID="naming-photo"
                />
              ) : (
                <Text style={{ fontSize: 52 }} {...decorative}>🐈‍⬛</Text>
              )}
            </View>
            <Text style={styles.celebrateTitle} role="heading" accessibilityLabel={spokenText(t("aNewFurriend"))}>{t("aNewFurriend")}</Text>
            <Text style={styles.celebrateSubtitle} testID="naming-subtitle">
              {/* SYC-503: whichever door led here, a failed check never
                  claims "you're the first to spot this cat". */}
              {checkFailed ? t("newFurriendSubtitleUnchecked") : t("newFurriendSubtitle")}
            </Text>
          </View>
        </LinearGradient>

        <ScrollView
          style={[styles.nameSheet, { backgroundColor: colors.background }]}
          contentContainerStyle={{
            padding: 22,
            gap: 12,
            paddingBottom: insets.bottom + 32,
          }}
        >
          <Input
            label={t("nameYourFurriend")}
            value={newName}
            onChangeText={(v) => {
              setNewName(v);
              if (nameError) setNameError(null);
            }}
            placeholder={t("nameYourCat")}
            maxLength={40}
            error={
              nameError
                ? t(
                    nameError === "offensive"
                      ? "catNameRejected"
                      : nameError === "syr"
                        ? "syrShapedName"
                        : "nameTaken",
                  )
                : undefined
            }
          />

          <Pressable
            onPress={openPicker}
            accessibilityRole="button"
            testID="find-it-instead"
          >
            <Text style={[styles.findItInstead, { color: colors.mutedForeground }]}>
              {t("findItInsteadLead")}{" "}
              <Text style={{ color: colors.primary, fontFamily: fonts.bodyBold }}>
                {t("findItInsteadAction")}
              </Text>
            </Text>
          </Pressable>

          <View style={styles.suggestRow}>
            <Pressable
              onPress={fetchSuggestions}
              disabled={suggesting}
              style={[
                styles.suggestBtn,
                { borderColor: colors.border, opacity: suggesting ? 0.6 : 1 },
              ]}
            >
              {suggesting ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather
                  name={suggestions.length > 0 ? "shuffle" : "zap"}
                  size={15}
                  color={colors.primary}
                />
              )}
              <Text style={[styles.suggestBtnText, { color: colors.primary }]}>
                {suggesting
                  ? t("suggestingNames")
                  : suggestions.length > 0
                    ? t("moreNameIdeas")
                    : t("suggestNames")}
              </Text>
            </Pressable>
          </View>
          {suggestError ? (
            <Text style={[styles.errorText, { color: colors.destructive }]}>
              {t("suggestNamesError")}
            </Text>
          ) : null}
          {suggestions.length > 0 ? (
            <View style={styles.chipRow}>
              <Text
                style={[styles.tryLabel, { color: colors.mutedForeground }]}
              >
                {t("tryLabel")}
              </Text>
              {suggestions.map((s, i) => {
                const tones = ["bougain", "sun", "olive"] as const;
                return (
                  <Pressable
                    key={s}
                    onPress={() => {
                      setNewName(s);
                      if (nameError) setNameError(null);
                    }}
                  >
                    <Tag tone={tones[i % tones.length]}>{s}</Tag>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {sendMessage ? (
            <Text style={[styles.sendMessage, { color: colors.foreground }]}>
              {t(sendMessage)}
            </Text>
          ) : null}
          <Button
            variant="primary"
            size="lg"
            block
            disabled={busy || isBlankName(newName)}
            onPress={registerNew}
            accessibilityLabel={busy ? undefined : spokenText(t("addToCatalogButton"))}
            style={{ marginTop: 8 }}
          >
            {busy ? (
              <ActivityIndicator
                size="small"
                color={colors.primaryForeground}
              />
            ) : (
              t("addToCatalogButton")
            )}
          </Button>
          {/* SYC-36: below the name form, only when naming is where this
              result opened (no possible matches). */}
          {openedOn === "naming" ? feedNudge : null}
        </ScrollView>
      </View>
    );
  }

  // ----- ③ Match — have we met? -----
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + bannerReserve + 8 }]}>
        <IconButton variant="ghost" label={t("tryAgain")} onPress={close}>
          <Feather
            name="chevron-left"
            size={22}
            color={colors.mutedForeground}
          />
        </IconButton>
        <Text
          role="heading"
          accessibilityLabel={spokenText(t("haveWeMetTitle"))}
          style={[styles.title, { color: colors.foreground }]}
        >
          {t("haveWeMetTitle")}
        </Text>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 14,
          paddingBottom: insets.bottom + 32,
        }}
      >
        <View style={styles.photoRow}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text
              style={[styles.photoLabel, { color: colors.mutedForeground }]}
            >
              {t("yourPhoto")}
            </Text>
            <SightingPhoto
              uri={cover ? cover.uri : data.photoRef}
              base64={cover?.base64}
              style={[styles.photo, { borderColor: colors.border }]}
              contentFit="cover"
            />
          </View>
        </View>

        {/* SYC-415 spec §6.4: an extra photo had gone from the phone, so the
            spot was sent with the others. */}
        {queuedItem?.extraNote === "extraMissing" && (
          <Text
            style={[styles.subtitle, { color: colors.mutedForeground }]}
            testID="extra-missing-note"
          >
            {t("extraMissingNote")}
          </Text>
        )}

        <View style={{ gap: 4 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {t("lookalikesFound")}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {t("matchQuestion")}
          </Text>
        </View>

        {data.candidates.map((c, index) => {
          const pct = Math.round(c.confidence * 100);
          const tone = confidenceTone(c.confidence);
          return (
            <Card key={c.catId} padding={12} style={styles.candidate}>
              <View style={styles.candidateRow}>
                <Image
                  source={photoSource(c.photoUrl)}
                  style={styles.candidatePhoto}
                  contentFit="cover"
                />
                <View style={{ flex: 1, gap: 5 }}>
                  <View style={styles.candidateNameRow}>
                    <Text
                      style={[
                        styles.candidateName,
                        { color: colors.foreground },
                      ]}
                      numberOfLines={1}
                    >
                      {catDisplayName(c, t)}
                    </Text>
                    {/* The catalog code is deliberately absent here: when you're
                        picking between look-alikes the name and the match score
                        are the decision, and SYR-#### is just noise. It still
                        appears on the cat profile and on the celebrate screen. */}
                  </View>
                  {tone === "neutral" ? (
                    <Tag tone="neutral">
                      {pct}% {t("matchPill")}
                    </Tag>
                  ) : (
                    <Badge tone={tone}>
                      {pct}% {t("matchPill")}
                    </Badge>
                  )}
                </View>
              </View>
              <Text
                style={[styles.reasoning, { color: colors.mutedForeground }]}
                numberOfLines={2}
              >
                {c.reasoning}
              </Text>
              <Button
                variant={index === 0 ? "primary" : "secondary"}
                size="md"
                block
                disabled={busy}
                onPress={() => confirm(c.catId)}
                // SYC-509: every card's button reads "That's the one", so the
                // label says which cat and how close the match is.
                accessibilityLabel={`${t("thatsTheOne")}: ${catDisplayName(c, t)}, ${pct}% ${t("matchPill")}`}
              >
                {busy ? (
                  <ActivityIndicator
                    size="small"
                    color={
                      index === 0 ? colors.primaryForeground : colors.foreground
                    }
                  />
                ) : (
                  t("thatsTheOne")
                )}
              </Button>
            </Card>
          );
        })}

        {sendMessage ? (
          <Text style={[styles.sendMessage, { color: colors.foreground }]}>
            {t(sendMessage)}
          </Text>
        ) : null}

        <Pressable
          onPress={openPicker}
          accessibilityRole="button"
          testID="find-the-cat-card"
          style={[
            styles.findCatCard,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <Feather name="search" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.findCatTitle, { color: colors.foreground }]}>
              {t("findCatCardTitle")}
            </Text>
            <Text style={[styles.findCatAction, { color: colors.primary }]}>
              {t("findCatCardAction")}
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </Pressable>

        <View style={styles.dividerRow}>
          <View
            style={[styles.dividerLine, { backgroundColor: colors.border }]}
          />
          <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>
            {t("or")}
          </Text>
          <View
            style={[styles.dividerLine, { backgroundColor: colors.border }]}
          />
        </View>

        <Pressable
          onPress={() => setShowNewCat(true)}
          accessibilityRole="button"
          style={[styles.newCatCard, { backgroundColor: colors.secondary }]}
        >
          <Text style={{ fontSize: 30 }} {...decorative}>✨</Text>
          <Text
            style={[
              styles.newCatCardTitle,
              { color: colors.secondaryForeground },
            ]}
          >
            {t("newCatCardTitle")}
          </Text>
          <Text
            style={[
              styles.newCatCardSubtitle,
              { color: colors.secondaryForeground },
            ]}
          >
            {t("newCatCardSubtitle")}
          </Text>
        </Pressable>

        {/* SYC-36: below the matches, "None of these" and "Find the cat
            yourself"; above "This cat needs help", which stays last. */}
        {feedNudge}

        {/* SYC-42 (Samuel, 2 Oct 2026): quiet, last on the screen, well apart
            from "Find the cat yourself"; reuses this sighting's photo and place. */}
        <NeedsHelpLink
          prepare={() =>
            reviewReportHandoff({
              photoRef: cover ? cover.uri : data.photoRef,
              photoBase64: cover?.base64,
              lat: from?.lat,
              lng: from?.lng,
            })
          }
          style={{ alignSelf: "center", marginTop: 4 }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  // SYC-508 §3.4: LoadFailed's full-size layout, with its own words.
  openFailed: {
    flex: 1,
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    gap: 12,
    padding: 20,
  },
  openFailedText: { alignItems: "center", gap: 8, maxWidth: 320 },
  successScroll: {
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  questions: { width: "100%", gap: spacing[2], marginTop: spacing[2] },
  questionsHeading: { fontSize: fontSizes.md, fontFamily: fonts.displayBold },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  title: {
    fontSize: fontSizes.lg,
    fontFamily: fonts.displayBold,
  },
  subtitle: {
    fontSize: fontSizes.sm,
    fontFamily: fonts.body,
    lineHeight: fontSizes.sm * lineHeights.normal,
  },
  photoRow: { flexDirection: "row", gap: 12 },
  photoLabel: { fontSize: fontSizes["2xs"], fontFamily: fonts.bodySemiBold },
  photo: {
    width: "100%",
    aspectRatio: 1.4,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  sectionTitle: { fontSize: fontSizes.md, fontFamily: fonts.bodyBold },
  findCatCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    padding: spacing[4],
  },
  findCatTitle: { fontSize: fontSizes.sm, fontFamily: fonts.bodyBold },
  findCatAction: { fontSize: fontSizes.sm, fontFamily: fonts.bodySemiBold },
  findItInstead: {
    fontSize: fontSizes.sm,
    fontFamily: fonts.body,
    textAlign: "center",
    paddingVertical: 4,
  },
  sendMessage: {
    fontSize: fontSizes.sm,
    fontFamily: fonts.bodySemiBold,
    textAlign: "center",
  },
  pickerPhoto: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  compareRow: { flexDirection: "row", gap: 12 },
  nameTakenBody: {
    padding: 16,
    gap: 14,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  nameTakenTitle: {
    fontSize: fontSizes.lg,
    fontFamily: fonts.displayBold,
    textAlign: "center",
  },
  candidate: { gap: 10 },
  candidateRow: { flexDirection: "row", gap: 13, alignItems: "center" },
  candidatePhoto: { width: 66, height: 66, borderRadius: radii.sm },
  candidateNameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  candidateName: {
    fontSize: fontSizes.md,
    fontFamily: fonts.displayBold,
    flexShrink: 1,
  },
  reasoning: { fontSize: fontSizes["2xs"], fontFamily: fonts.body },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 2,
  },
  dividerLine: { flex: 1, height: 1.5 },
  dividerText: { fontSize: fontSizes["2xs"], fontFamily: fonts.body },
  newCatCard: {
    borderRadius: radii.lg,
    padding: spacing[4],
    alignItems: "center",
    gap: 2,
  },
  newCatCardTitle: {
    fontSize: fontSizes.md,
    fontFamily: fonts.displayBold,
    marginTop: 4,
  },
  newCatCardSubtitle: {
    fontSize: fontSizes.xs,
    fontFamily: fonts.body,
    opacity: 0.85,
    textAlign: "center",
  },

  celebrateHero: {
    paddingBottom: 26,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
  },
  celebrateHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  celebrateBody: { alignItems: "center", paddingHorizontal: 30, paddingTop: 8 },
  celebrateAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  celebratePhoto: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  couldntCheckBody: {
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  couldntCheckPhoto: {
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 1,
  },
  couldntCheckTitle: {
    fontSize: fontSizes.xl,
    fontFamily: fonts.displayBold,
    textAlign: "center",
  },
  couldntCheckNew: { paddingVertical: 8 },
  celebrateTitle: {
    fontSize: fontSizes.xl,
    fontFamily: fonts.displayBold,
    color: "#fff",
    textAlign: "center",
  },
  celebrateSubtitle: {
    fontSize: fontSizes.sm,
    fontFamily: fonts.body,
    color: "rgba(255,255,255,0.9)",
    marginTop: 8,
    textAlign: "center",
  },
  nameSheet: {
    flex: 1,
    marginTop: -18,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
  suggestRow: { flexDirection: "row" },
  suggestBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  suggestBtnText: { fontSize: fontSizes.xs, fontFamily: fonts.bodySemiBold },
  errorText: { fontSize: fontSizes.xs, fontFamily: fonts.body },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  tryLabel: {
    fontSize: fontSizes["2xs"],
    fontFamily: fonts.bodyBold,
    alignSelf: "center",
  },
  monoId: {
    fontSize: fontSizes["2xs"],
    fontFamily: fonts.mono,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.xs,
    overflow: "hidden",
  },
  primaryBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    minWidth: 180,
  },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  successTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  successCat: { fontSize: 17, fontFamily: "Inter_700Bold" },
  points: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  badgePillText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
