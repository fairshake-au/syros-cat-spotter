import { Router, type IRouter } from "express";
import {
  RegisterCatBody,
  ClaimCatBody,
  UpdateCatBody,
  SuggestCatNamesBody,
} from "@workspace/api-zod";
import {
  db,
  catsTable,
  sightingsTable,
  profilesTable,
  catUpdatesTable,
  type Cat,
} from "@workspace/db";
import { and, eq, ne, desc, isNull, sql } from "drizzle-orm";
import {
  fansCount,
  listCatsWithStats,
  photoUrl,
  spotterCode,
} from "../lib/catHelpers";
import { notifyCatSpotters } from "../lib/notifications";
import { suggestCatNames } from "../lib/nameSuggestions";
import { aiLimiter } from "../middlewares/rateLimit";
import { containsOffensiveLanguage } from "../lib/moderation";

const router: IRouter = Router();

router.post("/cats/name-suggestions", aiLimiter, async (req, res) => {
  const body = SuggestCatNamesBody.parse(req.body);
  const cats = await db.select({ name: catsTable.name }).from(catsTable);
  try {
    const suggestions = await suggestCatNames(
      body.language,
      cats.map((c) => c.name),
    );
    res.json({ suggestions });
  } catch (err) {
    req.log.error({ err }, "Cat name suggestion failed");
    res.status(502).json({ error: "Name generation failed" });
  }
});

async function catPayload(cat: Cat, sightingsCount: number, lastSeenAt: string) {
  const [profile] = await db
    .select({
      nickname: profilesTable.nickname,
      username: profilesTable.username,
    })
    .from(profilesTable)
    .where(eq(profilesTable.deviceId, cat.discovererDeviceId));
  return {
    id: cat.id,
    name: cat.name,
    description: cat.description,
    photoUrl: photoUrl(cat.primaryPhotoId),
    lat: cat.lat,
    lng: cat.lng,
    sightingsCount,
    lastSeenAt,
    discovererSpotterCode: spotterCode(cat.discovererDeviceId),
    discovererNickname: profile?.nickname ?? null,
    discovererUsername: profile?.username ?? null,
    ownerName: cat.ownerName,
    homeDescription: cat.homeDescription,
  };
}

async function sightingsCountFor(catId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sightingsTable)
    .where(
      and(eq(sightingsTable.catId, catId), eq(sightingsTable.status, "resolved")),
    );
  return row?.n ?? 0;
}

router.get("/cats", async (req, res) => {
  const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
  const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
  const cats = await listCatsWithStats(
    Number.isFinite(lat) ? lat : undefined,
    Number.isFinite(lng) ? lng : undefined,
  );
  res.json(cats);
});

// Resident registers a brand-new owned cat (no sighting required).
router.post("/cats", async (req, res) => {
  const body = RegisterCatBody.parse(req.body);
  const name = body.name.trim().slice(0, 60);
  if (containsOffensiveLanguage(name)) {
    res.status(400).json({
      error: "Cat name contains offensive language",
      code: "OFFENSIVE_NAME",
    });
    return;
  }
  const [cat] = await db
    .insert(catsTable)
    .values({
      name,
      description: "",
      // No photo yet — 0 is a sentinel; the photos route 404s for it and the
      // owner (or a first sighting) can supply a real photo later.
      primaryPhotoId: 0,
      lat: body.lat,
      lng: body.lng,
      discovererDeviceId: body.deviceId,
      ownerDeviceId: body.deviceId,
      ownerName: body.ownerName.trim().slice(0, 60),
      homeDescription: body.homeDescription.trim().slice(0, 200),
    })
    .returning();
  res
    .status(201)
    .json(await catPayload(cat!, 0, cat!.createdAt.toISOString()));
});

router.get("/cats/:catId", async (req, res) => {
  const catId = Number(req.params.catId);
  if (!Number.isInteger(catId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [cat] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
  if (!cat) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const sightings = await db
    .select({
      sighting: sightingsTable,
      spotterUsername: profilesTable.username,
      spotterNickname: profilesTable.nickname,
    })
    .from(sightingsTable)
    .leftJoin(profilesTable, eq(profilesTable.deviceId, sightingsTable.deviceId))
    .where(
      and(eq(sightingsTable.catId, catId), eq(sightingsTable.status, "resolved")),
    )
    .orderBy(desc(sightingsTable.createdAt));

  // Care timeline: the cat's own update history, newest first. Sighting-type
  // updates are excluded — the sightings list below already covers those, and
  // repeating them would drown the care events the timeline exists to show.
  const updates = await db
    .select()
    .from(catUpdatesTable)
    .where(
      and(
        eq(catUpdatesTable.catId, catId),
        ne(catUpdatesTable.updateType, "sighting"),
      ),
    )
    .orderBy(desc(catUpdatesTable.createdAt));

  const [fans, discovererProfile] = await Promise.all([
    fansCount(catId),
    db
      .select({
        username: profilesTable.username,
        nickname: profilesTable.nickname,
      })
      .from(profilesTable)
      .where(eq(profilesTable.deviceId, cat.discovererDeviceId))
      .then((r) => r[0]),
  ]);

  res.json({
    cat: await catPayload(
      cat,
      sightings.length,
      sightings[0]?.sighting.createdAt.toISOString() ??
        cat.createdAt.toISOString(),
    ),
    fansCount: fans,
    careTimeline: [
      ...updates.map((u) => ({
        type: u.updateType,
        message: u.message,
        at: u.createdAt.toISOString(),
      })),
      // The cat-alog entry itself is always the oldest event on the timeline.
      {
        type: "discovered" as const,
        message:
          discovererProfile?.username ??
          discovererProfile?.nickname ??
          spotterCode(cat.discovererDeviceId),
        at: cat.createdAt.toISOString(),
      },
    ],
    sightings: sightings.map(({ sighting: s, spotterUsername, spotterNickname }) => ({
      id: s.id,
      catId: s.catId,
      spotterCode: spotterCode(s.deviceId),
      spotterUsername: spotterUsername ?? null,
      spotterNickname: spotterNickname ?? null,
      photoUrl: photoUrl(s.photoId),
      lat: s.lat,
      lng: s.lng,
      createdAt: s.createdAt.toISOString(),
    })),
  });
});

// Claim an unclaimed cat. Idempotent for the same device; 409 for others.
router.post("/cats/:catId/claim", async (req, res) => {
  const catId = Number(req.params.catId);
  if (!Number.isInteger(catId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const body = ClaimCatBody.parse(req.body);

  const [cat] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
  if (!cat) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (cat.ownerDeviceId && cat.ownerDeviceId !== body.deviceId) {
    res.status(409).json({ error: "Cat already claimed by another resident" });
    return;
  }

  let updated = cat;
  if (!cat.ownerDeviceId) {
    // Guard against a concurrent claim: only set ownership if still unclaimed.
    const [row] = await db
      .update(catsTable)
      .set({
        ownerDeviceId: body.deviceId,
        ownerName: body.ownerName.trim().slice(0, 60),
        homeDescription: body.homeDescription.trim().slice(0, 200),
      })
      .where(and(eq(catsTable.id, catId), isNull(catsTable.ownerDeviceId)))
      .returning();
    if (!row) {
      res.status(409).json({ error: "Cat already claimed by another resident" });
      return;
    }
    updated = row;

    // Fire-and-forget: never blocks or fails the response.
    void notifyCatSpotters(catId, body.deviceId, {
      title: `${updated.name} has a home!`,
      body: `${updated.ownerName} claimed ${updated.name}. ${updated.homeDescription ?? ""}`.trim(),
      data: { type: "cat_claimed", catId },
    });
  }

  const count = await sightingsCountFor(catId);
  res.json(await catPayload(updated, count, new Date().toISOString()));
});

// Owner renames the cat or updates its home description.
router.patch("/cats/:catId", async (req, res) => {
  const catId = Number(req.params.catId);
  if (!Number.isInteger(catId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const body = UpdateCatBody.parse(req.body);

  const [cat] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
  if (!cat) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!cat.ownerDeviceId || cat.ownerDeviceId !== body.deviceId) {
    res.status(403).json({ error: "Only the cat's owner can update it" });
    return;
  }

  const changes: Partial<typeof catsTable.$inferInsert> = {};
  if (body.name !== undefined) {
    const newName = body.name.trim().slice(0, 60);
    if (containsOffensiveLanguage(newName)) {
      res.status(400).json({
        error: "Cat name contains offensive language",
        code: "OFFENSIVE_NAME",
      });
      return;
    }
    changes.name = newName;
  }
  if (body.homeDescription !== undefined)
    changes.homeDescription = body.homeDescription.trim().slice(0, 200);

  let updated = cat;
  if (Object.keys(changes).length > 0) {
    const [row] = await db
      .update(catsTable)
      .set(changes)
      .where(eq(catsTable.id, catId))
      .returning();
    updated = row!;

    const renamed = changes.name !== undefined && changes.name !== cat.name;
    void notifyCatSpotters(catId, body.deviceId, {
      title: renamed
        ? `${cat.name} is now ${updated.name}!`
        : `${updated.name} has an update`,
      body: renamed
        ? `${updated.ownerName} renamed their cat.`
        : `${updated.ownerName} updated ${updated.name}'s home details.`,
      data: { type: "cat_updated", catId },
    });
  }

  const count = await sightingsCountFor(catId);
  res.json(await catPayload(updated, count, new Date().toISOString()));
});

export default router;
