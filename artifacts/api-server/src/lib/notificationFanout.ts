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
import type { DbOrTx } from "./observations";
import { isResolvedDeceased } from "./catHelpers";
import { logger } from "./logger";

/**
 * Insert a cat_updates row. Takes `tx` so a caller that also needs to write
 * an observation in the same logical change (data-spine.md PR 2) can do
 * both in one transaction — see `routes/notifications.ts`'s admin care
 * route, which inserts the `cat_updates` row and calls `writeObservation`
 * inside the same `db.transaction`, then calls {@link fanOutNotifications}
 * only after that transaction has committed.
 */
export async function insertCatUpdate(
  tx: DbOrTx,
  opts: {
    cat: Cat;
    updateType: "sighting" | "desexed" | "adopted" | "general";
    message: string;
    triggerSightingId?: number | null;
    /**
     * Review of PR #67 (SYC-52), finding B1: left to the column's own
     * `defaultNow()`, `cat_updates.created_at` carries microsecond
     * precision while a JS `Date` (what every observation's `observedAt`
     * is built from) only has milliseconds — so a later equality match
     * between the two (PR 3's backfill match key) never hits. A caller
     * that also writes an observation for this same event (currently only
     * `routes/notifications.ts`'s admin care route) passes the exact same
     * `Date` here as it passes as that observation's `observedAt`, so both
     * rows carry the identical millisecond-precision instant.
     */
    createdAt?: Date;
  },
): Promise<CatUpdate> {
  const [update] = await tx
    .insert(catUpdatesTable)
    .values({
      catId: opts.cat.id,
      updateType: opts.updateType,
      message: opts.message,
      triggerSightingId: opts.triggerSightingId ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  return update!;
}

/**
 * Fan out notifications (in-app rows + Expo push, fire-and-forget) to every
 * subscriber of the cat, excluding `excludeDeviceId` (e.g. the spotter who
 * triggered the update). For a sighting, only the cat's owner is notified
 * now; the other followers' in-app rows and pushes wait for the evening
 * round-up (§6.4.4).
 *
 * Always runs on the plain pool, never inside a caller's transaction: a
 * caller that writes the `cat_updates` row (and any observation alongside
 * it) in a transaction must call this only once that transaction has
 * committed (review of PR #66 — see `insertCatUpdate`'s doc comment), so a
 * rolled-back write never has notifications or a push sent for it.
 */
export async function fanOutNotifications(opts: {
  cat: Cat;
  update: CatUpdate;
  excludeDeviceId?: string;
}): Promise<void> {
  // §3.3: "Notifications stop" for a cat with a live deceased statement —
  // "the cruellest bug in the app" would be everyone who ever spotted her
  // still getting "Agatha was spotted again!" about a cat the team has
  // recorded as dead. Follows are kept (nothing here touches
  // cat_subscriptions), so a later sighting that clears the status (§3.2)
  // resumes them automatically — this check simply re-runs on that call too.
  if (await isResolvedDeceased(opts.cat.id)) {
    logger.info(
      { catId: opts.cat.id, catUpdateId: opts.update.id },
      "fan-out skipped: cat is recorded as deceased",
    );
    return;
  }

  const subscribers = await db
    .select()
    .from(catSubscriptionsTable)
    .where(eq(catSubscriptionsTable.catId, opts.cat.id));

  const followers = subscribers
    .map((s) => s.deviceId)
    .filter((d) => d !== opts.excludeDeviceId);

  // §6.4.4 (data-spine.md PR 9, Q4 = A): a live sighting notification would
  // give anyone who once spotted this cat a to-the-minute record of when
  // it's seen. So only the cat's owner hears about a sighting straight away,
  // in the app and by push; everyone else's in-app row and push come in the
  // evening round-up (`sightingRoundUp.ts`), which never carries a time.
  // Care updates (sterilised, adopted, general) say nothing about when or
  // where a cat is, so they stay live for every follower.
  const recipients =
    opts.update.updateType === "sighting"
      ? followers.filter((d) => d === opts.cat.ownerDeviceId)
      : followers;

  if (recipients.length === 0) return;

  await db
    .insert(notificationsTable)
    .values(recipients.map((deviceId) => ({ deviceId, catUpdateId: opts.update.id })));

  // Push delivery is best-effort and must not block or fail the request.
  void db
    .select()
    .from(pushTokensTable)
    .where(inArray(pushTokensTable.deviceId, recipients))
    .then((tokens) => {
      for (const t of tokens) {
        void sendPushNotification(t.token, opts.cat.name, opts.update.message, {
          catId: opts.cat.id,
          catUpdateId: opts.update.id,
        });
      }
    })
    .catch(() => {});
}

/**
 * Convenience wrapper for a caller with nothing else to commit alongside
 * the `cat_updates` row (routes/sightings.ts's resolve route): inserts it on
 * the plain pool and fans out immediately. A caller that writes an
 * observation in the same logical change must use `insertCatUpdate` inside
 * its own transaction and call `fanOutNotifications` after it commits
 * instead of calling this.
 */
export async function createUpdateAndFanOut(opts: {
  cat: Cat;
  updateType: "sighting" | "desexed" | "adopted" | "general";
  message: string;
  triggerSightingId?: number | null;
  excludeDeviceId?: string;
}): Promise<CatUpdate> {
  const update = await insertCatUpdate(db, opts);
  await fanOutNotifications({
    cat: opts.cat,
    update,
    excludeDeviceId: opts.excludeDeviceId,
  });
  return update;
}
