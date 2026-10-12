/**
 * The colony campaign shown on the Help tab.
 *
 * Server-side config rather than app constants, so the numbers can be corrected
 * without shipping an App Store release. There is no payments backend yet — the
 * app links out to `donateUrl` and no money moves through this codebase. When a
 * real donations backend lands, this module is the seam to replace.
 */
export interface Campaign {
  /** Stable id so the client can cache/compare across refreshes. */
  id: string;
  title: string;
  /** Where the money goes, in plain language. Shown under the progress card. */
  blurb: string;
  currency: "EUR";
  goalCents: number;
  raisedCents: number;
  catsHelped: number;
  donors: number;
  /** ISO date the campaign closes; the client derives "days left" from it. */
  endsAt: string;
  /** External donation page. Opened in a browser — never an in-app payment. */
  donateUrl: string;
  /** Suggested chip-in amounts, in cents. */
  suggestedAmountsCents: number[];
}

/**
 * The donate URL is opened from a trusted in-app button, so a mis-set env var
 * (or a tampered response) would walk users straight from "Chip in €10" to an
 * attacker's page. Only absolute https URLs are allowed through; anything else
 * — http, `javascript:`, a relative path, junk — becomes empty, and the client
 * renders the no-donations-yet state instead of a button.
 */
export function sanitizeDonateUrl(raw: string | undefined): string {
  if (!raw || raw.trim() === "") return "";
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:") return "";
  if (!parsed.hostname) return "";
  return parsed.toString();
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  // A typo'd env var must not silently render as NaN or 0 on the campaign card.
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number, got: ${raw}`);
  }
  return Math.round(n);
}

export function getCampaign(): Campaign {
  return {
    id: process.env.CAMPAIGN_ID ?? "vaporia-desexing",
    title: process.env.CAMPAIGN_TITLE ?? "Help us desex the Vaporia colony",
    // Costs here are donor-facing claims about a charity's finances — check
    // the canonical-facts table in CLAUDE.md before changing them. A
    // sterilisation is €50–60 per cat, not the €25 the design mockup showed.
    blurb:
      process.env.CAMPAIGN_BLURB ??
      "€10 covers a rabies vaccine. €50–60 desexes one cat. Every euro goes to the vet in Ερμούπολη.",
    currency: "EUR",
    goalCents: intFromEnv("CAMPAIGN_GOAL_CENTS", 400_000),
    raisedCents: intFromEnv("CAMPAIGN_RAISED_CENTS", 0),
    catsHelped: intFromEnv("CAMPAIGN_CATS_HELPED", 0),
    donors: intFromEnv("CAMPAIGN_DONORS", 0),
    endsAt: process.env.CAMPAIGN_ENDS_AT ?? "2026-12-31",
    donateUrl: sanitizeDonateUrl(process.env.CAMPAIGN_DONATE_URL),
    // €60 is one whole sterilisation (SYC-14; Samuel, 12 Oct 2026).
    suggestedAmountsCents: [500, 1000, 2500, 6000],
  };
}
