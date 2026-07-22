import { db, pushTokensTable, sightingsTable } from "@workspace/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendPushNotification } from "./push";

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
 * Notify every distinct device with a resolved sighting of this cat,
 * excluding the acting device. Fire-and-forget: never throws.
 */
export async function notifyCatSpotters(
  catId: number,
  actingDeviceId: string,
  notification: CatNotification,
): Promise<void> {
  try {
    const rows = await db
      .select({ deviceId: sql<string>`distinct ${sightingsTable.deviceId}` })
      .from(sightingsTable)
      .where(
        and(
          eq(sightingsTable.catId, catId),
          eq(sightingsTable.status, "resolved"),
          ne(sightingsTable.deviceId, actingDeviceId),
        ),
      );
    await notifyDevices(
      rows.map((r) => r.deviceId),
      notification,
    );
  } catch (err) {
    console.error("[notifications] failed to notify cat spotters", err);
  }
}
