import { timingSafeEqual, createHash, createHmac } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import type { Request } from "express";
import type { Logger } from "pino";

/**
 * SYC-100: a token-gated diagnostic to confirm, on the live deployment, how
 * many proxies sit in front of the API — so `app.set("trust proxy", 1)` in
 * app.ts can be checked against Replit's real chain.
 *
 * Privacy rule for this whole module: NEVER log a raw IP address, in any
 * form (dotted-quad, IPv6, or embedded in a header value) — and never log
 * an HMAC/hash of one either (a hash of a known value can still be brute
 * forced or correlated). Only counts, kinds and booleans leave this module.
 * See docs/DEPLOYMENT.md §C / docs/runbooks/proxy-probe.md for how this is
 * used.
 *
 * Confirmation probe (SYC-100 follow-up): the first live run showed
 * `ip_kind=public` on the address `trust proxy: 1` picks out, which turned
 * out to be a red herring — a Google front-end hop is also publicly
 * routable, so "public" alone never proves an address is the real visitor.
 * To actually name which position in the chain is the client, the caller
 * (the GitHub Actions workflow) learns its own public egress IP out of
 * band, sends `HMAC-SHA256(key=PROXY_PROBE_TOKEN, msg=ip)` as the
 * `X-Proxy-Probe-Expect` header, and this module hashes each candidate
 * address the same way and compares — so the IP itself never has to be
 * logged, only whether/where a hash matched.
 */

export type IpKind = "public" | "private" | "loopback" | "unknown";

/**
 * Classifies an address into the four buckets the probe log needs.
 * Covers: RFC1918 (10/8, 172.16/12, 192.168/16), CGNAT (100.64/10),
 * IPv4 link-local (169.254/16), IPv4 loopback (127/8), IPv6 loopback
 * (::1), IPv6 unique-local (fc00::/7) and IPv6 link-local (fe80::/10).
 * IPv4-mapped IPv6 addresses are unwrapped and classified by their IPv4
 * rules — in compact form (::ffff:a.b.c.d, or the rarer ::a.b.c.d), in the
 * fully expanded dotted-quad-tail form (0:0:0:0:0:ffff:a.b.c.d, no "::"),
 * and in the fully expanded all-hex form (0:0:0:0:0:ffff:0a0a:0a0a).
 * Anything else that parses as a valid IP is "public"; anything that
 * doesn't parse at all is "unknown".
 */
export function classifyIp(ip: string): IpKind {
  if (!ip) return "unknown";

  if (isIPv4(ip)) {
    return classifyIpv4(ip);
  }

  if (isIPv6(ip)) {
    const lower = ip.toLowerCase();

    if (lower === "::1") return "loopback";

    const mapped = unwrapIpv4Mapped(lower);
    if (mapped) return classifyIpv4(mapped);

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

/**
 * Unwraps an IPv4-mapped IPv6 address down to its dotted-quad IPv4 form, in
 * any of the three forms this module needs to recognise: the "::"-compact
 * form (::ffff:a.b.c.d / ::a.b.c.d), the fully expanded dotted-quad-tail
 * form (0:0:0:0:0:ffff:a.b.c.d, no "::"), and the fully expanded all-hex
 * form (0:0:0:0:0:ffff:0a0a:0a0a). Returns null for anything else — a
 * genuine (non-mapped) IPv6 address, or something that doesn't parse.
 * `ip` must already be lower-cased.
 */
function unwrapIpv4Mapped(ip: string): string | null {
  // "::"-compact or fully expanded dotted-quad-tail form.
  const mappedDotted = ip.match(/^(?:::(?:ffff:)?|(?:0:){5}ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return mappedDotted[1];

  // Fully expanded, all-hex form — the canonical ::ffff:0:0/96 prefix as
  // eight plain hextets. Unwrap the last two hextets back into octets.
  const hextets = expandIpv6(ip);
  if (hextets && hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
    const a = (hextets[6] >> 8) & 0xff;
    const b = hextets[6] & 0xff;
    const c = (hextets[7] >> 8) & 0xff;
    const d = hextets[7] & 0xff;
    return `${a}.${b}.${c}.${d}`;
  }

  return null;
}

/**
 * Normalises an address for hashing so the same physical IP hashes the same
 * way regardless of which notation it arrived in. The workflow hashes the
 * runner's own public egress IP as reported by ipify/ifconfig.me — always a
 * plain IPv4 dotted-quad, or an un-mapped IPv6 literal. `req.socket.
 * remoteAddress` for an IPv4 peer is frequently reported as an IPv4-mapped
 * IPv6 address (e.g. "::ffff:203.0.113.5") by Node, which would otherwise
 * never match that hash — so it's unwrapped here before hashing. XFF
 * entries are normally already plain, but are run through the same
 * normalisation for consistency (and in case a proxy writes one in mapped
 * form).
 */
export function normalizeIpForHash(ip: string): string {
  const trimmed = ip.trim();
  if (isIPv4(trimmed)) return trimmed;
  if (isIPv6(trimmed)) {
    const lower = trimmed.toLowerCase();
    return unwrapIpv4Mapped(lower) ?? lower;
  }
  return trimmed;
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

/** Hex-encoded HMAC-SHA256 of `message`, keyed by `key`. */
export function hmacHex(key: string, message: string): string {
  return createHmac("sha256", key).update(message).digest("hex");
}

/**
 * Constant-time comparison of two hex strings, tolerant of them being
 * different lengths (an attacker-controlled header could be anything).
 * Hashes both sides first, same trick as `tokenMatches`, so the actual
 * `timingSafeEqual` call always runs on equal-length buffers and a length
 * mismatch never short-circuits it.
 */
function constantTimeHexEquals(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export interface ClientPosition {
  /** Whether any entry in the chain hashed to the expected value. */
  client_found: boolean;
  /**
   * The number of hops Express's numeric `trust proxy` setting would need
   * to trust for `req.ip` to land on the matched entry, given this exact
   * X-Forwarded-For list and socket address — i.e. the value to put in
   * `app.set("trust proxy", <this>)`. `null` when `client_found` is false.
   *
   * Derived from how `proxy-addr` (which Express's numeric `trust proxy`
   * delegates to) walks the chain: with trust = 1 it picks `xffEntries`'s
   * last entry, with trust = 2 the second-to-last, and so on; with trust =
   * 0 it falls back to the socket address itself. Equivalently: counting
   * from the right over `[...xffEntries, socketAddr]`, with the socket
   * itself at distance 0, the matched entry's distance from the right IS
   * the trust-proxy count that selects it.
   */
  client_pos_from_right: number | null;
}

/**
 * Hashes every candidate address in the chain — each X-Forwarded-For entry,
 * then the socket address — and reports which one (if any) matches
 * `expectedHashHex`, as the trust-proxy hop count that would select it.
 * Never returns or logs an address or a hash, only the position.
 */
export function findClientPosition(
  xffEntries: string[],
  socketAddr: string,
  expectedHashHex: string,
  key: string,
): ClientPosition {
  const chain = [...xffEntries, socketAddr];

  for (let idx = 0; idx < chain.length; idx++) {
    const candidateHash = hmacHex(key, normalizeIpForHash(chain[idx]!));
    if (constantTimeHexEquals(candidateHash, expectedHashHex)) {
      return { client_found: true, client_pos_from_right: chain.length - 1 - idx };
    }
  }

  return { client_found: false, client_pos_from_right: null };
}

/**
 * Fires only when PROXY_PROBE_TOKEN is set in the environment AND the
 * request carries a matching X-Proxy-Probe header. With no env var set,
 * this is a no-op on every call (no env read happens per-request beyond
 * the single lookup, and no header is ever inspected further).
 *
 * Logs exactly one structured line, with no raw IP and no hash in it:
 *   proxy-probe: ip_kind=<public|private|loopback|unknown>
 *     ip_matches_xff_first=<bool> ip_matches_xff_last=<bool> xff_hops=<n>
 *     client_found=<bool> client_pos_from_right=<n|null>
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
 *
 * `client_found` / `client_pos_from_right` (SYC-100 follow-up): `ip_kind`
 * alone can't prove an address is the real visitor — a public-looking
 * address is just as likely to be a public-facing load-balancer hop. When
 * the caller also sends `X-Proxy-Probe-Expect` (an HMAC-SHA256 of its own
 * known public IP, keyed by the same token), every candidate address in
 * `[...xffEntries, req.socket.remoteAddress]` is hashed the same way and
 * compared; `client_pos_from_right` is the matched entry's distance from
 * the right of that chain, which is exactly the `trust proxy` hop count
 * that would select it. Without that header, both fields are `false`/
 * `null` — the existing fields are unaffected either way.
 */
export function runProxyProbe(req: Request, logger: Logger): void {
  const expected = process.env.PROXY_PROBE_TOKEN;
  if (!expected) return;

  const provided = req.headers["x-proxy-probe"];
  const providedValue = Array.isArray(provided) ? provided[0] : provided;
  if (!tokenMatches(providedValue, expected)) return;

  const ip = req.ip ?? "";
  const xffEntries = parseXffEntries(req);

  const expectRaw = req.headers["x-proxy-probe-expect"];
  const expectedHashHex = Array.isArray(expectRaw) ? expectRaw[0] : expectRaw;

  let position: ClientPosition = { client_found: false, client_pos_from_right: null };
  if (expectedHashHex) {
    const socketAddr = req.socket?.remoteAddress ?? "";
    position = findClientPosition(xffEntries, socketAddr, expectedHashHex, expected);
  }

  logger.info(
    {
      ip_kind: classifyIp(ip),
      ip_matches_xff_first: xffEntries.length > 0 && xffEntries[0] === ip,
      ip_matches_xff_last: xffEntries.length > 0 && xffEntries[xffEntries.length - 1] === ip,
      xff_hops: xffEntries.length,
      client_found: position.client_found,
      client_pos_from_right: position.client_pos_from_right,
    },
    "proxy-probe",
  );
}
