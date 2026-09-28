import rateLimit from "express-rate-limit";

// Per-IP throttles for public, unauthenticated endpoints.
//
// The AI-backed endpoints (POST /api/sightings, POST /api/cats/name-suggestions)
// each trigger paid OpenAI calls, so an anonymous flood can exhaust API credits
// and take AI matching down for everyone. These limits keep normal spotting
// usage comfortable (a person spots a handful of cats per hour) while stopping
// tight-loop abuse from a single address.
//
// app.ts sets `trust proxy: 1` (exactly one Replit proxy in front), so req.ip
// is the real client address and cannot be spoofed via X-Forwarded-For.

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
// land (SYC-46/#13), an enumerable integer id. This budget is generous
// enough that a tourist browsing the whole catalogue in one sitting never
// notices — a few hundred photos in fifteen minutes — while making a loop
// that walks the id range unattractive.
export const photoLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 300,
});
