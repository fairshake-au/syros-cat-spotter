import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { db, deviceCredentialsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const MIN_SECRET_LENGTH = 16;
const MAX_SECRET_LENGTH = 256;

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
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
 * response (401 missing/invalid header, 403 wrong secret).
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
  if (!deviceId || deviceId.length > 128) {
    res.status(400).json({ error: "Invalid device id" });
    return null;
  }

  const header = req.headers["x-device-secret"];
  const secret = typeof header === "string" ? header : "";
  if (secret.length < MIN_SECRET_LENGTH || secret.length > MAX_SECRET_LENGTH) {
    res.status(401).json({ error: "Device secret required" });
    return null;
  }

  const secretHash = hashSecret(secret);

  // Bind on first use; a concurrent first request loses the insert race
  // and falls through to the comparison below.
  await db
    .insert(deviceCredentialsTable)
    .values({ deviceId, secretHash })
    .onConflictDoNothing({ target: deviceCredentialsTable.deviceId });

  const [row] = await db
    .select({ secretHash: deviceCredentialsTable.secretHash })
    .from(deviceCredentialsTable)
    .where(eq(deviceCredentialsTable.deviceId, deviceId));

  if (!row || !hashesMatch(row.secretHash, secretHash)) {
    res.status(403).json({ error: "Device secret does not match" });
    return null;
  }

  return deviceId;
}
