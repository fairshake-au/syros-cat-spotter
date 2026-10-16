import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getAppSettings } from "../lib/appSettings";
import { verifyDeviceSecret } from "../lib/deviceAuth";
import { todayInStreakTimezone } from "../lib/streak";
import { signalsLimiter } from "../middlewares/rateLimit";

const router: IRouter = Router();

/**
 * The match-wait switches for the app (SYC-36 / SYC-48, plan PR 1). Public:
 * nothing here is about a person. The full donation address is not sent: the
 * app opens /api/go/feed, which counts the tap and forwards, and shows the
 * page's host under the button ("Opens syroscats.com in your browser").
 */
router.get("/app-settings", async (_req, res) => {
  const settings = await getAppSettings();
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({
    feedNudge: settings.donateUrl ? { donateHost: new URL(settings.donateUrl).host } : null,
    hiddenFacts: settings.hiddenFacts,
    // SYC-415 spec §6.7: the app shows the extra-photo boxes only once the
    // server says so, so a new app never sends extras to an old server.
    extraPhotos: settings.extraPhotosOn,
  });
});

/**
 * "Does this phone look like a resident's?" (`feeding-nudge.md` §3.2, §9).
 *
 * - `hasClaimedCat`: has this phone EVER claimed a cat (plan C2, small call
 *   2)? A claim is an owner's `homed` observation; letting the cat go adds a
 *   row that supersedes it, and the original keeps its device id, so this
 *   stays true after a let-go.
 * - `firstSpotDate`: the Athens day this phone's first sighting ARRIVED (plan
 *   C1). `sightings.created_at` is the photo's capture time, which can be up
 *   to 21 days earlier for a library photo, so the photo row's own insert
 *   time is used. Photos have no foreign key from sightings and can be
 *   deleted, so the sighting's own time stands in when the photo is gone.
 *
 * `bind: false`: asking never binds a new phone or spends the new-device
 * allowance. A never-bound phone gets 403, a deleted one 410; the app reads
 * any answer but 200 as "unknown" (no one-liner).
 */
router.get("/app-settings/:deviceId/signals", signalsLimiter, async (req, res) => {
  const deviceId = await verifyDeviceSecret(req, res, String(req.params["deviceId"] ?? ""), {
    bind: false,
  });
  if (!deviceId) return;

  const claimed = await db.execute<{ claimed: boolean }>(sql`
    select exists (
      select 1 from observations o
       where o.device_id = ${deviceId}
         and o.kind = 'life_status'
         and o.value->>'status' = 'homed'
         and o.authority_scope = 'owner_of_this_cat'
    ) as claimed`);

  const first = await db.execute<{ first_at: Date | string | null }>(sql`
    select min(coalesce(p.created_at, s.created_at)) as first_at
      from sightings s
      left join photos p on p.id = s.photo_id
     where s.device_id = ${deviceId}`);

  const firstAt = first.rows[0]?.first_at ?? null;
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    hasClaimedCat: claimed.rows[0]?.claimed === true,
    firstSpotDate: firstAt === null ? null : todayInStreakTimezone(new Date(firstAt)),
  });
});

export default router;
