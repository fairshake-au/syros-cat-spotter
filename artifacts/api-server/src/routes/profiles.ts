import { Router, type IRouter } from "express";
import { db, profilesTable, catsTable } from "@workspace/db";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { profilePayload, spotterCode } from "../lib/catHelpers";
import { TEAM_DESK_DEVICE } from "../lib/teamDesk";
import { normalizeUsername, suggestUsernames } from "../lib/usernames";
import { containsOffensiveLanguage } from "../lib/moderation";
import {
  DELETED_PREFIX,
  isDeletedDevice,
  requireDeviceAuth,
  verifyDeviceSecret,
} from "../lib/deviceAuth";
import { DELETED_BY_THE_PERSON, severPerson } from "../lib/severPerson";
import { deleteMeLimiter } from "../middlewares/rateLimit";

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

/**
 * DELETE /api/me — "Delete my data" (SYC-63 plan §4.1). The device id comes in
 * the X-Device-Id header and the secret in X-Device-Secret, so neither lands
 * in a request log (the URL has nothing identifying) and no proxy can drop
 * them as it might a DELETE body.
 *
 * Running it twice is safe: the first call leaves the "deleted device"
 * marker, and every later call finds it and answers 204 without binding
 * anything (§4.4). A wrong secret gets 403 and deletes nothing.
 */
router.delete("/me", deleteMeLimiter, async (req, res) => {
  const header = req.headers["x-device-id"];
  const deviceId = typeof header === "string" ? header : "";
  if (!deviceId || deviceId.length > 128 || deviceId.startsWith(DELETED_PREFIX)) {
    res.status(400).json({ error: "Invalid device id" });
    return;
  }
  // Before verifyDeviceSecret, whose bind-on-first-use would otherwise be
  // the first thing a retry touches (§4.1 step 1).
  if (await isDeletedDevice(deviceId)) {
    res.status(204).end();
    return;
  }
  // Never binds: an id that has no secret yet can't be deleted by whoever
  // sends one first. The app always binds on its first call, long before.
  const verified = await verifyDeviceSecret(req, res, deviceId, { bind: false });
  if (!verified) return;

  await db.transaction((tx) =>
    severPerson(tx, { deviceId: verified, reason: DELETED_BY_THE_PERSON }),
  );
  req.log.info("person deleted their data");
  res.status(204).end();
});

// Static /profiles/* routes must come before the /profiles/:deviceId param route.
router.get("/profiles/username-availability", async (req, res) => {
  const name = normalizeUsername(req.query.name);
  if (!name) {
    res.json({ available: false, reason: "invalid" });
    return;
  }
  if (containsOffensiveLanguage(name)) {
    res.json({ available: false, reason: "offensive" });
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

// Both the lightweight read and the write require the device's credential.
// The read is also used to reconcile a claim whose response was lost.
router.get("/profiles/:deviceId/username", async (req, res) => {
  const deviceId = await requireDeviceAuth(req, res);
  if (!deviceId) return;
  const [profile] = await db
    .select({ username: profilesTable.username })
    .from(profilesTable)
    .where(eq(profilesTable.deviceId, deviceId));
  res.json({ username: profile?.username ?? null });
});

router.post("/profiles/:deviceId/username", async (req, res) => {
  const started = performance.now();
  const deviceId = await requireDeviceAuth(req, res);
  if (!deviceId) return;
  const authMs = Math.round(performance.now() - started);
  const username = normalizeUsername(req.body?.username);
  if (!username) {
    res.status(400).json({ error: "Username must be 3-24 letters, numbers or spaces" });
    return;
  }
  if (containsOffensiveLanguage(username)) {
    res.status(400).json({
      error: "Username contains offensive language",
      code: "offensive_username",
    });
    return;
  }
  const dbStarted = performance.now();
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
    req.log.info({ authMs, dbMs: Math.round(performance.now() - dbStarted), result: "taken" }, "Username claim timing");
    res.status(409).json({ error: "Username already taken" });
    return;
  }
  await db.insert(profilesTable).values({ deviceId }).onConflictDoNothing();
  try {
    const [updated] = await db
      .update(profilesTable)
      .set({ username })
      .where(eq(profilesTable.deviceId, deviceId))
      .returning({ username: profilesTable.username });
    const dbMs = Math.round(performance.now() - dbStarted);
    const responseStarted = performance.now();
    res.json({ username: updated.username });
    req.log.info({ authMs, dbMs, responseMs: Math.round(performance.now() - responseStarted), totalMs: Math.round(performance.now() - started), result: "claimed" }, "Username claim timing");
  } catch (err: unknown) {
    // Unique-index race: someone claimed the same name concurrently.
    // Drizzle may wrap the pg error, so check the cause chain for code 23505.
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }
    throw err;
  }
});

// The profile payload is a private view of one device: points, streak, owned
// cats, and `spottedCatIds` — a list of every cat that device has visited,
// which is closer to a location history than to a score. Device ids are not
// secrets (they travel in request paths; see lib/db/src/schema/devices.ts), so
// the path param alone cannot authorise this. The `X-Device-Secret` header can,
// and the client already sends it on every request.
router.get("/profiles/:deviceId", async (req, res) => {
  const deviceId = await requireDeviceAuth(req, res);
  if (!deviceId) return;
  res.json(await profilePayload(deviceId));
});

router.patch("/profiles/:deviceId", async (req, res) => {
  const deviceId = await requireDeviceAuth(req, res);
  if (!deviceId) return;
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
    // SYC-677 R22b: the team desk is nobody's phone and never on the board.
    .where(ne(profilesTable.deviceId, TEAM_DESK_DEVICE))
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
