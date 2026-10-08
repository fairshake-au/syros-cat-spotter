/**
 * Where keep-safe links point (SYC-3 plan, "How this fits the Neon move";
 * test 12). Always built from the fixed PUBLIC_APP_ORIGIN, never from the
 * request's Host header, so nobody can make a link point at a site of their
 * choosing, or at a replit.app address whose browser storage is empty.
 *
 * Unset, it's the testers' address. Production accepts only an https origin;
 * a local build may use http (the browser round trip with a fake mail endpoint).
 */
export const DEFAULT_PUBLIC_APP_ORIGIN = "https://apptest.catspotters.com";

export function publicAppOrigin(): string {
  const raw = (process.env["PUBLIC_APP_ORIGIN"] ?? "").trim();
  if (!raw) return DEFAULT_PUBLIC_APP_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return DEFAULT_PUBLIC_APP_ORIGIN;
  }
  const httpAllowed = process.env["NODE_ENV"] !== "production";
  if (url.protocol !== "https:" && !(httpAllowed && url.protocol === "http:")) {
    return DEFAULT_PUBLIC_APP_ORIGIN;
  }
  return url.origin;
}

export function restoreUrl(token: string): string {
  return `${publicAppOrigin()}/restore?t=${encodeURIComponent(token)}`;
}

export function confirmUrl(token: string): string {
  return `${publicAppOrigin()}/api/mail/confirm?t=${encodeURIComponent(token)}`;
}

export function forgetUrl(token: string): string {
  return `${publicAppOrigin()}/api/mail/forget?t=${encodeURIComponent(token)}`;
}
