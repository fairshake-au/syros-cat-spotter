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
import { matchCatPhoto } from "../lib/matching";

const POINTS_CONFIRM = 10;
const POINTS_NEW_CAT = 50;
const MAX_CANDIDATES = 10;

const router: IRouter = Router();

router.post("/sightings", async (req, res) => {
  const body = CreateSightingBody.parse(req.body);

  const [photo] = await db
    .insert(photosTable)
    .values({ data: body.photoBase64, mime: "image/jpeg" })
    .returning();
  const [sighting] = await db
    .insert(sightingsTable)
    .values({
      deviceId: body.deviceId,
      photoId: photo!.id,
      lat: body.lat,
      lng: body.lng,
      status: "pending",
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
    const result = await matchCatPhoto(body.photoBase64, candidateInputs);
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
    const [created] = await db
      .insert(catsTable)
      .values({
        name: body.newCatName.trim().slice(0, 60),
        description: "",
        primaryPhotoId: sighting.photoId,
        lat: sighting.lat,
        lng: sighting.lng,
        discovererDeviceId: sighting.deviceId,
      })
      .returning();
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
