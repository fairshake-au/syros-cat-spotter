import React, { useMemo, useState } from "react";
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
import {
  resolveSighting,
  suggestCatNames,
  ApiError,
  type ResolveResult,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";
import { useOffline } from "@/context/OfflineContext";
import { useDevice } from "@/context/DeviceContext";
import { SightingPhoto } from "@/components/SightingPhoto";
import { absoluteUrl } from "@/lib/urls";
import { deleteReviewPhoto } from "@/lib/pendingPhotos";
import { parseReviewParams } from "@/lib/reviewParams";
import {
  Button,
  Badge,
  Tag,
  Card,
  IconButton,
  Input,
} from "@/components/purropolis";
import { palette } from "@/constants/colors";
import {
  fonts,
  fontSizes,
  radii,
  spacing,
  lineHeights,
} from "@/constants/theme";

function catCode(id: number): string {
  return `SYR-${String(id).padStart(4, "0")}`;
}

function confidenceTone(confidence: number): "success" | "warning" | "neutral" {
  if (confidence >= 0.75) return "success";
  if (confidence >= 0.4) return "warning";
  return "neutral";
}

export default function ReviewScreen() {
  const colors = useColors();
  const { t, language } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { remove, pending } = useOffline();
  const { deviceId } = useDevice();
  const params = useLocalSearchParams<{ data?: string }>();

  // The route carries short names only (spec §3.4): a queued item's localId,
  // or photoRef for an online submission. Never the photo itself.
  const data = useMemo(() => parseReviewParams(params.data), [params.data]);
  const queuedItem = data?.localId
    ? pending.find((p) => p.localId === data.localId)
    : undefined;

  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [showNewCat, setShowNewCat] = useState(false);
  const [nameError, setNameError] = useState<"taken" | "offensive" | null>(
    null,
  );
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [shownSuggestions, setShownSuggestions] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState(false);

  if (!data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>{t("error")}</Text>
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
    queryClient.invalidateQueries();
  };

  const confirm = async (catId: number) => {
    if (!deviceId) return;
    setBusy(true);
    try {
      await finishAndInvalidate(
        await resolveSighting(data.sightingId, { deviceId, catId }),
      );
    } catch {
      setBusy(false);
    }
  };

  const registerNew = async () => {
    if (!newName.trim() || !deviceId) return;
    setBusy(true);
    setNameError(null);
    try {
      await finishAndInvalidate(
        await resolveSighting(data.sightingId, {
          deviceId,
          newCatName: newName.trim(),
        }),
      );
    } catch (err) {
      const code =
        err instanceof ApiError
          ? (err.data as { code?: string } | null)?.code
          : undefined;
      if (code === "NAME_TAKEN") setNameError("taken");
      else if (code === "OFFENSIVE_NAME") setNameError("offensive");
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

  // ----- Success state -----
  if (result) {
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: colors.background, padding: 24, gap: 14 },
        ]}
      >
        <View style={[styles.successIcon, { backgroundColor: colors.accent }]}>
          <Feather name="check" size={34} color={colors.accentForeground} />
        </View>
        <Text style={[styles.successTitle, { color: colors.foreground }]}>
          {result.isNewCat ? t("newCatRegistered") : t("matchConfirmed")}
        </Text>
        <Text style={[styles.successCat, { color: colors.primary }]}>
          {result.cat.name}
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
        <Button
          variant="primary"
          size="lg"
          onPress={() => {
            router.replace({
              pathname: "/cat/[id]",
              params: { id: String(result.cat.id) },
            });
          }}
        >
          {result.cat.name} →
        </Button>
      </View>
    );
  }

  // ----- Not a cat -----
  if (!data.isCatPhoto) {
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: colors.background, padding: 24, gap: 14 },
        ]}
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
        <Button variant="primary" size="lg" onPress={close}>
          {t("tryAgain")}
        </Button>
      </View>
    );
  }

  // ----- ④ Name — a new furriend -----
  if (showNewCat || data.candidates.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LinearGradient
          colors={[palette.bougain500, palette.terra600]}
          style={[styles.celebrateHero, { paddingTop: insets.top + 8 }]}
        >
          <View style={styles.celebrateHeaderRow}>
            {data.candidates.length > 0 ? (
              <IconButton
                variant="ghost"
                label={t("tryAgain")}
                onPress={() => setShowNewCat(false)}
              >
                <Feather name="chevron-left" size={22} color="#fff" />
              </IconButton>
            ) : (
              <View style={{ width: 40, height: 40 }} />
            )}
            <Pressable onPress={close} hitSlop={8}>
              <Feather name="x" size={20} color="rgba(255,255,255,0.85)" />
            </Pressable>
          </View>
          <View style={styles.celebrateBody}>
            <View style={styles.celebrateAvatar}>
              <Text style={{ fontSize: 52 }}>🐈‍⬛</Text>
            </View>
            <Text style={styles.celebrateTitle}>{t("aNewFurriend")}</Text>
            <Text style={styles.celebrateSubtitle}>
              {t("newFurriendSubtitle")}
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
                ? t(nameError === "offensive" ? "catNameRejected" : "nameTaken")
                : undefined
            }
          />

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

          <Button
            variant="primary"
            size="lg"
            block
            disabled={busy || !newName.trim()}
            onPress={registerNew}
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
        </ScrollView>
      </View>
    );
  }

  // ----- ③ Match — have we met? -----
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <IconButton variant="ghost" label={t("tryAgain")} onPress={close}>
          <Feather
            name="chevron-left"
            size={22}
            color={colors.mutedForeground}
          />
        </IconButton>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t("haveWeMetTitle")}
        </Text>
        <View style={{ width: 40 }} />
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
              uri={queuedItem ? queuedItem.photoUri : data.photoRef}
              base64={queuedItem?.photoBase64}
              style={[styles.photo, { borderColor: colors.border }]}
              contentFit="cover"
            />
          </View>
        </View>

        <View style={{ gap: 4 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {data.candidates.length} {t("lookalikesFound")}
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
                  source={{ uri: absoluteUrl(c.photoUrl) }}
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
                      {c.name}
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
          style={[styles.newCatCard, { backgroundColor: colors.secondary }]}
        >
          <Text style={{ fontSize: 30 }}>✨</Text>
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
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
