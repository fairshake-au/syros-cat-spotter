/**
 * SYC-170 PR 1.3: the website runs Cloudflare's script directly
 * (lib/turnstile.web.ts), so it has no WebView host.
 */
export function TurnstileHost() {
  return null;
}
