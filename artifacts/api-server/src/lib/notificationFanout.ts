import {
  db,
  catSubscriptionsTable,
  catUpdatesTable,
  notificationsTable,
  pushTokensTable,
  type Cat,
  type CatUpdate,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { sendPushNotification } from "./push";

/**
 * Insert a cat_updates row and fan out notifications (in-app rows + Expo
 * push, fire-and-forget) to every subscriber of the cat, excluding
 * `excludeDeviceId` (e.g. the spotter who triggered the update).
 */
export async function createUpdateAndFanOut(opts: {
  cat: Cat;
  updateType: "sighting" | "desexed" | "adopted" | "general";
  message: string;
  triggerSightingId?: number | null;
  excludeDeviceId?: string;
}): Promise<CatUpdate> {
  const [update] = await db
    .insert(catUpdatesTable)
    .values({
      catId: opts.cat.id,
      updateType: opts.updateType,
      message: opts.message,
      triggerSightingId: opts.triggerSightingId ?? null,
    })
    .returning();

  const subscribers = await db
    .select()
    .from(catSubscriptionsTable)
    .where(eq(catSubscriptionsTable.catId, opts.cat.id));

  const recipients = subscribers
    .map((s) => s.deviceId)
    .filter((d) => d !== opts.excludeDeviceId);

  if (recipients.length > 0) {
    await db
      .insert(notificationsTable)
      .values(recipients.map((deviceId) => ({ deviceId, catUpdateId: update!.id })));

    // Push delivery is best-effort and must not block or fail the request.
    void db
      .select()
      .from(pushTokensTable)
      .where(inArray(pushTokensTable.deviceId, recipients))
      .then((tokens) => {
        for (const t of tokens) {
          void sendPushNotification(t.token, opts.cat.name, opts.message, {
            catId: opts.cat.id,
            catUpdateId: update!.id,
          });
        }
      })
      .catch(() => {});
  }

  return update!;
}
