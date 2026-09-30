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
  profilesTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  photoUrl,
  getProfileStats,
  profilePayload,
} from "../lib/catHelpers";
import { badgesFor } from "../lib/badges";
import { clampCaptureTime } from "../lib/captureTime";
import { verifyDeviceSecret } from "../lib/deviceAuth";
import { createUpdateAndFanOut } from "../lib/notificationFanout";
import { catSubscriptionsTable } from "@workspace/db";
import { matchCatPhoto } from "../lib/matching";
import { validatePhotoBase64 } from "../lib/imageValidation";
import { containsOffensiveLanguage } from "../lib/moderation";
import { aiLimiter } from "../middlewares/rateLimit";
import { selectCandidateCats } from "../lib/candidateSelection";

const POINTS_CONFIRM = 10;
const POINTS_NEW_CAT = 50;

type Candidate = {
  catId: number;
  name: string;
  photoUrl: string;
  confidence: number;
  reasoning: string;
};

const router: IRouter = Router();

// Compare a submitted photo against the nearest known cats and return ranked
// candidates. Shared between a fresh submission and a deduped repeat (§3.6 of
// offline-queue-on-web.md) so both paths produce an equivalent response from
// the same logic, rather than two hand-maintained copies of it.
async function computeMatchCandidates(
  req: Request,
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

  try {
    const candidateInputs = [];
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
    candidates = result.matches
      .filter((m) => byId.has(m.catId) && m.confidence >= 0.1)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3)
      .map((m) => {
        const cat = byId.get(m.catId)!;
        return {
          catId: cat.id,
          name: cat.name,
          photoUrl: photoUrl(cat.primaryPhotoId),
          confidence: m.confidence,
          reasoning: m.reasoning,
        };
      });
  } catch (err) {
    req.log.error({ err }, "AI matching failed; returning no candidates");
  }

  return { isCatPhoto, candidates };
}

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
  if (!(await verifyDeviceSecret(req, res, body.deviceId))) return;

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
          existingPhoto.data,
          existing.lat,
          existing.lng,
        )
      : { isCatPhoto: true, candidates: [] };
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

  if (body.catId != null) {
    const [existing] = await db
      .select()
      .from(catsTable)
      .where(eq(catsTable.id, body.catId));
    if (!existing) {
      res.status(404).json({ error: "Cat not found" });
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
    const [taken] = await db
      .select({ id: catsTable.id })
      .from(catsTable)
      .where(sql`lower(${catsTable.name}) = lower(${name})`);
    if (taken) {
      res.status(409).json({ error: "Cat name already taken", code: "NAME_TAKEN" });
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
      }

      await tx
        .update(sightingsTable)
        .set({ catId: cat!.id, status: "resolved" })
        .where(eq(sightingsTable.id, sightingId));

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
    // Unique-index violation from a concurrent submission of the same name.
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      res.status(409).json({ error: "Cat name already taken", code: "NAME_TAKEN" });
      return;
    }
    throw err;
  }

  const { cat, pointsAwarded, isNewCat } = resolution;

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

  res.json({
    cat: {
      id: cat.id,
      name: cat.name,
      description: cat.description,
      photoUrl: photoUrl(cat.primaryPhotoId),
      lat: cat.lat,
      lng: cat.lng,
      sightingsCount: countRow?.n ?? 1,
      lastSeenAt: new Date().toISOString(),
      hasHome: cat.ownerDeviceId !== null,
    },
    pointsAwarded,
    isNewCat,
    newBadges,
    profile,
  });
});

export default router;
