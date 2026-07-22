import { Router, type IRouter } from "express";
import { db, profilesTable, catsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { profilePayload } from "../lib/catHelpers";

const router: IRouter = Router();

router.get("/profiles/:deviceId", async (req, res) => {
  const deviceId = String(req.params.deviceId);
  if (!deviceId || deviceId.length > 128) {
    res.status(400).json({ error: "Invalid device id" });
    return;
  }
  res.json(await profilePayload(deviceId));
});

router.get("/leaderboard", async (_req, res) => {
  const rows = await db
    .select({
      deviceId: profilesTable.deviceId,
      points: profilesTable.points,
      uniqueCatsDiscovered: sql<number>`(
        select count(*)::int from ${catsTable}
        where ${catsTable.discovererDeviceId} = ${profilesTable.deviceId}
      )`,
    })
    .from(profilesTable)
    .orderBy(desc(profilesTable.points))
    .limit(20);

  res.json(rows.map((r, i) => ({ ...r, rank: i + 1 })));
});

export default router;
