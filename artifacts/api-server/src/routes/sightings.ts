import { Router, type IRouter, type Request } from "express";
import {
  AnswerSightingQuestionsBody,
  CreateSightingBody,
  ResolveSightingBody,
} from "@workspace/api-zod";
import {
  db,
  catsTable,
  photosTable,
  sightingsTable,
  sightingMatchesTable,
  profilesTable,
  observationsTable,
  type SuggestedMatch,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  PUBLIC_VIEWER,
  deriveCatStatuses,
  isResolvedDeceased,
  getProfileStats,
  profilePayload,
  serialiseCat,
} from "../lib/catHelpers";
import { blurPosition } from "../lib/blur";
import { badgesFor } from "../lib/badges";
import { clampCaptureTime } from "../lib/captureTime";
import { requireDeviceAuth, verifyDeviceSecret } from "../lib/deviceAuth";
import { createUpdateAndFanOut } from "../lib/notificationFanout";
import { writeObservation, type DbOrTx } from "../lib/observations";
import { catSubscriptionsTable } from "@workspace/db";
import { matchCatPhoto } from "../lib/matching";
import { validatePhotoBase64 } from "../lib/imageValidation";
import { containsOffensiveLanguage } from "../lib/moderation";
import {
  aiLimiter,
  checkDeviceMatchLimit,
  deviceMatchResetAt,
  DEVICE_MATCH_LIMIT,
  DEVICE_MATCH_WINDOW_MS,
} from "../middlewares/rateLimit";
import { safeError } from "../lib/logger";
import { selectCandidateCats } from "../lib/candidateSelection";
import {
  BLANK_NAME_BODY,
  catNamed,
  isBlankName,
  isUniqueViolation,
  nameTakenBody,
} from "../lib/catNames";
import { isNearby, publishedPosition } from "@workspace/geo";
import {
  catDisplayPhoto,
  catDisplayPhotos,
  hiddenPhotoIds,
  publicPhotoUrl,
  type PublicPhotoUrl,
} from "../lib/photoVisibility";

export const POINTS_CONFIRM = 15;
export const POINTS_NEW_CAT = 25;

// SYC-119 (choose-a-different-cat.md §4.8): the one refusal for a pick of a
// cat that isn't nearby. It is identical whatever the reason (too far, or no
// such cat), so a refusal can't be used to learn anything about a cat's
// position beyond what the public cat-alogue already says. The spec's copy
// continues "Ask Syros Cats to match it instead"; that route is hidden until
// the team can act on it (plan Decision 4), so the server doesn't offer it.
const NOT_NEARBY = {
  status: 422,
  body: {
    error: "That cat isn't listed near where you took this photo.",
    code: "NOT_NEARBY",
  },
} as const;

type Candidate = {
  catId: number;
  name: string;
  photoUrl: PublicPhotoUrl | null;
  confidence: number;
  reasoning: string;
};

// Data spine PR 5 (DECISIONS.md Part 2h, §6.3 point 3): below this, a
// candidate is left out of the response ENTIRELY — not nulled-out fields on
// an otherwise-present entry. Review of PR #64 found the first cut of this
// nulled catId/name/photoUrl but still returned the candidate, confidence
// and `reasoning` intact; the vision model's own `reasoning` routinely
// echoes the cat's name ("different coat from Agatha"), which hands a
// prober exactly what the redaction was meant to withhold. §6.3 point 3 says
// "not returned ... at all", which this now does literally: a withheld
// candidate contributes nothing to `candidates`, so there's nothing in the
// response — not even an anonymous placeholder — for its `reasoning` to leak
// through. The 0.1 floor just below stays as it was: real noise that
// shouldn't be offered at all, confident or not. At or above this threshold
// a candidate is shown; the boundary (exactly 0.4) is covered by a named
// test. 0.4 isn't named by the spec or DECISIONS.md — the plan leaves the
// exact figure to the builder, picked here as the point below which the
// vision model's own reasoning (SYC-39's matcher) is usually a guess rather
// than a likely match. Samuel decided (3 Oct 2026) to keep 0.4 for now and
// revisit once there's real matching data from ~100 resolved sightings to
// calibrate against (SYC-194).
const CONFIDENCE_THRESHOLD = 0.4;

const router: IRouter = Router();

// SYC-117 part 2 (add-details-later.md, approved 5 Oct 2026, Decisions 2 and
// 4): every question can be answered until 30 days after the photo was
// taken, from the reward screen or later from the cat's page. Measured from
// the capture time, not the match, so an answer's observedAt (the capture
// time) is always inside writeObservation's 30-day public limit and is never
// moved forward. Replaces PR 7's 24 hours after the match.
const ANSWER_WINDOW_MS = 30 * 86_400_000;

// §10.7's answer vocabulary, mapped to §10.1's ear_tip and food_and_water
// value shapes. "clipped_unsure" is a clipped tip on an ear the spotter
// isn't sure about, not an unsure answer (that's "cant_tell").
const EAR_TIP_VALUES = {
  clipped_left: { clipped: true, side: "left" },
  clipped_right: { clipped: true, side: "right" },
  clipped_unsure: { clipped: true, side: "unsure" },
  looks_whole: { clipped: false },
  cant_tell: { clipped: "cant_tell" },
} as const;
const FOOD_AND_WATER_VALUES = {
  yes: { present: true },
  no: { present: false },
  cant_tell: { present: "cant_tell" },
} as const;

type EarTipAnswer = keyof typeof EAR_TIP_VALUES;

/** The answer an ear_tip value records, for showing it back to the spotter. */
function earTipAnswerOf(value: unknown): EarTipAnswer | null {
  const v = value as { clipped?: unknown; side?: unknown } | null;
  if (v?.clipped === false) return "looks_whole";
  if (v?.clipped === "cant_tell") return "cant_tell";
  if (v?.clipped === true) {
    return v.side === "left"
      ? "clipped_left"
      : v.side === "right"
        ? "clipped_right"
        : "clipped_unsure";
  }
  return null;
}

/**
 * Where this device stands on this cat's ear tip (add-details-later.md
 * §3.1):
 * - "open": it has never answered;
 * - "answered": `current` is its answer that nothing has replaced, and it may
 *   change it;
 * - "checked": it has answered, and Syros Cats have checked it, so it can't
 *   be changed. That's either a row this device didn't write replacing one
 *   of its answers (a team correction), or any `sterilised` statement about
 *   the cat (only staff, the legacy admin route and backfills ever write
 *   one).
 */
async function earTipStateFor(
  tx: DbOrTx,
  deviceId: string,
  catId: number,
): Promise<
  | { state: "open" }
  | { state: "checked" }
  | { state: "answered"; current: { id: number; answer: EarTipAnswer | null } }
> {
  const mine = await tx
    .select({ id: observationsTable.id, value: observationsTable.value })
    .from(observationsTable)
    .where(
      and(
        eq(observationsTable.catId, catId),
        eq(observationsTable.deviceId, deviceId),
        eq(observationsTable.kind, "ear_tip"),
      ),
    );
  const [sterilised] = await tx
    .select({ id: observationsTable.id })
    .from(observationsTable)
    .where(and(eq(observationsTable.catId, catId), eq(observationsTable.kind, "sterilised")))
    .limit(1);
  // "Checked" only ever stops a change. A spotter with no answer yet can
  // always give a first one, on the reward screen or the cat's page, even
  // after the team has spoken about sterilisation (review of the SYC-117
  // part 2 build: this used to drop such first answers silently).
  if (mine.length === 0) return { state: "open" };
  if (sterilised) return { state: "checked" };

  const replacing = await tx
    .select({ supersedesId: observationsTable.supersedesId, deviceId: observationsTable.deviceId })
    .from(observationsTable)
    .where(inArray(observationsTable.supersedesId, mine.map((m) => m.id)));
  if (replacing.some((r) => r.deviceId !== deviceId)) return { state: "checked" };
  const replaced = new Set(replacing.map((r) => r.supersedesId));
  const current = mine.filter((m) => !replaced.has(m.id)).sort((a, b) => b.id - a.id)[0];
  if (!current) return { state: "checked" };
  return { state: "answered", current: { id: current.id, answer: earTipAnswerOf(current.value) } };
}

/**
 * Q3 → B (Samuel, 2 Oct 2026): each spotter is asked about a cat's ear tip
 * once, whatever they answered ("clipped", "looks whole" or "can't tell").
 * Any ear_tip observation this device has written about this cat counts,
 * superseded or not: being corrected by the team doesn't mean the spotter
 * should be asked again.
 */
async function hasAnsweredEarTip(
  tx: DbOrTx,
  deviceId: string,
  catId: number,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: observationsTable.id })
    .from(observationsTable)
    .where(
      and(
        eq(observationsTable.catId, catId),
        eq(observationsTable.deviceId, deviceId),
        eq(observationsTable.kind, "ear_tip"),
      ),
    )
    .limit(1);
  return row != null;
}

/** Thrown inside the resolve transaction when another resolve got there first. */
const ALREADY_RESOLVED = new Error("Sighting already resolved");

// Compare a submitted photo against the nearest known cats and return ranked
// candidates. Shared between a fresh submission and a deduped repeat (§3.6 of
// offline-queue-on-web.md) so both paths produce an equivalent response from
// the same logic, rather than two hand-maintained copies of it.
//
// SYC-151: it also writes the sighting's team-only match record, so resolve
// can tell a suggestion from a hand pick without taking the phone's word.
async function computeMatchCandidates(
  req: Request,
  sightingId: number,
  photoBase64: string,
  lat: number,
  lng: number,
): Promise<{ isCatPhoto: boolean; candidates: Candidate[] }> {
  // SYC-39: only cats within 500 m (exact positions), nearest first — see
  // selectCandidateCats and DECISIONS.md Part 2h.
  const cats = await db.select().from(catsTable);
  const nearest = selectCandidateCats(cats, lat, lng);

  let isCatPhoto = true;
  let candidates: Candidate[] = [];
  let matcherFailed = false;
  const candidateInputs: {
    catId: number;
    name: string;
    photoBase64: string;
    mime: string;
  }[] = [];
  // The team-only match record (SYC-151) always keeps the real cat ids, even
  // for a candidate the public response anonymises below the confidence
  // threshold — the redaction is a publication rule for the phone's
  // response, never a gap in what the server itself remembers (recordMatch,
  // below). Populated from `ranked`, not from the public `candidates`.
  let rankedForRecord: { catId: number; confidence: number }[] = [];

  try {
    for (const cat of nearest) {
      const [p] = await db
        .select()
        .from(photosTable)
        .where(eq(photosTable.id, cat.primaryPhotoId));
      if (p) {
        candidateInputs.push({
          catId: cat.id,
          name: cat.name,
          photoBase64: p.data,
          mime: p.mime,
        });
      }
    }
    const result = await matchCatPhoto(photoBase64, candidateInputs);
    isCatPhoto = result.isCatPhoto;
    const byId = new Map(nearest.map((cat) => [cat.id, cat]));
    // Only a cat the matcher was actually sent can be suggested (review F5):
    // a nearby cat whose photo row is gone was never compared.
    const sent = new Set(candidateInputs.map((c) => c.catId));
    // Data spine PR 5 (§6.3 point 3; DECISIONS.md Part 2h): ranked by
    // confidence, ties broken by cat id — NEVER by true distance, and
    // candidateInputs' nearest-first order (candidateSelection.ts) is used
    // only to decide who gets compared, not to decide who's returned first.
    // The tie-break on cat id, not distance, is what makes two equally
    // confident candidates come back in the same order every time, whatever
    // their true distances from the sighting.
    const ranked = result.matches
      .filter((m) => sent.has(m.catId) && m.confidence >= 0.1)
      .sort((a, b) => b.confidence - a.confidence || a.catId - b.catId)
      .slice(0, 3);
    // The team-only record keeps every ranked candidate, shown or not — see
    // the comment on `rankedForRecord`'s declaration. `labelChoice` (below)
    // is what stops a withheld one from ever being mislabelled "suggested".
    rankedForRecord = ranked.map((m) => ({ catId: m.catId, confidence: m.confidence }));
    // §6.3 point 3: a candidate below CONFIDENCE_THRESHOLD is left out of
    // `candidates` entirely (see the comment on CONFIDENCE_THRESHOLD) — only
    // `shown` ever reaches the public response.
    const shown = ranked.filter((m) => m.confidence >= CONFIDENCE_THRESHOLD);
    // One batched lookup for the (at most 3) shown cats' photos (SYC-98 Fable
    // review, finding 7: never a round trip per candidate). Only `shown` cats'
    // photos are ever looked up: a withheld candidate's photo is never
    // returned. A main photo the team hid is replaced as in the catalogue
    // (PR 6, Decision 4): this is the photo a spotter matches against.
    const shownPhotos = await catDisplayPhotos(shown.map((m) => byId.get(m.catId)!));
    candidates = shown.map((m) => {
      const cat = byId.get(m.catId)!;
      return {
        catId: cat.id,
        name: cat.name,
        photoUrl: shownPhotos.get(cat.id) ?? null,
        confidence: m.confidence,
        reasoning: m.reasoning,
      };
    });
  } catch (err) {
    matcherFailed = true;
    req.log.error({ err }, "AI matching failed; returning no candidates");
  }

  await recordMatch(req, sightingId, {
    // A failed call scored nothing, so nothing counts as compared (review
    // F1): a hand pick on it is then a distance miss, never a matcher miss.
    comparedCatIds: matcherFailed ? [] : candidateInputs.map((c) => c.catId),
    suggested: rankedForRecord.map((c, i) => ({
      catId: c.catId,
      rank: i + 1,
      score: c.confidence,
    })),
    matcherFailed,
  });

  return { isCatPhoto, candidates };
}

// SYC-151: store what was compared and suggested. The dedupe-hit path calls
// this again and overwrites the sets, because the phone shows the latest
// response (plan finding P3), but never once a choice has been recorded.
// Best effort: a failed write is logged and the sighting still gets its
// response; resolve then labels it "unlabelled" rather than guessing.
async function recordMatch(
  req: Request,
  sightingId: number,
  sets: {
    comparedCatIds: number[];
    suggested: SuggestedMatch[];
    matcherFailed: boolean;
  },
): Promise<void> {
  const values = { ...sets, matchedAt: new Date() };
  try {
    await db
      .insert(sightingMatchesTable)
      .values({ sightingId, ...values })
      .onConflictDoUpdate({
        target: sightingMatchesTable.sightingId,
        set: values,
        setWhere: isNull(sightingMatchesTable.chosenAt),
      });
  } catch (err) {
    req.log.error({ err, sightingId }, "Could not write the match record");
  }
}

/**
 * SYC-151 (choose-a-different-cat.md §4.6): how the spotter's choice was
 * made, as the server decides it. "Suggested" only if the cat is in the set
 * the server stored for this sighting AND the spotter was actually shown it
 * (its `storedSuggestion`, computed by the caller, already excludes anything
 * below CONFIDENCE_THRESHOLD — see the caller in the resolve route, and
 * review of PR #64's S2: before that filter, hand-picking a withheld,
 * below-threshold candidate was mislabelled "suggested" instead of a matcher
 * miss, because it was still sitting in the stored set even though the
 * spotter was never shown it). A hand pick is a matcher miss if the cat was
 * compared, and a distance miss if it never was. Without a stored set (a
 * sighting from before records existed) it doesn't guess.
 */
function labelChoice(input: {
  stored:
    | {
        comparedCatIds: number[] | null;
        suggested: SuggestedMatch[] | null;
        matcherFailed: boolean;
      }
    | undefined;
  storedSuggestion: SuggestedMatch | undefined;
  isNewCat: boolean;
  catId: number;
  pickedFrom: "nearby" | "search" | "name_prompt" | null;
  openedPicker: boolean;
}) {
  const base = {
    chosenCatId: input.catId,
    chosenAt: new Date(),
    suggestedRank: null as number | null,
    pickedFrom: null as string | null,
    missKind: null as string | null,
    openedPicker: null as boolean | null,
  };
  if (input.isNewCat) {
    return { ...base, choice: "new_cat", openedPicker: input.openedPicker };
  }
  if (!input.stored || input.stored.suggested == null) {
    return { ...base, choice: "unlabelled", pickedFrom: input.pickedFrom };
  }
  if (input.storedSuggestion) {
    return {
      ...base,
      choice: "suggested",
      suggestedRank: input.storedSuggestion.rank,
    };
  }
  return {
    ...base,
    choice: "hand_pick",
    pickedFrom: input.pickedFrom,
    // Data spine §10.9: when the matcher failed or had no photo, nothing was
    // really compared, so the pick is neither kind of miss.
    missKind: input.stored.matcherFailed
      ? null
      : (input.stored.comparedCatIds ?? []).includes(input.catId)
        ? "matcher_miss"
        : "distance_miss",
  };
}

// aiLimiter (per-IP cost ceiling) restored after review of PR #64 found it had
// been dropped — see the comment on the per-device limiter in rateLimit.ts
// for why this route needs both. Applied before body parsing, exactly as it
// was before this PR's device-keyed limiter existed.
router.post("/sightings", aiLimiter, async (req, res) => {
  const body = CreateSightingBody.parse(req.body);

  // SYC-92: the upload route was the one place a device id was taken on
  // trust — verifyDeviceSecret() below proves the caller holds this
  // device's secret before either the dedupe-hit response (which carries
  // an existing sighting's id, location and match candidates) or a fresh
  // upload is returned.
  //
  // Testers ARE live on this route today (apptest.catspotters.com, running
  // commit 6f9dccf at time of writing) — gating it is safe for a reason
  // more specific than "nobody's deployed yet":
  //   - Every build on that domain already sends X-Device-Secret on every
  //     request. custom-fetch.ts has attached it globally since ff25a9a
  //     (22 Jul); 6f9dccf includes that commit.
  //   - A device from before ff25a9a has no stored secret, but isn't
  //     locked out: DeviceContext.tsx mints one on next launch and the
  //     server binds it on first use (TOFU in deviceAuth.ts).
  //   - A queued offline upload can't race ahead of the secret either:
  //     DeviceContext.tsx registers the secret getter before it sets
  //     deviceId (same synchronous callback, getter first — see
  //     DeviceContext.test.tsx), and OfflineContext.syncNow() refuses to
  //     fire until deviceId is set. So by the time a queued item is
  //     eligible to sync, the getter it calls already returns a real
  //     secret.
  //   - There's no store build to worry about going stale (no eas.json in
  //     this repo) — web and Expo clients always load the current bundle.
  const verifiedDeviceId = await verifyDeviceSecret(req, res, body.deviceId);
  if (!verifiedDeviceId) return;

  // Data spine PR 5 (DECISIONS.md Part 2h, §6.3 point 2): candidate matching
  // is rate-limited per device, counted only now that verifyDeviceSecret has
  // proven the caller holds this device's secret (SYC-107) — never on the
  // raw body.deviceId, and never on the IP (middlewares/rateLimit.ts has the
  // full reasoning). Checked before the dedupe lookup, so a dedupe-hit
  // retry — which still re-runs computeMatchCandidates below — counts
  // against the same budget as a fresh upload, exactly as the old per-IP
  // limiter counted every POST to this route.
  let deviceWithinLimit: boolean;
  try {
    deviceWithinLimit = await checkDeviceMatchLimit(verifiedDeviceId);
  } catch (err) {
    // Not a cat-in-trouble route, so a limit that cannot count fails closed.
    req.log.error({ err: safeError(err) }, "device match limit counter failed");
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Please try again in a moment." });
    return;
  }
  if (!deviceWithinLimit) {
    // Nit from review of PR #64: the per-IP aiLimiter sends RateLimit-* and
    // Retry-After on a 429; this in-memory limiter had sent neither. A
    // client (or a spotter's phone, eventually) can't tell how long to back
    // off without one.
    const resetAt = await deviceMatchResetAt(verifiedDeviceId).catch(() => undefined);
    const retryAfterSeconds = Math.max(
      0,
      Math.ceil(
        (resetAt ?? Date.now() + DEVICE_MATCH_WINDOW_MS) / 1000 -
          Date.now() / 1000,
      ),
    );
    res.set("RateLimit-Limit", String(DEVICE_MATCH_LIMIT));
    res.set("RateLimit-Remaining", "0");
    res.set("RateLimit-Reset", String(retryAfterSeconds));
    res.set("Retry-After", String(retryAfterSeconds));
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return;
  }

  // When the client queued this offline, the spot happened before the sync.
  // Store the capture time (clamped) so streak day buckets reflect when the
  // cat was actually seen rather than when the network came back.
  const capturedAt = clampCaptureTime(body.capturedAt);

  // Dedupe (§3.6 of offline-queue-on-web.md, review finding F5): the page can
  // die after the upload reached the server but before the response arrived
  // (matching runs for seconds in between), so the client's retry is not
  // preceded by any failed write. Look up this device's sighting already
  // stored at this exact capture instant BEFORE inserting anything. A hit
  // means this is a repeat: return the existing sighting, re-running the
  // match against its own stored photo, instead of creating a second row.
  //
  // Residual race (accepted, no schema change per the spec): two requests
  // for the same device+capturedAt arriving concurrently can both miss this
  // SELECT before either INSERT commits, producing two rows. Closing that
  // fully needs a unique index on (device_id, created_at), which is a schema
  // change out of scope here (hosting-and-photo-storage.md §5.1).
  const [existing] = await db
    .select()
    .from(sightingsTable)
    .where(
      and(
        eq(sightingsTable.deviceId, body.deviceId),
        eq(sightingsTable.createdAt, capturedAt),
      ),
    );
  if (existing) {
    const [existingPhoto] = await db
      .select()
      .from(photosTable)
      .where(eq(photosTable.id, existing.photoId));
    // `sightings.photo_id` has no foreign key, and the approved deletion work
    // (DECISIONS.md F3) will remove photo bytes. A repeat for a sighting whose
    // photo has gone still returns that sighting rather than a 500 — just
    // without fresh matches, since there is nothing left to match against.
    const { isCatPhoto, candidates } = existingPhoto
      ? await computeMatchCandidates(
          req,
          existing.id,
          existingPhoto.data,
          existing.lat,
          existing.lng,
        )
      : { isCatPhoto: true, candidates: [] };
    if (!existingPhoto) {
      // SYC-151 (review F4): store the empty set the phone is shown now.
      // No photo means nothing was compared, which data spine §10.9 records
      // as matcherFailed, so it isn't read as "no cats nearby".
      await recordMatch(req, existing.id, {
        comparedCatIds: [],
        suggested: [],
        matcherFailed: true,
      });
    }
    res.status(201).json({ sightingId: existing.id, isCatPhoto, candidates });
    return;
  }

  const validated = await validatePhotoBase64(body.photoBase64);
  if ("error" in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const normalizedBase64 = validated.buffer.toString("base64");

  const [photo] = await db
    .insert(photosTable)
    .values({ data: normalizedBase64, mime: validated.mime })
    .returning();
  const [sighting] = await db
    .insert(sightingsTable)
    .values({
      deviceId: body.deviceId,
      photoId: photo!.id,
      lat: body.lat,
      lng: body.lng,
      status: "pending",
      createdAt: capturedAt,
    })
    .returning();

  const { isCatPhoto, candidates } = await computeMatchCandidates(
    req,
    sighting!.id,
    normalizedBase64,
    body.lat,
    body.lng,
  );

  res.status(201).json({ sightingId: sighting!.id, isCatPhoto, candidates });
});

router.post("/sightings/:sightingId/resolve", async (req, res) => {
  const sightingId = Number(req.params.sightingId);
  const body = ResolveSightingBody.parse(req.body);

  const [sighting] = await db
    .select()
    .from(sightingsTable)
    .where(eq(sightingsTable.id, sightingId));
  if (!sighting) {
    res.status(404).json({ error: "Sighting not found" });
    return;
  }
  if (sighting.status === "resolved") {
    res.status(409).json({ error: "Sighting already resolved" });
    return;
  }
  // Ownership check. The supplied device id must name the sighting's owner AND
  // the caller must prove they hold that device's secret. Comparing the two ids
  // alone would be checking a public value against itself: device ids travel in
  // request bodies and sighting ids are enumerable, so that would let anyone who
  // learned a device id resolve its sightings — awarding points, creating cats,
  // and receiving the owner's full profile in the response.
  if (body.deviceId !== sighting.deviceId) {
    res.status(403).json({ error: "Not your sighting" });
    return;
  }
  if (!(await verifyDeviceSecret(req, res, sighting.deviceId))) return;
  // Narrowed by the check above: an unlinked sighting (SYC-63) has no spotter,
  // so no device id matches it and nobody can resolve it from the app.
  const spotterId: string = sighting.deviceId;

  const statsBefore = await getProfileStats(spotterId);
  const badgesBefore = badgesFor(statsBefore);

  let existingCat: typeof catsTable.$inferSelect | undefined;
  let newCatName: string | undefined;

  // SYC-151: what the server itself suggested for this sighting. A sighting
  // from before match records existed has none.
  const [stored] = await db
    .select()
    .from(sightingMatchesTable)
    .where(eq(sightingMatchesTable.sightingId, sightingId));
  // Review of PR #64 (S2): `stored.suggested` holds every candidate the
  // matcher ranked, shown or withheld — see the comment on
  // `rankedForRecord` in computeMatchCandidates, above. A withheld candidate
  // (score < CONFIDENCE_THRESHOLD) was never actually shown to the spotter
  // (§6.3 point 3 / S1), so a hand pick of one is not a "suggestion" the
  // phone offered, however confidently the server's own stored set names
  // it — it must fall through to the hand-pick path below and land as a
  // matcher miss (it was compared, just scored too low to show). Requiring
  // the stored score to clear the threshold here, rather than splitting
  // `suggested` into separate shown/withheld fields, keeps every candidate's
  // score in one place for future recalibration (SYC-194) without a schema
  // change.
  const storedSuggestion =
    body.catId != null
      ? stored?.suggested?.find(
          (s) => s.catId === body.catId && s.score >= CONFIDENCE_THRESHOLD,
        )
      : undefined;

  if (body.catId != null) {
    const [existing] = await db
      .select()
      .from(catsTable)
      .where(eq(catsTable.id, body.catId));
    // SYC-119: a spotter may only choose a cat the server suggested for this
    // sighting, or one whose PUBLISHED square is within 1.5 km of the
    // sighting's stored location, the same shared rule the phone's list uses
    // (lib/geo). The published square is the one in the public payload: the
    // cell centre from blur.ts (data spine PR 6), which the phone receives
    // as the cat's lat/lng and lib/geo reads as-is. Never measured on exact positions: a refusal worked out from
    // them would answer "is this cat within 1.5 km of here?" about where it
    // really is. Every suggestion passes the distance rule anyway (500 m
    // exactly, plus at most ~177 m of snapping); the stored set is belt and
    // braces. `pickedFrom` plays no part. Checked only after ownership and
    // the device secret, so nobody can probe with someone else's sighting.
    const isHandPick = !storedSuggestion;
    // SYC-119 Slice D (choose-a-different-cat.md §4.8; data-spine.md PR 4):
    // a hand pick of a cat recorded as deceased gets the same NOT_NEARBY-
    // style refusal as a too-far pick — never a different one, so a
    // refusal can't be used to learn *why* a pick failed. A *suggested*
    // match is exempt: "a suggested match still clears the death" (§3.2),
    // and the matcher only ever suggests from nearby candidates anyway.
    const pickedDeceased = isHandPick && existing && (await isResolvedDeceased(existing.id));
    if (
      !existing ||
      pickedDeceased ||
      (isHandPick &&
        !isNearby(
          { lat: sighting.lat, lng: sighting.lng },
          publishedPosition(blurPosition(existing.lat, existing.lng)),
        ))
    ) {
      res.status(NOT_NEARBY.status).json(NOT_NEARBY.body);
      return;
    }
    existingCat = existing;
  } else if (body.newCatName && body.newCatName.trim().length > 0) {
    const name = body.newCatName.trim().slice(0, 60);
    if (isBlankName(name)) {
      res.status(400).json(BLANK_NAME_BODY);
      return;
    }
    if (containsOffensiveLanguage(name)) {
      res.status(400).json({
        error: "Cat name contains offensive language",
        code: "OFFENSIVE_NAME",
      });
      return;
    }
    const taken = await catNamed(name);
    if (taken) {
      res.status(409).json(await nameTakenBody(taken));
      return;
    }
    newCatName = name;
  } else {
    res.status(400).json({ error: "Provide catId or newCatName" });
    return;
  }

  let resolution;
  try {
    resolution = await db.transaction(async (tx) => {
      let cat = existingCat;
      const isNewCat = newCatName != null;
      const pointsAwarded = isNewCat ? POINTS_NEW_CAT : POINTS_CONFIRM;

      if (newCatName != null) {
        [cat] = await tx
          .insert(catsTable)
          .values({
            name: newCatName,
            description: "",
            primaryPhotoId: sighting.photoId,
            lat: sighting.lat,
            lng: sighting.lng,
            discovererDeviceId: sighting.deviceId,
          })
          .returning();
        // §5, §10.3: naming a new cat on resolve writes a name observation,
        // so no later rename destroys this first name. observedAt is the
        // sighting's own (clamped) capture time, not "now" — the name was
        // given when the cat was spotted, not when the sync reached the
        // server.
        await writeObservation(tx, {
          catId: cat!.id,
          kind: "name",
          value: { name: cat!.name, normalised: cat!.normalisedName },
          deviceId: sighting.deviceId,
          roleAtTime: "public",
          authorityScope: "none",
          observedAt: sighting.createdAt,
        });
      }

      // Only a pending sighting resolves (review F6): two resolves sent at
      // once used to both succeed and award points twice. The loser's
      // transaction rolls back, a new cat included.
      const updated = await tx
        .update(sightingsTable)
        .set({ catId: cat!.id, status: "resolved" })
        .where(
          and(
            eq(sightingsTable.id, sightingId),
            eq(sightingsTable.status, "pending"),
          ),
        )
        .returning({ id: sightingsTable.id });
      if (updated.length === 0) throw ALREADY_RESOLVED;

      await tx
        .insert(profilesTable)
        .values({ deviceId: spotterId, points: pointsAwarded })
        .onConflictDoUpdate({
          target: profilesTable.deviceId,
          set: { points: sql`${profilesTable.points} + ${pointsAwarded}` },
        });

      await tx
        .insert(catSubscriptionsTable)
        .values({ deviceId: spotterId, catId: cat!.id })
        .onConflictDoNothing();

      return { cat: cat!, pointsAwarded, isNewCat };
    });
  } catch (err: any) {
    if (err === ALREADY_RESOLVED) {
      res.status(409).json({ error: "Sighting already resolved" });
      return;
    }
    // Unique-index violation from a concurrent submission of the same name.
    if (isUniqueViolation(err)) {
      res.status(409).json(await nameTakenBody(await catNamed(newCatName!)));
      return;
    }
    throw err;
  }

  const { cat, pointsAwarded, isNewCat } = resolution;

  // SYC-151: the server's own label for this choice (§4.6), decided from the
  // stored set and never from what the phone says. Team-only, and best
  // effort: it is written after the spotter's resolve has committed, so a
  // failure here is logged and never costs the spotter their sighting.
  const label = labelChoice({
    stored,
    storedSuggestion,
    isNewCat,
    catId: cat.id,
    pickedFrom: body.pickedFrom ?? null,
    openedPicker: body.openedPicker === true,
  });
  try {
    await db
      .insert(sightingMatchesTable)
      .values({ sightingId, ...label })
      .onConflictDoUpdate({
        target: sightingMatchesTable.sightingId,
        set: label,
        // A label is written once (review F6).
        setWhere: isNull(sightingMatchesTable.chosenAt),
      });
  } catch (err) {
    req.log.error({ err, sightingId }, "Could not label the match record");
  }

  // Notification fan-out is best-effort and deliberately happens only after
  // the core resolve writes have committed.
  await createUpdateAndFanOut({
    cat,
    updateType: "sighting",
    message: isNewCat
      ? `${cat.name} was just discovered on Syros!`
      : `${cat.name} was spotted again!`,
    triggerSightingId: sightingId,
    excludeDeviceId: sighting.deviceId,
  });

  const profile = await profilePayload(sighting.deviceId);
  const newBadges = profile.badges.filter((b) => !badgesBefore.includes(b));
  const askEarTip = !(await hasAnsweredEarTip(db, sighting.deviceId, cat.id));

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sightingsTable)
    .where(eq(sightingsTable.catId, cat.id));

  // data-spine.md PR 4: hasHome is lifeStatus === "homed", derived, behind
  // the PR 3 gate (catHelpers.ts's deriveCatStatuses doc comment).
  const derivedStatus = (
    await deriveCatStatuses([{ id: cat.id, ownerDeviceId: cat.ownerDeviceId }])
  ).get(cat.id)!;
  // A cat whose discoverer deleted their data has nobody to look up (SYC-63).
  const [discoverer] =
    cat.discovererDeviceId === null
      ? []
      : await db
          .select({ nickname: profilesTable.nickname, username: profilesTable.username })
          .from(profilesTable)
          .where(eq(profilesTable.deviceId, cat.discovererDeviceId));

  // §10.6, emitter 3: this response used to hand any spotter who confirmed
  // a match the cat's exact stored position. It goes through the one
  // serialiser, public tier, like every other cat the app receives.
  res.json({
    cat: serialiseCat(
      {
        id: cat.id,
        name: cat.name,
        description: cat.description,
        photoUrl: await catDisplayPhoto(cat),
        lat: cat.lat,
        lng: cat.lng,
        ownerDeviceId: cat.ownerDeviceId,
        sightingsCount: countRow?.n ?? 1,
        lastSeenAt: sighting.createdAt,
        discovererDeviceId: cat.discovererDeviceId,
        discovererNickname: discoverer?.nickname ?? null,
        discovererUsername: discoverer?.username ?? null,
        ownerName: cat.ownerName,
        homeDescription: cat.homeDescription,
        homeLat: cat.homeLat,
        homeLng: cat.homeLng,
        derived: derivedStatus,
      },
      PUBLIC_VIEWER,
    ),
    pointsAwarded,
    isNewCat,
    newBadges,
    profile,
    askEarTip,
  });
});

/**
 * The answers to the optional questions about a sighting: data spine PR 7
 * (cat-record-data-spine.md §4.4, §7, §10.7), sent from the reward screen
 * after the points (Conflicts C5), and SYC-117 part 2 (add-details-later.md),
 * sent later from the cat's page. Each answer becomes its own observation
 * about the cat, through writeObservation; the sightings row is never
 * touched (SYC-63's append-only guard).
 *
 * - Accepted until ANSWER_WINDOW_MS after the photo was taken, from the
 *   sighting's own device.
 * - Each question once per sighting: an already-answered food-and-water or
 *   note is left out and the rest is recorded. ALREADY_ANSWERED only when
 *   nothing in the request could be recorded.
 * - The ear tip once per device per cat (Q3 → B): a second answer is left
 *   out, unless `changeEarTip` asks to replace the device's own current
 *   answer (Decision 3 → B), which is refused with EAR_TIP_CHECKED once
 *   Syros Cats have checked it.
 * - A request whose answers are all skipped writes nothing.
 */
router.post("/sightings/:sightingId/answers", async (req, res) => {
  const sightingId = Number(req.params.sightingId);
  const body = AnswerSightingQuestionsBody.parse(req.body);
  if (!Number.isInteger(sightingId)) {
    res.status(404).json({ error: "Sighting not found" });
    return;
  }

  const [sighting] = await db
    .select()
    .from(sightingsTable)
    .where(eq(sightingsTable.id, sightingId));
  if (!sighting) {
    res.status(404).json({ error: "Sighting not found" });
    return;
  }
  // The same ownership check as resolve: the device id must name the
  // sighting's owner AND the caller must hold that device's secret.
  if (body.deviceId !== sighting.deviceId) {
    res.status(403).json({ error: "Not your sighting" });
    return;
  }
  if (!(await verifyDeviceSecret(req, res, sighting.deviceId))) return;
  // Narrowed by the check above, as in resolve (SYC-63).
  const spotterId: string = sighting.deviceId;

  if (sighting.status !== "resolved" || sighting.catId == null) {
    res.status(409).json({
      error: "This sighting hasn't been matched to a cat yet",
      code: "NOT_RESOLVED",
    });
    return;
  }
  const catId = sighting.catId;

  if (Date.now() - sighting.createdAt.getTime() > ANSWER_WINDOW_MS) {
    res.status(422).json({
      error: "The questions for this sighting have closed",
      code: "ANSWERS_CLOSED",
    });
    return;
  }

  const note = body.note?.trim() ?? "";
  type Answer = {
    kind: "ear_tip" | "food_and_water" | "note";
    value: unknown;
    supersedesId?: number;
  };
  const answers: Answer[] = [];
  if (body.earTip) answers.push({ kind: "ear_tip", value: EAR_TIP_VALUES[body.earTip] });
  if (body.foodAndWater) {
    answers.push({ kind: "food_and_water", value: FOOD_AND_WATER_VALUES[body.foodAndWater] });
  }
  if (note.length > 0) answers.push({ kind: "note", value: { text: note } });

  if (answers.length === 0) {
    res.json({ recorded: [] });
    return;
  }

  const ALREADY_ANSWERED = { code: "ALREADY_ANSWERED" } as const;
  const EAR_TIP_CHECKED = { code: "EAR_TIP_CHECKED" } as const;
  let written: Answer[] = [];
  try {
    await db.transaction(async (tx) => {
      // Serialise every answer this device sends about this cat, so neither
      // "once per question per sighting" nor "ear tip once per cat" can be
      // beaten by two requests sent at once. An advisory lock, not SELECT ...
      // FOR UPDATE on the sighting, so nothing here even looks like a
      // sightings update. hashtext is 32-bit, so two devices can share a
      // key: that only makes them wait for each other briefly; the checks
      // below are exact.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`sighting-answers:${sighting.deviceId}`}), ${catId})`,
      );
      const answeredHere = new Set(
        (
          await tx
            .select({ kind: observationsTable.kind })
            .from(observationsTable)
            .where(
              and(
                eq(observationsTable.sightingId, sightingId),
                inArray(observationsTable.kind, ["food_and_water", "note"]),
              ),
            )
        ).map((r) => r.kind),
      );
      const toWrite: Answer[] = answers.filter(
        (a) => a.kind === "ear_tip" || !answeredHere.has(a.kind),
      );

      const ear = toWrite.find((a) => a.kind === "ear_tip");
      if (ear) {
        const keep = await (async (): Promise<boolean> => {
          const state = await earTipStateFor(tx, spotterId, catId);
          if (state.state === "open") return true;
          // Without changeEarTip a second answer is left out, as PR 7 did, so
          // the reward screen can never change an answer by accident.
          if (!body.changeEarTip) return false;
          if (state.state === "checked") throw EAR_TIP_CHECKED;
          if (state.current.answer === body.earTip) return false;
          // Lock the answer being replaced exactly as the team's supersede
          // endpoint does (routes/observations.ts), then check again that
          // nothing points at it. PR 7's advisory lock is per device and
          // cat and never meets the team's row lock, so without this a
          // change and a team correction sent at the same moment could both
          // point at the same answer, and the spotter's could win (second
          // review of add-details-later.md, 5 Oct 2026).
          await tx.execute(
            sql`select id from observations where id = ${state.current.id} for update`,
          );
          const [taken] = await tx
            .select({ id: observationsTable.id })
            .from(observationsTable)
            .where(eq(observationsTable.supersedesId, state.current.id))
            .limit(1);
          if (taken) throw EAR_TIP_CHECKED;
          ear.supersedesId = state.current.id;
          return true;
        })();
        if (!keep) toWrite.splice(toWrite.indexOf(ear), 1);
      }

      if (toWrite.length === 0) throw ALREADY_ANSWERED;

      for (const a of toWrite) {
        await writeObservation(tx, {
          catId,
          kind: a.kind,
          value: a.value,
          deviceId: sighting.deviceId,
          roleAtTime: "public",
          authorityScope: "none",
          // Phase 1: the app pre-fills nothing, so every answer is the
          // spotter's own (§10.7: "prompted" only when the app suggested it).
          provenance: "volunteered",
          sightingId,
          photoId: sighting.photoId,
          // When the spotter saw the cat, not when they tapped the answer.
          observedAt: sighting.createdAt,
          ...(a.supersedesId != null
            ? { supersedesId: a.supersedesId, supersedeReason: "changed by the spotter" }
            : {}),
        });
      }
      written = toWrite;
    });
  } catch (err) {
    if (err === ALREADY_ANSWERED) {
      res.status(409).json({
        error: "This sighting's questions were already answered",
        code: "ALREADY_ANSWERED",
      });
      return;
    }
    if (err === EAR_TIP_CHECKED) {
      res.status(409).json({
        error: "Syros Cats have already checked this cat's ear tip",
        code: "EAR_TIP_CHECKED",
      });
      return;
    }
    throw err;
  }

  res.json({ recorded: written.map((a) => a.kind) });
});

/**
 * SYC-117 part 2 (add-details-later.md §6): this device's resolved sightings
 * of this cat, taken within ANSWER_WINDOW_MS, that still have something to
 * add, for the "Anything to add?" card on the cat's page. Only the caller's
 * own sightings, behind its device secret. No coordinates, no note text.
 */
router.get("/profiles/:deviceId/cats/:catId/open-sightings", async (req, res) => {
  const deviceId = await requireDeviceAuth(req, res);
  if (!deviceId) return;
  const catId = Number(req.params.catId);
  if (!Number.isInteger(catId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const recent = await db
    .select({
      id: sightingsTable.id,
      createdAt: sightingsTable.createdAt,
      photoId: photosTable.id,
      publicId: photosTable.publicId,
    })
    .from(sightingsTable)
    .leftJoin(photosTable, eq(photosTable.id, sightingsTable.photoId))
    .where(
      and(
        eq(sightingsTable.deviceId, deviceId),
        eq(sightingsTable.catId, catId),
        eq(sightingsTable.status, "resolved"),
        gte(sightingsTable.createdAt, new Date(Date.now() - ANSWER_WINDOW_MS)),
      ),
    )
    .orderBy(desc(sightingsTable.createdAt));

  const answered = recent.length
    ? await db
        .select({ sightingId: observationsTable.sightingId, kind: observationsTable.kind })
        .from(observationsTable)
        .where(
          and(
            inArray(observationsTable.sightingId, recent.map((r) => r.id)),
            inArray(observationsTable.kind, ["food_and_water", "note"]),
          ),
        )
    : [];
  const ear = await earTipStateFor(db, deviceId, catId);
  // A photo the team hid is gone here too, even for the spotter who took it;
  // the card stays, so they can still add their note (PR 6, decided by
  // Samuel, 11 Oct 2026).
  const hidden = await hiddenPhotoIds(recent.map((r) => r.photoId ?? 0));

  const sightings = recent
    .map((r) => {
      const kinds = new Set(answered.filter((a) => a.sightingId === r.id).map((a) => a.kind));
      return {
        sightingId: r.id,
        takenAt: r.createdAt.toISOString(),
        photoUrl: publicPhotoUrl(
          r.photoId != null && r.publicId != null ? { id: r.photoId, publicId: r.publicId } : null,
          hidden,
        ),
        open: { foodAndWater: !kinds.has("food_and_water"), note: !kinds.has("note") },
      };
    })
    .filter((s) => s.open.foodAndWater || s.open.note || ear.state !== "checked");

  res.json({
    earTip:
      ear.state === "answered" && ear.current.answer
        ? { state: "answered", current: ear.current.answer }
        : { state: ear.state === "answered" ? "checked" : ear.state },
    sightings,
  });
});

export default router;
