import { Router, type IRouter } from "express";
import { db, catsTable, sightingsTable, profilesTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { listCatsWithStats, photoUrl, spotterCode } from "../lib/catHelpers";

const router: IRouter = Router();

router.get("/cats", async (req, res) => {
  const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
  const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
  const cats = await listCatsWithStats(
    Number.isFinite(lat) ? lat : undefined,
    Number.isFinite(lng) ? lng : undefined,
  );
  res.json(cats);
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
    .select()
    .from(sightingsTable)
    .where(
      and(eq(sightingsTable.catId, catId), eq(sightingsTable.status, "resolved")),
    )
    .orderBy(desc(sightingsTable.createdAt));

  res.json({
    cat: {
      id: cat.id,
      name: cat.name,
      description: cat.description,
      photoUrl: photoUrl(cat.primaryPhotoId),
      lat: cat.lat,
      lng: cat.lng,
      sightingsCount: sightings.length,
      lastSeenAt:
        sightings[0]?.createdAt.toISOString() ?? cat.createdAt.toISOString(),
      discovererSpotterCode: spotterCode(cat.discovererDeviceId),
      discovererNickname:
        (
          await db
            .select({ nickname: profilesTable.nickname })
            .from(profilesTable)
            .where(eq(profilesTable.deviceId, cat.discovererDeviceId))
        )[0]?.nickname ?? null,
    },
    sightings: sightings.map((s) => ({
      id: s.id,
      catId: s.catId,
      spotterCode: spotterCode(s.deviceId),
      photoUrl: photoUrl(s.photoId),
      lat: s.lat,
      lng: s.lng,
      createdAt: s.createdAt.toISOString(),
    })),
  });
});

export default router;
