import { Router, type IRouter, type Request } from "express";
import {
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
  foldName,
  type SuggestedMatch,
} from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  deriveCatStatuses,
  isResolvedDeceased,
  photoUrl,
  getProfileStats,
  profilePayload,
} from "../lib/catHelpers";
import { badgesFor } from "../lib/badges";
import { clampCaptureTime } from "../lib/captureTime";
import { verifyDeviceSecret } from "../lib/deviceAuth";
import { createUpdateAndFanOut } from "../lib/notificationFanout";
import { writeObservation } from "../lib/observations";
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
import { selectCandidateCats } from "../lib/candidateSelection";
import { isNearby, publishedPosition } from "@workspace/geo";

export const POINTS_CONFIRM = 10;
const POINTS_NEW_CAT = 50;

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
  photoUrl: string | null;
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

/** Thrown inside the resolve transaction when another resolve got there first. */
const ALREADY_RESOLVED = new Error("Sighting already resolved");

async function catNamed(name: string) {
  const [cat] = await db
    .select({
      id: catsTable.id,
      name: catsTable.name,
      primaryPhotoId: catsTable.primaryPhotoId,
    })
    .from(catsTable)
    .where(sql`lower(${catsTable.name}) = lower(${name})`);
  return cat;
}

// SYC-119 (choose-a-different-cat.md §3.1, §9): NAME_TAKEN names the cat that
// has the name, so the phone can ask "Is this them?". Public details only.
async function nameTakenBody(
  cat: Awaited<ReturnType<typeof catNamed>>,
): Promise<{
  error: string;
  code: "NAME_TAKEN";
  cat?: { id: number; name: string; photoUrl: string | null };
}> {
  const body = { error: "Cat name already taken", code: "NAME_TAKEN" as const };
  if (!cat) return body;
  return {
    ...body,
    cat: { id: cat.id, name: cat.name, photoUrl: await photoUrl(cat.primaryPhotoId) },
  };
}

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
    // SYC-98 Fable review, finding 7: one batched select for the (at most 3)
    // shown cats' photo public ids, instead of a photoUrl() round trip per
    // candidate. Only `shown` cats' photos are ever fetched — a withheld
    // candidate's photo is never looked up, let alone returned.
    const photoIds = [
      ...new Set(shown.map((m) => byId.get(m.catId)!.primaryPhotoId)),
    ];
    const photoRows = photoIds.length
      ? await db
          .select({ id: photosTable.id, publicId: photosTable.publicId })
          .from(photosTable)
          .where(inArray(photosTable.id, photoIds))
      : [];
    const publicIdById = new Map(photoRows.map((p) => [p.id, p.publicId]));
    candidates = shown.map((m) => {
      const cat = byId.get(m.catId)!;
      const publicId = publicIdById.get(cat.primaryPhotoId);
      return {
        catId: cat.id,
        name: cat.name,
        photoUrl: publicId ? `/api/photos/${publicId}` : null,
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
  if (!checkDeviceMatchLimit(verifiedDeviceId)) {
    // Nit from review of PR #64: the per-IP aiLimiter sends RateLimit-* and
    // Retry-After on a 429; this in-memory limiter had sent neither. A
    // client (or a spotter's phone, eventually) can't tell how long to back
    // off without one.
    const resetAt = deviceMatchResetAt(verifiedDeviceId);
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

  const statsBefore = await getProfileStats(sighting.deviceId);
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
    // (lib/geo). Never measured on exact positions: a refusal worked out from
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
          publishedPosition({ lat: existing.lat, lng: existing.lng }),
        ))
    ) {
      res.status(NOT_NEARBY.status).json(NOT_NEARBY.body);
      return;
    }
    existingCat = existing;
  } else if (body.newCatName && body.newCatName.trim().length > 0) {
    const name = body.newCatName.trim().slice(0, 60);
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
          value: { name: cat!.name, normalised: foldName(cat!.name) },
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
        .values({ deviceId: sighting.deviceId, points: pointsAwarded })
        .onConflictDoUpdate({
          target: profilesTable.deviceId,
          set: { points: sql`${profilesTable.points} + ${pointsAwarded}` },
        });

      await tx
        .insert(catSubscriptionsTable)
        .values({ deviceId: sighting.deviceId, catId: cat!.id })
        .onConflictDoNothing();

      return { cat: cat!, pointsAwarded, isNewCat };
    });
  } catch (err: any) {
    if (err === ALREADY_RESOLVED) {
      res.status(409).json({ error: "Sighting already resolved" });
      return;
    }
    // Unique-index violation from a concurrent submission of the same name.
    if (err?.code === "23505" || err?.cause?.code === "23505") {
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

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sightingsTable)
    .where(eq(sightingsTable.catId, cat.id));

  // data-spine.md PR 4: hasHome is lifeStatus === "homed", derived, behind
  // the PR 3 gate (catHelpers.ts's deriveCatStatuses doc comment) — not the
  // legacy owner_device_id check this response used before. §10.6 also
  // means this response carries no cat coordinates beyond lat/lng, which
  // stay as before (blurring is PR 6's).
  const derivedStatus = (
    await deriveCatStatuses([{ id: cat.id, ownerDeviceId: cat.ownerDeviceId }])
  ).get(cat.id)!;

  res.json({
    cat: {
      id: cat.id,
      name: cat.name,
      description: cat.description,
      photoUrl: await photoUrl(cat.primaryPhotoId),
      lat: cat.lat,
      lng: cat.lng,
      sightingsCount: countRow?.n ?? 1,
      lastSeenAt: new Date().toISOString(),
      ...derivedStatus,
    },
    pointsAwarded,
    isNewCat,
    newBadges,
    profile,
  });
});

export default router;
