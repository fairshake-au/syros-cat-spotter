import { db, pushTokensTable, catSubscriptionsTable } from "@workspace/db";
import { and, eq, inArray, ne, notLike } from "drizzle-orm";
import { logger } from "./logger";
import { sendPushNotification } from "./push";
import { isResolvedDeceased } from "./catHelpers";

export interface CatNotification {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Dispatch a real Expo push notification to a set of devices.
 *
 * Looks up each device's stored Expo push token and delivers through the
 * Expo push service. Devices without a registered token are skipped (they
 * still learn about changes via the in-app ownership banner). Best-effort:
 * errors are logged, never thrown.
 */
export async function notifyDevices(
  deviceIds: string[],
  notification: CatNotification,
): Promise<void> {
  if (deviceIds.length === 0) return;
  try {
    const tokens = await db
      .select()
      .from(pushTokensTable)
      .where(inArray(pushTokensTable.deviceId, deviceIds));
    logger.info(
      {
        devices: deviceIds.length,
        tokens: tokens.length,
        title: notification.title,
      },
      "Dispatching push notifications",
    );
    await Promise.all(
      tokens.map((t) =>
        sendPushNotification(
          t.token,
          notification.title,
          notification.body,
          notification.data,
        ),
      ),
    );
  } catch (err) {
    logger.warn({ err }, "Push dispatch failed");
  }
}

/**
 * Notify every follower of this cat (SYC-624), excluding the acting device.
 * A phone that unfollowed has no row, so it hears nothing; a follower who
 * never spotted the cat does hear. Fire-and-forget: never throws.
 */
export async function notifyCatFollowers(
  catId: number,
  actingDeviceId: string,
  notification: CatNotification,
): Promise<void> {
  try {
    // data-spine.md PR 4, §3.3: never push about a cat recorded as deceased
    // (same rule as fanOutNotifications — see its doc comment). Follows
    // stay; a later sighting that clears the status resumes them.
    if (await isResolvedDeceased(catId)) {
      logger.info({ catId }, "notifyCatFollowers skipped: cat is recorded as deceased");
      return;
    }
    const rows = await db
      .select({ deviceId: catSubscriptionsTable.deviceId })
      .from(catSubscriptionsTable)
      .where(
        and(
          eq(catSubscriptionsTable.catId, catId),
          ne(catSubscriptionsTable.deviceId, actingDeviceId),
          // A phone that deleted its data (SYC-63) is never sent anything.
          notLike(catSubscriptionsTable.deviceId, "deleted:%"),
        ),
      );
    await notifyDevices(
      rows.map((r) => r.deviceId),
      notification,
    );
  } catch (err) {
    console.error("[notifications] failed to notify cat followers", err);
  }
}
