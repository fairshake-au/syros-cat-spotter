import { and, eq, sql } from "drizzle-orm";
import { db, catSubscriptionsTable, catUnfollowsTable } from "@workspace/db";

/**
 * SYC-624: following a cat. `cat_subscriptions` says who hears about a cat;
 * `cat_unfollows` remembers a phone that chose to stop, so spotting the cat
 * again does not quietly follow it again.
 *
 * `tx` is a transaction (or `db`); callers lock the cat row first.
 */
type Exec = Pick<typeof db, "select" | "insert" | "delete">;

/** Follow: forget any earlier unfollow, then subscribe (a double tap keeps one row). */
export async function follow(tx: Exec, input: { deviceId: string; catId: number }): Promise<void> {
  const { deviceId, catId } = input;
  await tx
    .delete(catUnfollowsTable)
    .where(and(eq(catUnfollowsTable.deviceId, deviceId), eq(catUnfollowsTable.catId, catId)));
  await tx.insert(catSubscriptionsTable).values({ deviceId, catId }).onConflictDoNothing();
}

/** Unfollow: drop the subscription and record the choice. */
export async function unfollow(tx: Exec, input: { deviceId: string; catId: number }): Promise<void> {
  const { deviceId, catId } = input;
  await tx
    .delete(catSubscriptionsTable)
    .where(and(eq(catSubscriptionsTable.deviceId, deviceId), eq(catSubscriptionsTable.catId, catId)));
  await tx.insert(catUnfollowsTable).values({ deviceId, catId }).onConflictDoNothing();
}

/** How many phones follow the cat; a deleted phone's leftover row is not counted. */
export async function followersCount(catId: number, exec: Exec = db): Promise<number> {
  const [row] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(catSubscriptionsTable)
    .where(and(eq(catSubscriptionsTable.catId, catId), sql`${catSubscriptionsTable.deviceId} not like 'deleted:%'`));
  return row?.n ?? 0;
}

export async function isFollowing(deviceId: string, catId: number, exec: Exec = db): Promise<boolean> {
  const rows = await exec
    .select({ one: sql<number>`1` })
    .from(catSubscriptionsTable)
    .where(and(eq(catSubscriptionsTable.deviceId, deviceId), eq(catSubscriptionsTable.catId, catId)))
    .limit(1);
  return rows.length > 0;
}
