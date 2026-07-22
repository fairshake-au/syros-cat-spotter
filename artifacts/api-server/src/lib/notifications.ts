import { db, sightingsTable } from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";

export interface CatNotification {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Dispatch a push notification to a set of devices.
 *
 * Placeholder dispatch point for the push-notification infrastructure being
 * built separately (spotter notifications task). Once that lands (e.g. Expo
 * push tokens stored per device), replace the body of this function with the
 * real delivery call — all callers already route through here.
 */
export async function notifyDevices(
  deviceIds: string[],
  notification: CatNotification,
): Promise<void> {
  if (deviceIds.length === 0) return;
  console.log(
    `[notifications] dispatch to ${deviceIds.length} device(s): ${notification.title} — ${notification.body}`,
    { deviceIds, data: notification.data },
  );
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
