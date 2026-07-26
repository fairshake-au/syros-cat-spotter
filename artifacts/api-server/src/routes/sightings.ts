import { Router, type IRouter } from "express";
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
import { eq, sql } from "drizzle-orm";
import {
  haversineKm,
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

const POINTS_CONFIRM = 10;
const POINTS_NEW_CAT = 50;
const MAX_CANDIDATES = 10;

const router: IRouter = Router();

router.post("/sightings", aiLimiter, async (req, res) => {
  const body = CreateSightingBody.parse(req.body);

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
      // When the client queued this offline, the spot happened before the sync.
      // Store the capture time (clamped) so streak day buckets reflect when the
      // cat was actually seen rather than when the network came back.
      createdAt: clampCaptureTime(body.capturedAt),
    })
    .returning();

  // Nearest cats first — matching a street cat against ones seen nearby is
  // both cheaper and more accurate than comparing against the whole island.
  const cats = await db.select().from(catsTable);
  const nearest = cats
    .map((c) => ({
      cat: c,
      dist: haversineKm(body.lat, body.lng, c.lat, c.lng),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, MAX_CANDIDATES);

  let isCatPhoto = true;
  let candidates: {
    catId: number;
    name: string;
    photoUrl: string;
    confidence: number;
    reasoning: string;
  }[] = [];

  try {
    const candidateInputs = [];
    for (const { cat } of nearest) {
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
    const result = await matchCatPhoto(normalizedBase64, candidateInputs);
    isCatPhoto = result.isCatPhoto;
    const byId = new Map(nearest.map((n) => [n.cat.id, n.cat]));
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

  let cat;
  let pointsAwarded: number;
  let isNewCat: boolean;

  if (body.catId != null) {
    const [existing] = await db
      .select()
      .from(catsTable)
      .where(eq(catsTable.id, body.catId));
    if (!existing) {
      res.status(404).json({ error: "Cat not found" });
      return;
    }
    cat = existing;
    pointsAwarded = POINTS_CONFIRM;
    isNewCat = false;
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
    let created;
    try {
      [created] = await db
        .insert(catsTable)
        .values({
          name,
          description: "",
          primaryPhotoId: sighting.photoId,
          lat: sighting.lat,
          lng: sighting.lng,
          discovererDeviceId: sighting.deviceId,
        })
        .returning();
    } catch (err: any) {
      // Unique-index violation from a concurrent submission of the same name.
      if (err?.code === "23505" || err?.cause?.code === "23505") {
        res.status(409).json({ error: "Cat name already taken", code: "NAME_TAKEN" });
        return;
      }
      throw err;
    }
    cat = created!;
    pointsAwarded = POINTS_NEW_CAT;
    isNewCat = true;
  } else {
    res.status(400).json({ error: "Provide catId or newCatName" });
    return;
  }

  await db
    .update(sightingsTable)
    .set({ catId: cat.id, status: "resolved" })
    .where(eq(sightingsTable.id, sightingId));

  await db
    .insert(profilesTable)
    .values({ deviceId: sighting.deviceId, points: pointsAwarded })
    .onConflictDoUpdate({
      target: profilesTable.deviceId,
      set: { points: sql`${profilesTable.points} + ${pointsAwarded}` },
    });

  // Auto-subscribe the resolving spotter to this cat, then notify the cat's
  // other subscribers that it was spotted again.
  await db
    .insert(catSubscriptionsTable)
    .values({ deviceId: sighting.deviceId, catId: cat.id })
    .onConflictDoNothing();

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
    },
    pointsAwarded,
    isNewCat,
    newBadges,
    profile,
  });
});

export default router;
