import rateLimit from "express-rate-limit";

// Per-IP throttles for public, unauthenticated endpoints.
//
// The AI-backed endpoints (POST /api/sightings, POST /api/cats/name-suggestions)
// each trigger paid OpenAI calls, so an anonymous flood can exhaust API credits
// and take AI matching down for everyone. These limits keep normal spotting
// usage comfortable (a person spots a handful of cats per hour) while stopping
// tight-loop abuse from a single address.
//
// app.ts sets `trust proxy: 4`, measured on the live deployment
// (SYC-100, 3 Oct 2026). With it, req.ip is the real visitor, so each
// visitor gets their own limiter bucket. With a value that's too low, every
// visitor would share a Replit proxy's address and one bucket.

const common = {
  standardHeaders: true as const,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
};

// Expensive AI endpoints: strict budget.
export const aiLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 20,
});

// GET /api/photos/:photoId (hosting-and-photo-storage.md §6.2 item 2): the
// route serves usage-billed compute with no auth and, until unguessable ids
// land (SYC-46/SYC-98), an enumerable integer id. This budget is generous
// enough that a tourist browsing the whole catalogue in one sitting never
// notices — a few hundred photos in fifteen minutes — while making a loop
// that walks the id range unattractive.
//
// This is a per-IP budget, so it stands or falls on the trust-proxy hop
// count above being right for production. If it's wrong in the direction
// of "fewer hops configured than actually exist", every visitor shares one
// bucket and photos start 429ing for everyone, not just an abusive one —
// worth remembering the first time this route's rate limit looks too
// aggressive in the wild.
export const photoLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 300,
});

// POST /api/team/handoff (SYC-43 part 1 plan §5): a courtesy cap on
// signature-checking work, not a security control. Each pass is single-use in
// Postgres and every session is re-checked against the list, so nothing that
// security depends on rests on this per-server, in-memory count.
export const handoffLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 60,
});

// Data spine PR 5 (DECISIONS.md Part 2h; docs/superpowers/plans/data-spine.md
// §PR 5): POST /sightings' candidate matching is rate-limited per DEVICE, not
// per IP. SYC-39's exact-position matching is a nearest-cat oracle (see
// cat-record-data-spine.md §6.3) — the IP-keyed `aiLimiter` above would let
// anyone behind a shared address (a café, a ferry terminal) throttle a
// stranger's spotting, and would let an attacker on their own IP rotate
// addresses for a fresh 20-request budget instead of a fresh device.
//
// Keyed on a device id ONLY after routes/sightings.ts has called
// verifyDeviceSecret() (SYC-107) and gotten it back — never on the raw,
// unverified body.deviceId, and never on the IP. This is a plain in-memory
// counter rather than express-rate-limit, because the key is only known
// partway through the handler (after the secret check), not at the point
// Express picks middleware.
//
// Same budget as the old per-IP limiter (20 per 15 minutes) — this PR swaps
// the key, not the shape. SYC-105 tracks moving the count into Postgres so
// one shared budget holds across app instances; until then this Map is
// per-process, so a device gets roughly limit × (number of app instances)
// requests before every instance has throttled it, the same scaling gap the
// old per-IP limiter had. Not solved here.
export const DEVICE_MATCH_LIMIT = 20;
export const DEVICE_MATCH_WINDOW_MS = 15 * 60 * 1000;

type DeviceWindow = { count: number; resetAt: number };
const deviceMatchWindows = new Map<string, DeviceWindow>();

/**
 * Returns true if `deviceId` may make another candidate-matching request
 * right now, and records that it did. Returns false, without recording
 * anything further, once the device has used its budget for the current
 * window — i.e. the 21st call within DEVICE_MATCH_WINDOW_MS of the window's
 * start returns false, and the 20th returns true.
 */
export function checkDeviceMatchLimit(
  deviceId: string,
  now: number = Date.now(),
): boolean {
  const existing = deviceMatchWindows.get(deviceId);
  if (!existing || existing.resetAt <= now) {
    deviceMatchWindows.set(deviceId, {
      count: 1,
      resetAt: now + DEVICE_MATCH_WINDOW_MS,
    });
    return true;
  }
  if (existing.count >= DEVICE_MATCH_LIMIT) {
    return false;
  }
  existing.count += 1;
  return true;
}

/** Test-only: clears every device's window so tests don't leak into each other. */
export function _resetDeviceMatchLimitForTests(): void {
  deviceMatchWindows.clear();
}
