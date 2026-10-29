import { reviewMatcherHealth } from "../lib/matcherHealth";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  AnswerSightingQuestionsBody,
  CreateSightingBody,
  RecheckSightingBody,
  ResolveSightingBody,
} from "@workspace/api-zod";
import {
  db,
  catsTable,
  photosTable,
  sightingsTable,
  sightingMatchesTable,
  sightingMovesTable,
  sightingPhotosTable,
  profilesTable,
  observationsTable,
  type SightingPhotoRole,
  type SuggestedMatch,
  type PICKED_FROM,
} from "@workspace/db";
import { and, asc, desc, eq, getTableColumns, gte, inArray, isNotNull, isNull, not, or, sql, type SQL } from "drizzle-orm";
import {
  PUBLIC_VIEWER,
  deriveCatStatuses,
  isResolvedDeceased,
  profilePayload,
  serialiseCat,
} from "../lib/catHelpers";
import { blurPosition } from "../lib/blur";
import { thresholdBadges } from "../lib/badges/catalogue";
import { computeBadgeStats } from "../lib/badges/stats";
import { awardBadges, eventBadgesForSpot, queueMoment } from "../lib/badges/award";
import { clampCaptureTime } from "../lib/captureTime";
import { requireDeviceAuth, verifyDeviceSecret } from "../lib/deviceAuth";
import { createUpdateAndFanOut } from "../lib/notificationFanout";
import { spottedAgainMessage } from "../lib/sightingMessage";
import { replacedByMove, writeObservation, type DbOrTx } from "../lib/observations";
import { matchCatPhoto, type NewPhotoInput } from "../lib/matching";
import { saveSpotWithPhotos, spotPhotoList, validateSpotPhotos } from "../lib/spotPhotos";
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
import { canonicalCatOf, catsFeeding, liveCats, observationCatIn, type Feeding } from "../lib/catIdentity";
import { awardPoints } from "../lib/pointsLedger";
import { lockSurvivor } from "../lib/survivor";
import { placeFor } from "../lib/areas/placeFor";
import {
  BLANK_NAME_BODY,
  catNamed,
  hasLinkOrPhoneNumber,
  isBlankName,
  isSyrShapedName,
  NAME_HAS_LINK_BODY,
  SYR_SHAPED_NAME_BODY,
  isUniqueViolation,
  nameTakenBody,
  OFFENSIVE_NAME_WORDS,
} from "../lib/catNames";
import { isNearby, publishedPosition } from "@workspace/geo";
import {
  catDisplayPhoto,
  catDisplayPhotos,
  catMatchingPhotoIds,
  hiddenPhotoIds,
  publicPhotoUrl,
  type PublicPhotoUrl,
} from "../lib/photoVisibility";

import { POINTS_CONFIRM, POINTS_NEW_CAT } from "../lib/points";
import { writeNewCatChecks } from "../lib/newCatCheck";
export { POINTS_CONFIRM, POINTS_NEW_CAT };

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
 *
 * Exported for the move tests (SYC-150 PR 3.1).
 */
export async function earTipStateFor(
  tx: DbOrTx,
  deviceId: string,
  catId: number,
): Promise<
  | { state: "open" }
  | { state: "checked" }
  | { state: "answered"; current: { id: number; answer: EarTipAnswer | null } }
> {
  // Through the cat this one now is, with every cat merged into it, and
  // leaving out answers a move took to another cat (which-cat-is-which.md
  // §9.5): after a move each cat is as if the sighting had always been
  // where it is now.
  const feeding = await feedingOfCanonical(tx, catId);
  const mine = await tx
    .select({ id: observationsTable.id, value: observationsTable.value })
    .from(observationsTable)
    .where(
      and(
        observationCatIn(feeding),
        eq(observationsTable.deviceId, deviceId),
        eq(observationsTable.kind, "ear_tip"),
        not(replacedByMove(observationsTable.id)),
        sightingStillHere(feeding),
      ),
    );
  const [sterilised] = await tx
    .select({ id: observationsTable.id })
    .from(observationsTable)
    .where(and(observationCatIn(feeding), eq(observationsTable.kind, "sterilised")))
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
export async function hasAnsweredEarTip(
  tx: DbOrTx,
  deviceId: string,
  catId: number,
): Promise<boolean> {
  // As earTipStateFor: through the cat this one now is, leaving out answers
  // a move took to another cat.
  const feeding = await feedingOfCanonical(tx, catId);
  const [row] = await tx
    .select({ id: observationsTable.id })
    .from(observationsTable)
    .where(
      and(
        observationCatIn(feeding),
        eq(observationsTable.deviceId, deviceId),
        eq(observationsTable.kind, "ear_tip"),
        not(replacedByMove(observationsTable.id)),
        sightingStillHere(feeding),
      ),
    )
    .limit(1);
  return row != null;
}

/**
 * SQL: the answer is about this cat's own sightings. An answer on a sighting
 * now filed under a cat outside this group went with its sighting
 * (which-cat-is-which.md §9.5), and so did every earlier answer of the same
 * spotter on it, even one only their own change replaced (review of #380,
 * R1). An answer with no sighting stays.
 */
function sightingStillHere(feeding: readonly Feeding[]): SQL {
  const ids = [...new Set(feeding.flatMap((f) => f.ids))];
  return sql`(${observationsTable.sightingId} is null or exists (
    select 1 from sightings here
     where here.id = ${observationsTable.sightingId}
       and here.cat_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})))`;
}

/** The cats whose statements count for the cat `catId` now is (itself if it's in a merge loop). */
async function feedingOfCanonical(tx: DbOrTx, catId: number): Promise<Feeding[]> {
  const canonical = (await canonicalCatOf([catId], {}, tx)).get(catId) ?? catId;
  return [...(await catsFeeding([canonical], {}, tx)).values()];
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
//
// SYC-415 (spec §5.2): `photos` is every photo of the spot, in position
// order, and the record also notes "no cat in any photo" and "may be more
// than one cat".
/** The cats a photo check compares against: every live cat (exported for the merge tests). */
export const matcherPool = () => liveCats(getTableColumns(catsTable));

async function computeMatchCandidates(
  req: Request,
  sightingId: number,
  photos: NewPhotoInput[],
  lat: number,
  lng: number,
): Promise<MatchAnswer> {
  // SYC-39: only cats within 500 m (exact positions), nearest first — see
  // selectCandidateCats and DECISIONS.md Part 2h.
  // A merged-away cat is part of the cat she was merged into, so she is not a
  // candidate of her own (spec §9.3).
  const cats = await matcherPool();
  const nearest = selectCandidateCats(cats, lat, lng);

  let isCatPhoto = true;
  let mixedCats = false;
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
    // SYC-303: a main photo hidden for a privacy reason is never sent; the
    // cat is compared by the photo the public sees instead, or not at all.
    const matchPhotoIds = await catMatchingPhotoIds(nearest);
    for (const cat of nearest) {
      const photoId = matchPhotoIds.get(cat.id) ?? null;
      if (photoId === null) continue;
      const [p] = await db.select().from(photosTable).where(eq(photosTable.id, photoId));
      // SYC-462 spec §6 item 3: a main photo removed for good (no picture) is
      // never sent; that cat simply isn't compared.
      if (p && p.data !== null) {
        candidateInputs.push({
          catId: cat.id,
          name: cat.name,
          photoBase64: p.data,
          mime: p.mime,
        });
      }
    }
    const result = await matchCatPhoto(photos, candidateInputs, "sighting_match");
    isCatPhoto = result.isCatPhoto;
    // `=== true`: an answer (or a test mock) in the old shape has no
    // mixedCats, which means "not mixed", never unknown.
    mixedCats = result.mixedCats === true;
    const byId = new Map(nearest.map((cat) => [cat.id, cat]));
    // Only a cat the matcher was actually sent can be suggested (review F5):
    // a nearby cat whose photo row is gone, or was removed for good (SYC-462),
    // was never compared.
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
        namePending: cat.namePending,
        photoUrl: shownPhotos.get(cat.id) ?? null,
        confidence: m.confidence,
        reasoning: m.reasoning,
      };
    });
  } catch (err) {
    matcherFailed = true;
    req.log.error({ err }, "AI matching failed; telling the phone the check failed");
  }

  const recorded = await recordMatch(req, sightingId, {
    // A failed call scored nothing, so nothing counts as compared (review
    // F1): a hand pick on it is then a distance miss, never a matcher miss.
    comparedCatIds: matcherFailed ? [] : candidateInputs.map((c) => c.catId),
    suggested: rankedForRecord.map((c, i) => ({
      catId: c.catId,
      rank: i + 1,
      score: c.confidence,
    })),
    matcherFailed,
    // SYC-415 §6.2 point 3 / §8: unknown (null) when the matcher failed.
    noCatInAnyPhoto: matcherFailed ? null : !isCatPhoto,
    mixedCats: matcherFailed ? null : mixedCats,
  });

  // SYC-532: tell the team when checks start failing, and when they recover.
  // Never throws, and never changes the answer below.
  await reviewMatcherHealth();

  // SYC-503: a failed check is never "no look-alikes". The phone reads
  // matchCheck first; isCatPhoto stays true only because nothing is known.
  // A failure the server couldn't write down can't be re-checked: recheck
  // only runs on a stored failure (review of SYC-503, finding 8).
  return matcherFailed
    ? { isCatPhoto: true, candidates: [], matchCheck: "failed", canRecheck: recorded }
    : { isCatPhoto, candidates, matchCheck: "done", canRecheck: false };
}

/**
 * SYC-503: what the phone is told after a check. `matchCheck` says whether
 * the look-alike check worked at all; `canRecheck` says a failed one can be
 * run again (false when the photo has gone and there is nothing to check).
 */
type MatchAnswer = {
  isCatPhoto: boolean;
  candidates: Candidate[];
  matchCheck: "done" | "failed";
  canRecheck: boolean;
};

/** SYC-503: the answer when the spot's photos have gone: nothing could be checked, and nothing can be re-checked. */
const PHOTO_GONE: MatchAnswer = {
  isCatPhoto: true,
  candidates: [],
  matchCheck: "failed",
  canRecheck: false,
};

/**
 * Every photo of a stored spot, in position order, for matching it again
 * (the dedupe repeat, §3.6 of offline-queue-on-web.md, and SYC-503's
 * recheck). A photo removed for good (SYC-462) is never sent; empty when
 * nothing is left to match against.
 */
async function storedSpotPhotos(sighting: {
  id: number;
  photoId: number;
}): Promise<NewPhotoInput[]> {
  // SYC-415 (spec §6.1): matched again against ALL the spot's photos, in
  // the same order. Nothing is re-validated or saved again.
  const rows = await db
    .select({
      role: sightingPhotosTable.role,
      data: photosTable.data,
      mime: photosTable.mime,
    })
    .from(sightingPhotosTable)
    .innerJoin(photosTable, eq(photosTable.id, sightingPhotosTable.photoId))
    // SYC-462 spec §6 item 3: a photo removed for good is never re-sent.
    .where(and(eq(sightingPhotosTable.sightingId, sighting.id), isNotNull(photosTable.data)))
    .orderBy(asc(sightingPhotosTable.position));
  const photos: NewPhotoInput[] = rows.map((r) => ({
    role: r.role as SightingPhotoRole,
    photoBase64: r.data!,
    mime: r.mime,
  }));
  if (photos.length > 0) return photos;
  // A sighting from before SYC-415, or one an older server made during a
  // deploy: its one photo is sightings.photo_id.
  const [only] = await db
    .select()
    .from(photosTable)
    .where(eq(photosTable.id, sighting.photoId));
  // A removed cover (SYC-462) leaves nothing to send.
  return only && only.data !== null
    ? [{ role: "first", photoBase64: only.data, mime: only.mime }]
    : [];
}

/** SYC-151 (review F4) / SYC-503: store that nothing could be compared because the photo has gone. */
async function recordPhotoGone(req: Request, sightingId: number): Promise<void> {
  // No photo means nothing was compared, which data spine §10.9 records
  // as matcherFailed, so it isn't read as "no cats nearby".
  await recordMatch(req, sightingId, {
    comparedCatIds: [],
    suggested: [],
    matcherFailed: true,
    noCatInAnyPhoto: null,
    mixedCats: null,
  });
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
    noCatInAnyPhoto: boolean | null;
    mixedCats: boolean | null;
  },
): Promise<boolean> {
  const values = { ...sets, matchedAt: new Date() };
  try {
    // True only when the row was really written: an update skipped because
    // a choice was already made (setWhere) writes nothing.
    const written = await db
      .insert(sightingMatchesTable)
      .values({ sightingId, ...values })
      .onConflictDoUpdate({
        target: sightingMatchesTable.sightingId,
        set: values,
        setWhere: isNull(sightingMatchesTable.chosenAt),
      })
      .returning({ sightingId: sightingMatchesTable.sightingId });
    return written.length > 0;
  } catch (err) {
    req.log.error({ err, sightingId }, "Could not write the match record");
    return false;
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
  pickedFrom: (typeof PICKED_FROM)[number] | null;
  openedPicker: boolean;
  /** SYC-398 (coat-colours-and-pattern.md §5): a chip was picked in either row of "Find the cat"; null when the phone didn't say. */
  colourFilterOn: boolean | null;
}) {
  const base = {
    chosenCatId: input.catId,
    chosenAt: new Date(),
    suggestedRank: null as number | null,
    pickedFrom: null as string | null,
    missKind: null as string | null,
    openedPicker: null as boolean | null,
    colourFilterOn: input.colourFilterOn,
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
      // SYC-569 D3 (design-review-fixes-oct22.md §2.5): a pick from the cat
      // page's question is recorded whatever the label, so primed "Yes"
      // answers stay separable when matcher accuracy is measured. It is a
      // separate fact from the choice: the label above still comes from the
      // stored set alone. Every other screen's word is dropped on a
      // suggestion, as before.
      pickedFrom: input.pickedFrom === "cat_page" ? "cat_page" : null,
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

/**
 * Data spine PR 5 (DECISIONS.md Part 2h, §6.3 point 2): the per-device
 * budget for look-alike checks, shared by sending a spot and SYC-503's
 * recheck. Call only once the device secret is proven. Answers the request
 * itself (503 or 429) and returns false when the check must not run.
 */
async function withinDeviceMatchLimit(
  req: Request,
  res: Response,
  deviceId: string,
): Promise<boolean> {
  let deviceWithinLimit: boolean;
  try {
    deviceWithinLimit = await checkDeviceMatchLimit(deviceId);
  } catch (err) {
    // Not a cat-in-trouble route, so a limit that cannot count fails closed.
    req.log.error({ err: safeError(err) }, "device match limit counter failed");
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Please try again in a moment." });
    return false;
  }
  if (!deviceWithinLimit) {
    // Nit from review of PR #64: the per-IP aiLimiter sends RateLimit-* and
    // Retry-After on a 429; this in-memory limiter had sent neither. A
    // client (or a spotter's phone, eventually) can't tell how long to back
    // off without one.
    const resetAt = await deviceMatchResetAt(deviceId).catch(() => undefined);
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
    return false;
  }
  return true;
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
  if (!(await withinDeviceMatchLimit(req, res, verifiedDeviceId))) return;

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
    // `sightings.photo_id` has no foreign key, and the approved deletion work
    // (DECISIONS.md F3) will remove photo bytes. A repeat for a sighting whose
    // photo has gone still returns that sighting rather than a 500 — just
    // without fresh matches, since there is nothing left to match against,
    // and (SYC-503) saying so: "failed", never "no look-alikes".
    const photos = await storedSpotPhotos(existing);
    let answer: MatchAnswer;
    if (photos.length > 0) {
      answer = await computeMatchCandidates(req, existing.id, photos, existing.lat, existing.lng);
    } else {
      await recordPhotoGone(req, existing.id);
      answer = PHOTO_GONE;
    }
    res.status(201).json({ sightingId: existing.id, ...answer });
    return;
  }

  // SYC-415 (spec §6.2): every photo is checked first; if any fails, nothing
  // is saved and the answer says which photo it was. Then the sighting and
  // all its photos are saved together, and the matcher sees them all.
  const list = spotPhotoList(body);
  if (!list.ok) {
    res.status(400).json({ error: list.error });
    return;
  }
  const validated = await validateSpotPhotos(list.photos);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error, photo: validated.photo });
    return;
  }
  const saved = await saveSpotWithPhotos({
    deviceId: body.deviceId,
    lat: body.lat,
    lng: body.lng,
    capturedAt,
    photos: validated.photos,
  });

  const answer = await computeMatchCandidates(
    req,
    saved.sightingId,
    saved.photos.map((p) => ({ role: p.role, photoBase64: p.base64, mime: p.mime })),
    body.lat,
    body.lng,
  );

  res.status(201).json({ sightingId: saved.sightingId, ...answer });
});

/**
 * SYC-503: the answer a check that worked already gave, rebuilt from the
 * team-only record without calling the matcher again. Used when the phone
 * asks to check again but never heard that an earlier "Check again"
 * worked (the app went to the background, or the signal dropped): it gets
 * the look-alikes rather than a dead end (review of SYC-503, finding 1).
 * Only what a send would have shown: candidates at or above the threshold,
 * best first, with the photo the catalogue shows. The model's reasoning
 * isn't stored, so it is empty.
 */
export async function storedAnswer(stored: {
  suggested: SuggestedMatch[] | null;
  noCatInAnyPhoto: boolean | null;
}): Promise<MatchAnswer> {
  const shown = (stored.suggested ?? [])
    .filter((m) => m.score >= CONFIDENCE_THRESHOLD)
    .sort((a, b) => a.rank - b.rank);
  const cats =
    shown.length > 0
      ? await liveCats(getTableColumns(catsTable), { where: inArray(catsTable.id, shown.map((m) => m.catId)) })
      : [];
  const byId = new Map(cats.map((c) => [c.id, c]));
  const present = shown.filter((m) => byId.has(m.catId));
  const photos = await catDisplayPhotos(present.map((m) => byId.get(m.catId)!));
  return {
    isCatPhoto: stored.noCatInAnyPhoto !== true,
    candidates: present.map((m) => ({
      catId: m.catId,
      name: byId.get(m.catId)!.name,
      namePending: byId.get(m.catId)!.namePending,
      photoUrl: photos.get(m.catId) ?? null,
      confidence: m.score,
      reasoning: "",
    })),
    matchCheck: "done",
    canRecheck: false,
  };
}

/**
 * SYC-503 (when-the-photo-check-fails.md §4): one look-alike check per
 * sighting at a time. In-process is enough for one phone double-tapping;
 * recordMatch's "only until a choice is made" guard still protects the record.
 */
const recheckInFlight = new Set<number>();

// SYC-503 §4: run the look-alike check again, only after it failed. A check
// that worked is final: re-running it until the look-alikes went away would
// be a free re-roll of paid model calls. The per-IP cost ceiling (aiLimiter)
// applies exactly as it does to sending a spot.
router.post("/sightings/:sightingId/recheck", aiLimiter, async (req, res) => {
  const sightingId = Number(req.params.sightingId);
  const body = RecheckSightingBody.parse(req.body);

  // Checked in the same order as resolve, so nobody can probe another
  // phone's sighting: 404, then 403, then the device secret.
  const [sighting] = Number.isInteger(sightingId)
    ? await db.select().from(sightingsTable).where(eq(sightingsTable.id, sightingId))
    : [];
  if (!sighting) {
    res.status(404).json({ error: "Sighting not found" });
    return;
  }
  if (body.deviceId !== sighting.deviceId) {
    res.status(403).json({ error: "Not your sighting" });
    return;
  }
  if (!(await verifyDeviceSecret(req, res, sighting.deviceId))) return;
  const deviceId: string = sighting.deviceId;

  // The lock is taken before anything is read, so a check that finishes
  // meanwhile can't be re-rolled (review of SYC-503, finding 5).
  if (recheckInFlight.has(sightingId)) {
    res.status(409).json({ error: "This photo is already being checked", code: "CHECK_RUNNING" });
    return;
  }
  recheckInFlight.add(sightingId);
  try {
    const [current] = await db
      .select({ status: sightingsTable.status })
      .from(sightingsTable)
      .where(eq(sightingsTable.id, sightingId));
    if (current?.status === "resolved") {
      res.status(409).json({ error: "Sighting already resolved", code: "RESOLVED" });
      return;
    }
    const [stored] = await db
      .select({
        matcherFailed: sightingMatchesTable.matcherFailed,
        suggested: sightingMatchesTable.suggested,
        noCatInAnyPhoto: sightingMatchesTable.noCatInAnyPhoto,
      })
      .from(sightingMatchesTable)
      .where(eq(sightingMatchesTable.sightingId, sightingId));
    // No record at all: the failure was never written down, so the phone
    // was told it can't recheck (computeMatchCandidates). Nothing to do.
    if (!stored) {
      res.status(409).json({ error: "This photo can't be checked again", code: "NOT_CHECKABLE" });
      return;
    }
    // A check that worked is final: its answer again, never a new roll.
    if (!stored.matcherFailed) {
      res.json({ sightingId, ...(await storedAnswer(stored)) });
      return;
    }
    const photos = await storedSpotPhotos(sighting);
    if (photos.length === 0) {
      // Nothing to send, so no model call and nothing counted.
      res.json({ sightingId, ...PHOTO_GONE });
      return;
    }
    if (!(await withinDeviceMatchLimit(req, res, deviceId))) return;
    // Always the sighting's own stored location, never one from the phone
    // (cat-record-data-spine.md §6.3: no nearest-cat oracle).
    const answer = await computeMatchCandidates(req, sightingId, photos, sighting.lat, sighting.lng);
    // The spotter may have chosen a cat while this ran (up to ~35 s): the
    // answer is then moot, and saying so beats look-alikes for a done spot.
    const [after] = await db
      .select({ status: sightingsTable.status })
      .from(sightingsTable)
      .where(eq(sightingsTable.id, sightingId));
    if (after?.status === "resolved") {
      res.status(409).json({ error: "Sighting already resolved", code: "RESOLVED" });
      return;
    }
    res.json({ sightingId, ...answer });
  } finally {
    recheckInFlight.delete(sightingId);
  }
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
    res.status(409).json({ error: "Sighting already resolved", code: "RESOLVED" });
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
        error: OFFENSIVE_NAME_WORDS,
        code: "OFFENSIVE_NAME",
      });
      return;
    }
    // SYC-677 D: a SYR number is not a name (as when a spotter names a cat).
    if (isSyrShapedName(name)) {
      res.status(400).json(SYR_SHAPED_NAME_BODY);
      return;
    }
    // SYC-709: no web link or phone number in a name the public types.
    if (hasLinkOrPhoneNumber(name)) {
      res.status(400).json(NAME_HAS_LINK_BODY);
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
      // SYC-706: the moment of the spot is the resolve, not the photo's
      // capture time, for the once-a-day rule and the week it counts in.
      const at = new Date();

      // SYC-706: badges are decided inside this transaction. One spotter's
      // resolves take turns (all of their spots, not just one cat's), so the
      // "before" below is exact and a badge is celebrated by one spot only.
      // Lock order: this lock, then the sighting row, then awardPoints' lock.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${"badges:" + spotterId}))`,
      );
      // What the spotter had met before this spot. Badges met already were
      // earned by older spots: saved without a celebration, so an existing
      // spotter's first spot after launch doesn't replay their whole history.
      const badgesBefore = thresholdBadges(await computeBadgeStats(tx, spotterId));

      // which-cat-is-which.md §9.2: no resolved sighting is ever filed under
      // a merged-away cat. The cat is locked (shared, so resolves don't queue
      // behind each other) and its canonical cat read again under the lock:
      // a merge committed meanwhile is seen, and the sighting is filed under
      // the cat Mimi is part of now. A merge still in flight holds the cat
      // for update, so this waits for it.
      if (cat) {
        const survivorId = await lockSurvivor(tx, cat.id, "share");
        if (survivorId !== cat.id) {
          [cat] = await tx.select().from(catsTable).where(eq(catsTable.id, survivorId));
        }
      }

      if (newCatName != null) {
        // SYC-462 spec §6 item 4 (P9): a cover photo removed for good never
        // becomes a new cat's main photo; the cat starts with none (0).
        const [cover] = await tx
          .select({ removedAt: photosTable.removedAt })
          .from(photosTable)
          .where(eq(photosTable.id, sighting.photoId));
        [cat] = await tx
          .insert(catsTable)
          .values({
            name: newCatName,
            description: "",
            primaryPhotoId: cover && cover.removedAt === null ? sighting.photoId : 0,
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

      // SYC-706: the place is stamped in the same update. A row already
      // stamped keeps its stamp (the trigger refuses to overwrite one).
      const place = placeFor(sighting.lat, sighting.lng);
      // Only a pending sighting resolves (review F6): two resolves sent at
      // once used to both succeed and award points twice. The loser's
      // transaction rolls back, a new cat included.
      const updated = await tx
        .update(sightingsTable)
        .set({
          catId: cat!.id,
          status: "resolved",
          areaKey: sql`coalesce(${sightingsTable.areaKey}, ${place.areaKey})`,
          onIsland: sql`coalesce(${sightingsTable.onIsland}, ${place.onIsland})`,
        })
        .where(
          and(
            eq(sightingsTable.id, sightingId),
            eq(sightingsTable.status, "pending"),
          ),
        )
        .returning({ id: sightingsTable.id, areaKey: sightingsTable.areaKey });
      if (updated.length === 0) throw ALREADY_RESOLVED;

      // SYC-706: a spotter earns for a given cat once per Athens day.
      const award = await awardPoints(tx, {
        deviceId: spotterId,
        sightingId,
        catId: cat!.id,
        isNewCat,
        at,
      });
      const pointsAwarded = award.points;
      if (pointsAwarded > 0) {
        await tx
          .insert(profilesTable)
          .values({ deviceId: spotterId, points: pointsAwarded })
          .onConflictDoUpdate({
            target: profilesTable.deviceId,
            set: { points: sql`${profilesTable.points} + ${pointsAwarded}` },
          });
      }
      const pointsReason = award.repeatToday ? ("repeat_today" as const) : null;

      // SYC-624: a phone that unfollowed this cat stays unfollowed; only a
      // fresh Follow tap (which clears its cat_unfollows row) brings it back.
      // Lock the cat row first (shared): follow and unfollow hold it for
      // update, so a racing unfollow commits before this statement takes its
      // snapshot and the guard below sees its cat_unfollows row. Lock order:
      // this transaction holds the sighting row, then wants the cat row;
      // follow/unfollow and claim take the cat row and never a sighting row,
      // and severPerson updates sightings first, then cats (the same order
      // as here), so no cycle can form.
      await tx.execute(sql`select 1 from cats where id = ${cat!.id} for share`);
      await tx.execute(sql`
        insert into cat_subscriptions (device_id, cat_id)
        select ${spotterId}, ${cat!.id}
        where not exists (
          select 1 from cat_unfollows
          where device_id = ${spotterId} and cat_id = ${cat!.id}
        )
        on conflict do nothing
      `);

      // SYC-706: the badges this spot crossed, plus the moment-of-the-spot
      // ones, saved once. awardBadges returns only rows it inserted, so a
      // badge another spot already saved is never celebrated twice.
      const badgesAfter = thresholdBadges(await computeBadgeStats(tx, spotterId));
      const crossed = badgesAfter.filter((b) => !badgesBefore.includes(b));
      const events = await eventBadgesForSpot(tx, {
        deviceId: spotterId,
        catId: cat!.id,
        isNewCat,
        areaKey: updated[0]!.areaKey,
        at,
      });
      await awardBadges(tx, spotterId, badgesBefore, "history");
      const newBadges = await awardBadges(tx, spotterId, [...crossed, ...events], "live");
      const momentId =
        newBadges.length > 0
          ? await queueMoment(tx, { deviceId: spotterId, kind: "badges", badgeIds: newBadges })
          : null;

      return { cat: cat!, pointsAwarded, pointsReason, isNewCat, newBadges, momentId };
    });
  } catch (err: any) {
    if (err === ALREADY_RESOLVED) {
      res.status(409).json({ error: "Sighting already resolved", code: "RESOLVED" });
      return;
    }
    // Unique-index violation from a concurrent submission of the same name.
    if (isUniqueViolation(err)) {
      res.status(409).json(await nameTakenBody(await catNamed(newCatName!)));
      return;
    }
    throw err;
  }

  const { cat, pointsAwarded, pointsReason, isNewCat, newBadges, momentId } = resolution;

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
    colourFilterOn: body.colourFilterOn ?? null,
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

  // SYC-59 PR 5.1 (which-cat-is-which.md §3.1 item 2, §9.6): a new cat the
  // photo check had suggested existing cats for goes on the Possible
  // duplicates list, one report per cat passed over. Never blocks the
  // spotter, and best effort for the same reason as the label above.
  if (isNewCat) {
    try {
      await writeNewCatChecks({ sightingId, deviceId: sighting.deviceId, newCatId: cat.id, suggested: stored?.suggested });
    } catch (err) {
      req.log.error({ err, sightingId }, "Could not write the new-cat check");
    }
  }

  // Notification fan-out is best-effort and deliberately happens only after
  // the core resolve writes have committed.
  await createUpdateAndFanOut({
    cat,
    updateType: "sighting",
    // SYC-166 slice 3: an old photo says the day it was taken (Decision D1).
    message: isNewCat
      ? `${cat.name} was just discovered on Syros!`
      : spottedAgainMessage(cat.name, sighting.createdAt, new Date()),
    triggerSightingId: sightingId,
    excludeDeviceId: sighting.deviceId,
  });

  const profile = await profilePayload(sighting.deviceId);
  const askEarTip = !(await hasAnsweredEarTip(db, sighting.deviceId, cat.id));

  // SYC-166 slice 3 (spec test 12): last seen is the cat's newest sighting,
  // as the cat list has it, never this one's own (possibly much older) time.
  const [countRow] = await db
    .select({
      n: sql<number>`count(*)::int`,
      latest: sql<Date | null>`max(${sightingsTable.createdAt})`.mapWith(
        sightingsTable.createdAt,
      ),
    })
    .from(sightingsTable)
    .where(eq(sightingsTable.catId, cat.id));

  // data-spine.md PR 4: hasHome is lifeStatus === "homed", derived, behind
  // the PR 3 gate (catHelpers.ts's deriveCatStatuses doc comment).
  const derivedStatus = (
    await deriveCatStatuses([{ id: cat.id, ownerDeviceId: cat.ownerDeviceId }])
  ).get(cat.id)!;
  // A cat whose discoverer deleted their data has nobody to look up (SYC-63).
  // A cat Syros Cats recorded is credited "Syros Cats" by serialiseCat itself
  // (SYC-677 R22b), whatever this lookup finds.
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
        namePending: cat.namePending,
        description: cat.description,
        photoUrl: await catDisplayPhoto(cat),
        lat: cat.lat,
        lng: cat.lng,
        ownerDeviceId: cat.ownerDeviceId,
        sightingsCount: countRow?.n ?? 1,
        lastSeenAt: countRow?.latest ?? sighting.createdAt,
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
    pointsReason,
    isNewCat,
    newBadges,
    momentId,
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
  // The cat the answers go to: the one the sighting is filed under when they
  // are written, re-read inside the transaction below (a move may file it
  // elsewhere meanwhile; which-cat-is-which.md §5.7, §9.7).
  let catId: number | null = sighting.catId;

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
  const REFILED = { code: "REFILED" } as const;
  const NOT_THEIRS = { code: "NOT_THEIRS" } as const;
  let written: Answer[] = [];
  // A move holds this lock while it files the sighting elsewhere; one that
  // lands between the read above and the lock sends us round once more, on
  // the cat it is under now. Twice at most: three moves of one spot inside
  // one request don't happen.
  for (let attempt = 0; ; attempt += 1) try {
    await db.transaction(async (tx) => {
      // The spotter's badges lock first, the order a move and a deletion
      // take theirs (badges, then the answers lock, then the sighting;
      // which-cat-is-which.md §9.7). A deletion of this spotter either
      // finishes first, and the re-read below sees the sighting cleared, or
      // waits for these answers and then clears them too (review of #386,
      // R3): an answer never keeps a deleted spotter's id.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"badges:" + spotterId}))`);
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
      // The sighting's cat, read again under FOR SHARE (§9.7): a move holds
      // the row FOR UPDATE until it commits, so this waits for it and then
      // sees where it filed the sighting. The answers go there, never to the
      // cat it has just left.
      const now = await tx.execute<{ cat_id: number | null; device_id: string | null }>(
        sql`select cat_id, device_id from sightings where id = ${sightingId} for share`,
      );
      // Deleted while the request was on its way: no longer theirs.
      if (now.rows[0]?.device_id !== spotterId) throw NOT_THEIRS;
      const filedUnder = now.rows[0]?.cat_id ?? null;
      if (filedUnder === null || filedUnder !== catId) {
        catId = filedUnder;
        throw REFILED;
      }
      const filed: number = filedUnder;
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
          const state = await earTipStateFor(tx, spotterId, filed);
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
          catId: filed,
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
    break;
  } catch (err) {
    if (err === REFILED && catId !== null && attempt < 2) continue;
    if (err === REFILED) {
      res.status(409).json({
        error: "This sighting was moved a moment ago. Try again.",
        code: "MOVED",
      });
      return;
    }
    if (err === NOT_THEIRS) {
      res.status(403).json({ error: "Not your sighting" });
      return;
    }
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

  const windowStart = new Date(Date.now() - ANSWER_WINDOW_MS);
  // A spot the team moved onto this cat is listed whatever its age (the line
  // "next time they open it", which-cat-is-which.md §5.9, D4); the add-details
  // window still decides whether there is anything to add.
  const movedHere = db
    .select({ id: sightingMovesTable.sightingId })
    .from(sightingMovesTable)
    .where(and(eq(sightingMovesTable.toCatId, catId), isNull(sightingMovesTable.mergeId)));
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
        or(gte(sightingsTable.createdAt, windowStart), inArray(sightingsTable.id, movedHere)),
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

  // SYC-150 PR 3.3 (which-cat-is-which.md §5.9, D4): a spot the team filed
  // under this cat says so ("Syros Cats filed this under Agatha"). Read from
  // the sighting's newest move: it counts only if it is a team move onto this
  // cat (not a merge's), so a later move away or a merge takes the line off.
  // Who moved it and why never leave the server.
  const newestMove = new Map<number, { toCatId: number; mergeId: number | null }>();
  // Where each spot was first filed by its spotter: a spot back there says nothing.
  const firstFrom = new Map<number, number>();
  if (recent.length > 0) {
    const moves = await db
      .select({
        sightingId: sightingMovesTable.sightingId,
        fromCatId: sightingMovesTable.fromCatId,
        toCatId: sightingMovesTable.toCatId,
        mergeId: sightingMovesTable.mergeId,
      })
      .from(sightingMovesTable)
      .where(inArray(sightingMovesTable.sightingId, recent.map((r) => r.id)))
      .orderBy(asc(sightingMovesTable.id));
    for (const m of moves) {
      newestMove.set(m.sightingId, m);
      if (!firstFrom.has(m.sightingId)) firstFrom.set(m.sightingId, m.fromCatId);
    }
  }

  const sightings = recent
    .map((r) => {
      const kinds = new Set(answered.filter((a) => a.sightingId === r.id).map((a) => a.kind));
      const newest = newestMove.get(r.id);
      // The team filed it here, and it isn't back where the spotter first filed it.
      const filed = newest?.toCatId === catId && newest.mergeId === null && firstFrom.get(r.id) !== catId;
      const windowOver = r.createdAt < windowStart;
      return {
        sightingId: r.id,
        takenAt: r.createdAt.toISOString(),
        photoUrl: publicPhotoUrl(
          r.photoId != null && r.publicId != null ? { id: r.photoId, publicId: r.publicId } : null,
          hidden,
        ),
        open: windowOver
          ? { foodAndWater: false, note: false }
          : { foodAndWater: !kinds.has("food_and_water"), note: !kinds.has("note") },
        // Only ever `true`, and absent otherwise: the payload of a spot nobody
        // moved is byte for byte what it was (publicPayload.p6.test.ts).
        ...(filed ? { filedByTeam: true as const } : {}),
        // Over the add-details window: nothing to add, whatever the ear-tip state.
        ...(windowOver ? { windowOver: true as const } : {}),
      };
    })
    .filter(
      (s) =>
        s.filedByTeam === true || (s.windowOver !== true && (s.open.foodAndWater || s.open.note || ear.state !== "checked")),
    );

  res.json({
    earTip:
      ear.state === "answered" && ear.current.answer
        ? { state: "answered", current: ear.current.answer }
        : { state: ear.state === "answered" ? "checked" : ear.state },
    sightings,
  });
});

export default router;
