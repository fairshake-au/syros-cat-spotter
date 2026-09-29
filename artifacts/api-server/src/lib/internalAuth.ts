import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The sign-in Worker's own secret (`INTERNAL_PEOPLE_TOKEN`), shared by the
 * SYC-113 pre-launch gate and PR #20's `/api/internal/*` routes, so both
 * check it the same way. Created here because SYC-113 landed first
 * (docs/superpowers/plans/syc-113-pre-launch-gates.md, item 2, step 3).
 *
 * - "not_configured": the server has no token; callers answer
 *   503 {"error":"not_configured"} (fails closed, never open).
 * - "unauthorized": missing or wrong token.
 * - "ok": `Authorization: Bearer <INTERNAL_PEOPLE_TOKEN>`.
 *
 * Read from the environment on every call, so a removed secret takes effect
 * at once. Both sides are SHA-256 hashed and compared in constant time,
 * following lib/deviceAuth.ts.
 */
export type InternalAuthResult = "ok" | "unauthorized" | "not_configured";

function sha256(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

export function internalTokenConfigured(): boolean {
  return Boolean(process.env["INTERNAL_PEOPLE_TOKEN"]);
}

export function checkInternalToken(
  authorization: string | undefined,
): InternalAuthResult {
  const expected = process.env["INTERNAL_PEOPLE_TOKEN"] ?? "";
  if (!expected) return "not_configured";
  const match = /^Bearer (.+)$/i.exec(authorization ?? "");
  const supplied = match?.[1] ?? "";
  if (!supplied) return "unauthorized";
  return timingSafeEqual(sha256(expected), sha256(supplied))
    ? "ok"
    : "unauthorized";
}
