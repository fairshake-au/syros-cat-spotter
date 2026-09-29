import rateLimit from "express-rate-limit";

// Per-IP throttles for public, unauthenticated endpoints.
//
// The AI-backed endpoints (POST /api/sightings, POST /api/cats/name-suggestions)
// each trigger paid OpenAI calls, so an anonymous flood can exhaust API credits
// and take AI matching down for everyone. These limits keep normal spotting
// usage comfortable (a person spots a handful of cats per hour) while stopping
// tight-loop abuse from a single address.
//
// app.ts sets `trust proxy: 1`, assuming exactly one Replit proxy hop in
// front of this process. That assumption is UNVERIFIED against production
// (DEPLOYMENT.md §C: "Confirm trust proxy matches Replit's production
// proxy chain" is still an open checkbox) — if the real chain has more
// hops, req.ip resolves to a shared proxy address rather than the real
// client, and every visitor lands in one limiter bucket together. This PR
// does not change the value; it only adds a second limiter (photoLimiter,
// below) that inherits whatever that setting turns out to mean in
// production. Confirming the real hop count is tracked separately.

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
