import { Router, type IRouter } from "express";
import { db, profilesTable, catsTable } from "@workspace/db";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { profilePayload, spotterCode } from "../lib/catHelpers";
import { normalizeUsername, suggestUsernames } from "../lib/usernames";
import { containsOffensiveLanguage } from "../lib/moderation";

const router: IRouter = Router();

/** True when err (or any error in its cause chain) is a Postgres unique violation. */
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur && typeof cur === "object" && depth < 5; depth++) {
    if ((cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// Static /profiles/* routes must come before the /profiles/:deviceId param route.
router.get("/profiles/username-availability", async (req, res) => {
  const name = normalizeUsername(req.query.name);
  if (!name) {
    res.json({ available: false, reason: "invalid" });
    return;
  }
  const [existing] = await db
    .select({ deviceId: profilesTable.deviceId })
    .from(profilesTable)
    .where(sql`lower(${profilesTable.username}) = ${name.toLowerCase()}`);
  res.json(existing ? { available: false, reason: "taken" } : { available: true });
});

router.get("/profiles/username-suggestions", async (_req, res) => {
  res.json({ suggestions: await suggestUsernames(6) });
});

router.post("/profiles/:deviceId/username", async (req, res) => {
  const deviceId = String(req.params.deviceId);
  if (!deviceId || deviceId.length > 128) {
    res.status(400).json({ error: "Invalid device id" });
    return;
  }
  const username = normalizeUsername(req.body?.username);
  if (!username) {
    res.status(400).json({ error: "Username must be 3-24 letters, numbers or spaces" });
    return;
  }
  // Taken by someone else? (unique index still guards against races)
  const [existing] = await db
    .select({ deviceId: profilesTable.deviceId })
    .from(profilesTable)
    .where(
      and(
        sql`lower(${profilesTable.username}) = ${username.toLowerCase()}`,
        ne(profilesTable.deviceId, deviceId),
      ),
    );
  if (existing) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }
  await db.insert(profilesTable).values({ deviceId }).onConflictDoNothing();
  try {
    await db
      .update(profilesTable)
      .set({ username })
      .where(eq(profilesTable.deviceId, deviceId));
  } catch (err: unknown) {
    // Unique-index race: someone claimed the same name concurrently.
    // Drizzle may wrap the pg error, so check the cause chain for code 23505.
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }
    throw err;
  }
  res.json(await profilePayload(deviceId));
});

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
    } else if (containsOffensiveLanguage(nickname)) {
      res.status(400).json({
        error: "Nickname contains offensive language",
        code: "offensive_nickname",
      });
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
      username: profilesTable.username,
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
