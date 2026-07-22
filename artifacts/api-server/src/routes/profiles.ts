import { Router, type IRouter } from "express";
import { db, profilesTable, catsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { profilePayload, spotterCode } from "../lib/catHelpers";

const router: IRouter = Router();

router.get("/profiles/:deviceId", async (req, res) => {
  const deviceId = String(req.params.deviceId);
  if (!deviceId || deviceId.length > 128) {
    res.status(400).json({ error: "Invalid device id" });
    return;
  }
  res.json(await profilePayload(deviceId));
});

router.patch("/profiles/:deviceId", async (req, res) => {
  const deviceId = String(req.params.deviceId);
  if (!deviceId || deviceId.length > 128) {
    res.status(400).json({ error: "Invalid device id" });
    return;
  }
  const raw = req.body?.nickname;
  if (raw !== null && raw !== undefined && typeof raw !== "string") {
    res.status(400).json({ error: "Nickname must be a string" });
    return;
  }
  // Basic moderation guard: trim, collapse whitespace, strip control chars, length cap
  let nickname: string | null = null;
  if (typeof raw === "string") {
    nickname = raw
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (nickname.length === 0) nickname = null;
    else if (nickname.length > 24) {
      res.status(400).json({ error: "Nickname must be 24 characters or fewer" });
      return;
    }
  }

  // Ensure profile exists, then update
  await db
    .insert(profilesTable)
    .values({ deviceId })
    .onConflictDoNothing();
  await db
    .update(profilesTable)
    .set({ nickname })
    .where(eq(profilesTable.deviceId, deviceId));

  res.json(await profilePayload(deviceId));
});

router.get("/leaderboard", async (_req, res) => {
  const rows = await db
    .select({
      deviceId: profilesTable.deviceId,
      nickname: profilesTable.nickname,
      points: profilesTable.points,
      uniqueCatsDiscovered: sql<number>`(
        select count(*)::int from ${catsTable}
        where ${catsTable.discovererDeviceId} = ${profilesTable.deviceId}
      )`,
    })
    .from(profilesTable)
    .orderBy(desc(profilesTable.points))
    .limit(20);

  // Never expose raw device ids publicly — they are the profile credential.
  res.json(
    rows.map(({ deviceId, ...r }, i) => ({
      ...r,
      spotterCode: spotterCode(deviceId),
      rank: i + 1,
    })),
  );
});

export default router;
