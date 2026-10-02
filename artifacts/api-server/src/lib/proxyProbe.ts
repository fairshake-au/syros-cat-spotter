import { timingSafeEqual, createHash } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import type { Request } from "express";
import type { Logger } from "pino";

/**
 * SYC-100: a token-gated diagnostic to confirm, on the live deployment, how
 * many proxies sit in front of the API — so `app.set("trust proxy", 1)` in
 * app.ts can be checked against Replit's real chain.
 *
 * Privacy rule for this whole module: NEVER log a raw IP address, in any
 * form (dotted-quad, IPv6, or embedded in a header value). Only counts,
 * kinds and booleans leave this module. See docs/DEPLOYMENT.md §C /
 * docs/runbooks/proxy-probe.md for how this is used.
 */

export type IpKind = "public" | "private" | "loopback" | "unknown";

/**
 * Classifies an address into the four buckets the probe log needs.
 * Covers: RFC1918 (10/8, 172.16/12, 192.168/16), CGNAT (100.64/10),
 * IPv4 link-local (169.254/16), IPv4 loopback (127/8), IPv6 loopback
 * (::1), IPv6 unique-local (fc00::/7) and IPv6 link-local (fe80::/10).
 * IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are unwrapped and classified
 * by their IPv4 rules. Anything else that parses as a valid IP is "public";
 * anything that doesn't parse at all is "unknown".
 */
export function classifyIp(ip: string): IpKind {
  if (!ip) return "unknown";

  if (isIPv4(ip)) {
    return classifyIpv4(ip);
  }

  if (isIPv6(ip)) {
    const lower = ip.toLowerCase();

    if (lower === "::1") return "loopback";

    // IPv4-mapped IPv6: ::ffff:a.b.c.d (or the rarer ::a.b.c.d form).
    const mapped = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      return classifyIpv4(mapped[1]);
    }

    const hextets = expandIpv6(lower);
    if (!hextets) return "unknown";

    // fc00::/7 covers the two top bits "1111 110", i.e. the first hextet's
    // top 7 bits are 0b1111110x -> first hextet in [0xfc00, 0xfdff].
    const first = hextets[0];
    if (first >= 0xfc00 && first <= 0xfdff) return "private";

    // fe80::/10 link-local -> grouped with "private" per the probe spec.
    if (first >= 0xfe80 && first <= 0xfebf) return "private";

    return "public";
  }

  return "unknown";
}

function classifyIpv4(ip: string): IpKind {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return "unknown";
  const [a, b] = parts;

  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private"; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return "private"; // link-local

  return "public";
}

/** Expands a (possibly "::"-abbreviated) IPv6 string into 8 16-bit groups. */
function expandIpv6(ip: string): number[] | null {
  const parts = ip.split("::");
  if (parts.length > 2) return null;

  const parseGroups = (s: string): number[] =>
    s === "" ? [] : s.split(":").map((g) => parseInt(g, 16));

  let head = parseGroups(parts[0] ?? "");
  let tail = parts.length === 2 ? parseGroups(parts[1] ?? "") : [];

  if (parts.length === 1) {
    if (head.length !== 8 || head.some((g) => Number.isNaN(g))) return null;
    return head;
  }

  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array(missing).fill(0), ...tail];
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;
  return groups;
}

/**
 * Constant-time comparison of the request's probe header against the
 * configured secret. Hashes both sides first so the comparison itself
 * (timingSafeEqual) always runs on equal-length buffers regardless of the
 * provided value's length — a mismatched length never short-circuits.
 */
export function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

/**
 * Parses the X-Forwarded-For header into its comma-separated entries
 * (trimmed), left to right as the header carries them. Returns [] when the
 * header is absent.
 */
function parseXffEntries(req: Request): string[] {
  const raw = req.headers["x-forwarded-for"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) return [];
  return header
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Fires only when PROXY_PROBE_TOKEN is set in the environment AND the
 * request carries a matching X-Proxy-Probe header. With no env var set,
 * this is a no-op on every call (no env read happens per-request beyond
 * the single lookup, and no header is ever inspected further).
 *
 * Logs exactly one structured line, with no raw IP in it:
 *   proxy-probe: ip_kind=<public|private|loopback|unknown>
 *     ip_matches_xff_first=<bool> ip_matches_xff_last=<bool> xff_hops=<n>
 *
 * There is no "number of trusted hops" field: `req.ips` is not it. Under a
 * numeric `trust proxy` setting, proxy-addr's scan stops at the first
 * untrusted address, so `req.ips.length` is structurally capped at 0 (no
 * X-Forwarded-For) or 1 (any X-Forwarded-For) regardless of how many real
 * proxy hops exist upstream — it reads the same whether there's truly 1 hop
 * or 3 still-under-trusted hops, so it can't diagnose "too few hops" and
 * was dropped rather than published as a misleading count. `xff_hops` (the
 * raw X-Forwarded-For entry count) is the field that actually reflects the
 * real chain length, for exactly that reason.
 */
export function runProxyProbe(req: Request, logger: Logger): void {
  const expected = process.env.PROXY_PROBE_TOKEN;
  if (!expected) return;

  const provided = req.headers["x-proxy-probe"];
  const providedValue = Array.isArray(provided) ? provided[0] : provided;
  if (!tokenMatches(providedValue, expected)) return;

  const ip = req.ip ?? "";
  const xffEntries = parseXffEntries(req);

  logger.info(
    {
      ip_kind: classifyIp(ip),
      ip_matches_xff_first: xffEntries.length > 0 && xffEntries[0] === ip,
      ip_matches_xff_last: xffEntries.length > 0 && xffEntries[xffEntries.length - 1] === ip,
      xff_hops: xffEntries.length,
    },
    "proxy-probe",
  );
}
