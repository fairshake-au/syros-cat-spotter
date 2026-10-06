import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { db, deviceCredentialsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { allowNewDevice, newDeviceResetAt } from "../middlewares/newDeviceLimit";

const MIN_SECRET_LENGTH = 16;
const MAX_SECRET_LENGTH = 256;

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * The key of the one-way "deleted device" marker (SYC-63 plan §4.3, decision
 * D). After deletion, `device_credentials` holds this instead of the device
 * id: a sha256 that can't be turned back into the id and that nothing else
 * links to. Real ids start `dev-`, so a real id never collides with it.
 */
export const DELETED_PREFIX = "deleted:";
export function deletedMarkerKey(deviceId: string): string {
  return DELETED_PREFIX + createHash("sha256").update(deviceId).digest("hex");
}
/** Not hex, so it can never equal a secret's hash. */
export const DELETED_SECRET_HASH = "deleted";

/** Has this device id been deleted by its person (SYC-63)? */
export async function isDeletedDevice(deviceId: string): Promise<boolean> {
  const [row] = await db
    .select({ deviceId: deviceCredentialsTable.deviceId })
    .from(deviceCredentialsTable)
    .where(eq(deviceCredentialsTable.deviceId, deletedMarkerKey(deviceId)));
  return row !== undefined;
}

/** What a deleted identity gets from every device-authenticated route. */
export function sendIdentityDeleted(res: Response): void {
  res.status(410).json({
    error: "This spotter's data was deleted",
    code: "IDENTITY_DELETED",
  });
}

function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies that the caller owns `deviceId` by validating the
 * `X-Device-Secret` header against the stored credential.
 *
 * Trust-on-first-use: the first request that presents a secret for a
 * device id binds that secret's hash to the id. Every later request must
 * present the same secret. Device ids are unguessable client-generated
 * strings, so an attacker who later learns one (e.g. from observed
 * traffic) cannot bind or replace the credential.
 *
 * Returns the verified device id, or `null` after writing an error
 * response (401 missing/invalid header, 403 wrong secret, 403 `device_moved`
 * when the secret is one a restore replaced: SYC-3, 410 the person deleted
 * their data: SYC-63).
 */
export async function requireDeviceAuth(
  req: Request,
  res: Response,
): Promise<string | null> {
  return verifyDeviceSecret(req, res, String(req.params["deviceId"] ?? ""));
}

/**
 * As {@link requireDeviceAuth}, but for routes where the device id arrives
 * somewhere other than a `:deviceId` path param — e.g. the sighting-resolve
 * route, which takes it in the body.
 *
 * Any route that returns a device's private payload has to go through one of
 * these two. A route that merely compares a supplied device id against a stored
 * one is checking a public value against itself.
 */
export async function verifyDeviceSecret(
  req: Request,
  res: Response,
  deviceId: string,
): Promise<string | null> {
  if (!deviceId || deviceId.length > 128 || deviceId.startsWith(DELETED_PREFIX)) {
    res.status(400).json({ error: "Invalid device id" });
    return null;
  }

  // SYC-63: this MUST come before the bind-on-first-use insert below. A
  // deleted id has no credential row, so the insert would quietly recreate
  // the identity for whoever still holds the old id (a second tab, an upload
  // that was mid-flight, a phone killed before it wiped itself). The marker
  // answers 410 instead, and the phone finishes wiping and starts fresh.
  // It also comes before the secret check, so a deleted id gets 410 whether
  // or not a secret came with it (plan §8.1 item 7).
  if (await isDeletedDevice(deviceId)) {
    sendIdentityDeleted(res);
    return null;
  }

  const header = req.headers["x-device-secret"];
  const secret = typeof header === "string" ? header : "";
  if (secret.length < MIN_SECRET_LENGTH || secret.length > MAX_SECRET_LENGTH) {
    res.status(401).json({ error: "Device secret required" });
    return null;
  }

  const secretHash = hashSecret(secret);

  const storedHash = async () =>
    (
      await db
        .select({ secretHash: deviceCredentialsTable.secretHash })
        .from(deviceCredentialsTable)
        .where(eq(deviceCredentialsTable.deviceId, deviceId))
    )[0];

  let row = await storedHash();
  if (!row) {
    // A device we've never seen: registering it spends this address's
    // new-device allowance (SYC-195). Refused, it stays unbound, so the
    // same phone works once the window resets.
    const address = req.ip ?? "unknown";
    if (!allowNewDevice(address)) {
      const resetAt = newDeviceResetAt(address);
      if (resetAt) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
      }
      res.status(429).json({
        error: "Too many new phones from this connection. Please try again later.",
      });
      return null;
    }
    // Bind on first use; a concurrent first request loses the insert race
    // and falls through to the comparison below.
    await db
      .insert(deviceCredentialsTable)
      .values({ deviceId, secretHash })
      .onConflictDoNothing({ target: deviceCredentialsTable.deviceId });
    row = await storedHash();
  }

  if (!row || !hashesMatch(row.secretHash, secretHash)) {
    if (row && (await wasMovedAway(deviceId, secretHash))) {
      res.status(403).json({ error: "device_moved" });
      return null;
    }
    res.status(403).json({ error: "Device secret does not match" });
    return null;
  }

  return deviceId;
}

/**
 * Does the caller hold `deviceId`'s secret? A read-only check for routes
 * where proving it only *adds* something to a public answer (SYC-41: an
 * owner sees their own cat's exact position on its page). Unlike
 * {@link verifyDeviceSecret} it never binds a secret on first use and never
 * writes a response: a missing, malformed or wrong secret is simply "no",
 * and the caller serves the public answer.
 */
export async function deviceSecretMatches(req: Request, deviceId: string): Promise<boolean> {
  if (!deviceId || deviceId.length > 128) return false;
  const header = req.headers["x-device-secret"];
  const secret = typeof header === "string" ? header : "";
  if (secret.length < MIN_SECRET_LENGTH || secret.length > MAX_SECRET_LENGTH) return false;
  const [row] = await db
    .select({ secretHash: deviceCredentialsTable.secretHash })
    .from(deviceCredentialsTable)
    .where(eq(deviceCredentialsTable.deviceId, deviceId));
  return !!row && hashesMatch(row.secretHash, hashSecret(secret));
}

/** How long the old phone is told "moved" after a restore (SYC-3 plan, step 2). */
export const MOVED_DAYS = 90;

/**
 * SYC-3 plan, Slice 1 step 7: was this exact secret replaced by a restore of
 * this exact id, in the last 90 days? Only then is the answer `device_moved`
 * (the app shows "Your spots moved to a new phone"). A wrong guess, or the
 * same secret presented for some other id, still gets the ordinary 403.
 */
async function wasMovedAway(deviceId: string, secretHash: string): Promise<boolean> {
  const result = await db.execute(sql`
    select 1 from mail_tokens
     where purpose = 'restore'
       and replaced_secret_hash = ${secretHash}
       and restored_device_id = ${deviceId}
       and used_at > now() - make_interval(days => ${MOVED_DAYS})
     limit 1
  `);
  return result.rows.length > 0;
}
