import { describe, expect, it, afterEach } from "vitest";
import pino from "pino";
import type { Request } from "express";
import {
  classifyIp,
  findClientPosition,
  hmacHex,
  MAX_XFF_ENTRIES,
  normalizeIpForHash,
  runProxyProbe,
  tokenMatches,
} from "./proxyProbe";

// SYC-100: unit tests for the proxy-hop diagnostic. The overriding rule
// across every test here: a raw IP address (dotted-quad or IPv6) must never
// appear in a logged line, even when the request carries one — and (SYC-100
// follow-up) neither must a hash of one: any 64-hex-char string is treated
// as a potential leaked HMAC/SHA256 digest and banned from log output too.
const DOTTED_QUAD = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
// A loose IPv6 shape: at least two groups of hex digits separated by "::" or
// multiple ":" — enough to catch a leaked address without false-triggering
// on ordinary log punctuation.
const IPV6_SHAPE = /\b[0-9a-f]{1,4}:(?:[0-9a-f]{0,4}:){1,6}[0-9a-f]{0,4}\b/i;
// A bare 64-character hex string — the shape of a SHA-256/HMAC-SHA256 hex
// digest, which is exactly what must never appear in a log line.
const HEX_64 = /\b[0-9a-f]{64}\b/i;

function capturingLogger() {
  const lines: string[] = [];
  const logger = pino(
    { level: "trace" },
    { write: (line: string) => void lines.push(line) },
  );
  return { logger, lines };
}

function fakeReq(opts: {
  ip?: string;
  ips?: string[];
  xff?: string;
  probeHeader?: string;
  expectHeader?: string;
  socketRemoteAddress?: string;
}): Request {
  const headers: Record<string, string> = {};
  if (opts.xff !== undefined) headers["x-forwarded-for"] = opts.xff;
  if (opts.probeHeader !== undefined) headers["x-proxy-probe"] = opts.probeHeader;
  if (opts.expectHeader !== undefined) headers["x-proxy-probe-expect"] = opts.expectHeader;
  return {
    ip: opts.ip,
    ips: opts.ips ?? [],
    headers,
    socket: { remoteAddress: opts.socketRemoteAddress },
  } as unknown as Request;
}

describe("classifyIp", () => {
  it("classifies RFC1918 private ranges", () => {
    expect(classifyIp("10.0.0.5")).toBe("private");
    expect(classifyIp("172.16.0.1")).toBe("private");
    expect(classifyIp("172.31.255.255")).toBe("private");
    expect(classifyIp("192.168.1.1")).toBe("private");
  });

  it("classifies CGNAT 100.64.0.0/10 as private", () => {
    expect(classifyIp("100.64.0.1")).toBe("private");
    expect(classifyIp("100.100.0.1")).toBe("private");
    expect(classifyIp("100.127.255.255")).toBe("private");
    // Just outside the /10 on each side.
    expect(classifyIp("100.63.255.255")).toBe("public");
    expect(classifyIp("100.128.0.0")).toBe("public");
  });

  it("classifies IPv4 link-local as private", () => {
    expect(classifyIp("169.254.1.1")).toBe("private");
  });

  it("classifies loopback", () => {
    expect(classifyIp("127.0.0.1")).toBe("loopback");
    expect(classifyIp("::1")).toBe("loopback");
  });

  it("classifies IPv6 unique-local fc00::/7 as private", () => {
    expect(classifyIp("fc00::1")).toBe("private");
    expect(classifyIp("fd12:3456:789a::1")).toBe("private");
  });

  it("classifies IPv6 link-local fe80::/10 as private", () => {
    expect(classifyIp("fe80::1")).toBe("private");
  });

  it("classifies IPv4-mapped IPv6 by the IPv4 rules", () => {
    expect(classifyIp("::ffff:10.0.0.1")).toBe("private");
    expect(classifyIp("::ffff:203.0.113.1")).toBe("public");
    expect(classifyIp("::ffff:127.0.0.1")).toBe("loopback");
  });

  it("classifies the fully expanded IPv4-mapped form with a dotted-quad tail", () => {
    // No "::" compression at all — written out as 0:0:0:0:0:ffff: + dotted quad.
    expect(classifyIp("0:0:0:0:0:ffff:10.10.10.10")).toBe("private");
    expect(classifyIp("0:0:0:0:0:ffff:203.0.113.1")).toBe("public");
    expect(classifyIp("0:0:0:0:0:ffff:127.0.0.1")).toBe("loopback");
  });

  it("classifies the fully expanded IPv4-mapped form written entirely in hex", () => {
    // 0x0a0a:0x0a0a == 10.10.10.10; 0xcb00:7101 == 203.0.113.1.
    expect(classifyIp("0:0:0:0:0:ffff:a0a:a0a")).toBe("private");
    expect(classifyIp("0:0:0:0:0:ffff:cb00:7101")).toBe("public");
  });

  it("classifies an ordinary public address as public", () => {
    expect(classifyIp("203.0.113.77")).toBe("public");
    expect(classifyIp("2001:db8::1")).toBe("public");
  });

  it("classifies garbage as unknown", () => {
    expect(classifyIp("")).toBe("unknown");
    expect(classifyIp("not-an-ip")).toBe("unknown");
  });
});

describe("tokenMatches", () => {
  it("matches the exact token", () => {
    expect(tokenMatches("secret-value", "secret-value")).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(tokenMatches("wrong", "secret-value")).toBe(false);
  });

  it("rejects a token of a different length without throwing", () => {
    expect(tokenMatches("short", "a-much-longer-secret-value")).toBe(false);
  });

  it("rejects an undefined provided value", () => {
    expect(tokenMatches(undefined, "secret-value")).toBe(false);
  });
});

describe("runProxyProbe", () => {
  const ORIGINAL_ENV = process.env.PROXY_PROBE_TOKEN;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.PROXY_PROBE_TOKEN;
    else process.env.PROXY_PROBE_TOKEN = ORIGINAL_ENV;
  });

  it("is a no-op when PROXY_PROBE_TOKEN is unset, even with a probe header", () => {
    delete process.env.PROXY_PROBE_TOKEN;
    const { logger, lines } = capturingLogger();
    const req = fakeReq({ ip: "203.0.113.77", probeHeader: "anything" });
    runProxyProbe(req, logger);
    expect(lines).toHaveLength(0);
  });

  it("is a no-op when the probe header doesn't match the token", () => {
    process.env.PROXY_PROBE_TOKEN = "correct-token";
    const { logger, lines } = capturingLogger();
    const req = fakeReq({ ip: "203.0.113.77", probeHeader: "wrong-token" });
    runProxyProbe(req, logger);
    expect(lines).toHaveLength(0);
  });

  it("is a no-op when the request carries no probe header at all", () => {
    process.env.PROXY_PROBE_TOKEN = "correct-token";
    const { logger, lines } = capturingLogger();
    const req = fakeReq({ ip: "203.0.113.77" });
    runProxyProbe(req, logger);
    expect(lines).toHaveLength(0);
  });

  it("logs exactly one structured line with the right token, and never a raw IP", () => {
    process.env.PROXY_PROBE_TOKEN = "correct-token";
    const { logger, lines } = capturingLogger();
    const req = fakeReq({
      ip: "203.0.113.77",
      ips: ["203.0.113.77", "10.0.0.5"],
      xff: "198.51.100.9, 203.0.113.77",
      probeHeader: "correct-token",
    });
    runProxyProbe(req, logger);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.msg).toBe("proxy-probe");
    expect(parsed.ip_kind).toBe("public");
    expect(parsed.ip_matches_xff_first).toBe(false);
    expect(parsed.ip_matches_xff_last).toBe(true);
    expect(parsed.xff_hops).toBe(2);
    // No "ips"/hop-count field — req.ips.length is capped at 0/1 under a
    // numeric trust proxy setting and can't reveal the real hop count.
    expect(parsed.ips).toBeUndefined();

    const serialised = lines[0]!;
    expect(serialised).not.toMatch(DOTTED_QUAD);
    expect(serialised).not.toMatch(IPV6_SHAPE);
  });

  it("never emits a raw IP even when the client IP is IPv6", () => {
    process.env.PROXY_PROBE_TOKEN = "correct-token";
    const { logger, lines } = capturingLogger();
    const req = fakeReq({
      ip: "2001:db8::1",
      ips: ["2001:db8::1"],
      xff: "2001:db8::1",
      probeHeader: "correct-token",
    });
    runProxyProbe(req, logger);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(IPV6_SHAPE);
    expect(lines[0]).not.toMatch(DOTTED_QUAD);
  });

  it("is inert without the token even when X-Proxy-Probe-Expect is present", () => {
    process.env.PROXY_PROBE_TOKEN = "correct-token";
    const { logger, lines } = capturingLogger();
    const req = fakeReq({
      ip: "203.0.113.77",
      xff: "203.0.113.77",
      socketRemoteAddress: "203.0.113.200",
      expectHeader: hmacHex("correct-token", "203.0.113.77"),
      // No probeHeader at all.
    });
    runProxyProbe(req, logger);
    expect(lines).toHaveLength(0);
  });

  it("reports client_found and client_pos_from_right when the expect header matches an XFF entry", () => {
    process.env.PROXY_PROBE_TOKEN = "correct-token";
    const { logger, lines } = capturingLogger();
    // 4-entry XFF chain, client leftmost (position 4 from the right, over
    // [xff..., socket]) — the shape SYC-100's live run actually saw.
    const req = fakeReq({
      ip: "198.51.100.9",
      xff: "203.0.113.77, 10.0.0.1, 10.0.0.2, 198.51.100.9",
      socketRemoteAddress: "10.0.0.3",
      probeHeader: "correct-token",
      expectHeader: hmacHex("correct-token", "203.0.113.77"),
    });
    runProxyProbe(req, logger);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.client_found).toBe(true);
    expect(parsed.client_pos_from_right).toBe(4);
  });

  it("reports client_found=false and client_pos_from_right=null when nothing matches", () => {
    process.env.PROXY_PROBE_TOKEN = "correct-token";
    const { logger, lines } = capturingLogger();
    const req = fakeReq({
      ip: "198.51.100.9",
      xff: "203.0.113.77, 198.51.100.9",
      socketRemoteAddress: "10.0.0.3",
      probeHeader: "correct-token",
      expectHeader: hmacHex("correct-token", "198.51.100.254"), // matches nothing
    });
    runProxyProbe(req, logger);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.client_found).toBe(false);
    expect(parsed.client_pos_from_right).toBeNull();
  });

  it("defaults client_found=false, client_pos_from_right=null when no expect header is sent", () => {
    process.env.PROXY_PROBE_TOKEN = "correct-token";
    const { logger, lines } = capturingLogger();
    const req = fakeReq({
      ip: "203.0.113.77",
      xff: "203.0.113.77",
      socketRemoteAddress: "10.0.0.3",
      probeHeader: "correct-token",
      // No expectHeader at all.
    });
    runProxyProbe(req, logger);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.client_found).toBe(false);
    expect(parsed.client_pos_from_right).toBeNull();
  });

  it(`caps xff_hops at ${MAX_XFF_ENTRIES} even when the header carries far more entries`, () => {
    process.env.PROXY_PROBE_TOKEN = "correct-token";
    const { logger, lines } = capturingLogger();
    const entries = Array.from({ length: MAX_XFF_ENTRIES + 30 }, (_, i) => `10.0.${i}.1`);
    const req = fakeReq({
      ip: "198.51.100.9",
      xff: entries.join(", "),
      socketRemoteAddress: "10.0.0.254",
      probeHeader: "correct-token",
    });
    runProxyProbe(req, logger);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.xff_hops).toBe(MAX_XFF_ENTRIES);
  });

  it("still finds the client within the capped (rightmost) XFF entries", () => {
    process.env.PROXY_PROBE_TOKEN = "correct-token";
    const { logger, lines } = capturingLogger();
    // A huge header with the real client near the right-hand (server) end,
    // well inside the cap, and a wall of junk padding it out on the left.
    const padding = Array.from({ length: MAX_XFF_ENTRIES + 50 }, (_, i) => `10.0.${i}.1`);
    const entries = [...padding, "203.0.113.77", "10.0.0.1"];
    const req = fakeReq({
      ip: "198.51.100.9",
      xff: entries.join(", "),
      socketRemoteAddress: "10.0.0.254",
      probeHeader: "correct-token",
      expectHeader: hmacHex("correct-token", "203.0.113.77"),
    });
    runProxyProbe(req, logger);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.xff_hops).toBe(MAX_XFF_ENTRIES);
    expect(parsed.client_found).toBe(true);
  });

  it("never logs a raw IP or a 64-hex-char hash, even with an expect header and a match", () => {
    process.env.PROXY_PROBE_TOKEN = "correct-token";
    const { logger, lines } = capturingLogger();
    const req = fakeReq({
      ip: "198.51.100.9",
      xff: "203.0.113.77, 10.0.0.1, 198.51.100.9",
      socketRemoteAddress: "2001:db8::1",
      probeHeader: "correct-token",
      expectHeader: hmacHex("correct-token", "203.0.113.77"),
    });
    runProxyProbe(req, logger);
    const serialised = lines[0]!;
    expect(serialised).not.toMatch(DOTTED_QUAD);
    expect(serialised).not.toMatch(IPV6_SHAPE);
    expect(serialised).not.toMatch(HEX_64);
  });
});

describe("normalizeIpForHash", () => {
  it("leaves a plain IPv4 address unchanged", () => {
    expect(normalizeIpForHash("203.0.113.77")).toBe("203.0.113.77");
  });

  it("unwraps an IPv4-mapped IPv6 socket address to the plain dotted quad", () => {
    expect(normalizeIpForHash("::ffff:203.0.113.77")).toBe("203.0.113.77");
    expect(normalizeIpForHash("0:0:0:0:0:ffff:203.0.113.77")).toBe("203.0.113.77");
    expect(normalizeIpForHash("0:0:0:0:0:ffff:cb00:7101")).toBe("203.0.113.1");
  });

  it("lower-cases a genuine (non-mapped) IPv6 address", () => {
    expect(normalizeIpForHash("2001:DB8::1")).toBe("2001:db8::1");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeIpForHash("  203.0.113.77  ")).toBe("203.0.113.77");
  });
});

describe("findClientPosition", () => {
  const KEY = "probe-key";

  it("finds the client at the last XFF entry (trust proxy 1 equivalent)", () => {
    const expected = hmacHex(KEY, "203.0.113.77");
    const result = findClientPosition(["10.0.0.1", "203.0.113.77"], "10.0.0.2", expected, KEY);
    expect(result).toEqual({ client_found: true, client_pos_from_right: 1 });
  });

  it("finds the client at the leftmost of 4 XFF entries (trust proxy 4 equivalent)", () => {
    const expected = hmacHex(KEY, "203.0.113.77");
    const result = findClientPosition(
      ["203.0.113.77", "10.0.0.1", "10.0.0.2", "10.0.0.3"],
      "10.0.0.4",
      expected,
      KEY,
    );
    expect(result).toEqual({ client_found: true, client_pos_from_right: 4 });
  });

  it("finds the client at the socket address itself (trust proxy 0 equivalent, no XFF)", () => {
    const expected = hmacHex(KEY, "203.0.113.77");
    const result = findClientPosition([], "203.0.113.77", expected, KEY);
    expect(result).toEqual({ client_found: true, client_pos_from_right: 0 });
  });

  it("reports not found when nothing in the chain matches", () => {
    const expected = hmacHex(KEY, "203.0.113.254");
    const result = findClientPosition(["10.0.0.1", "203.0.113.77"], "10.0.0.2", expected, KEY);
    expect(result).toEqual({ client_found: false, client_pos_from_right: null });
  });

  it("is unaffected by a spoofed extra XFF entry prepended ahead of the real client", () => {
    const expected = hmacHex(KEY, "203.0.113.77");
    // No spoof: the real proxies record the runner's real IP as xff[0].
    const withoutSpoof = findClientPosition(
      ["203.0.113.77", "10.0.0.1", "10.0.0.2"],
      "10.0.0.3",
      expected,
      KEY,
    );
    // Spoofed: a client-supplied X-Forwarded-For becomes the new xff[0],
    // and the first genuine proxy records the runner's real IP one entry
    // later (xff[1]) rather than overwriting it. Distance from the right —
    // where the trusted end of the chain is — is unchanged either way,
    // which is exactly the property the spoofed probe run is there to
    // confirm: trust_proxy's answer shouldn't move just because a client
    // appended more junk on its own end of the header.
    const withSpoof = findClientPosition(
      ["203.0.113.254", "203.0.113.77", "10.0.0.1", "10.0.0.2"],
      "10.0.0.3",
      expected,
      KEY,
    );
    expect(withSpoof.client_pos_from_right).toBe(withoutSpoof.client_pos_from_right);
    expect(withSpoof).toEqual({ client_found: true, client_pos_from_right: 3 });
  });

  it("matches an IPv4-mapped IPv6 socket address against a plain-IPv4 expected hash", () => {
    const expected = hmacHex(KEY, "203.0.113.77");
    const result = findClientPosition([], "::ffff:203.0.113.77", expected, KEY);
    expect(result).toEqual({ client_found: true, client_pos_from_right: 0 });
  });

  it("matches an IPv4-mapped IPv6 XFF entry against a plain-IPv4 expected hash", () => {
    const expected = hmacHex(KEY, "203.0.113.77");
    const result = findClientPosition(["::ffff:203.0.113.77"], "10.0.0.1", expected, KEY);
    expect(result).toEqual({ client_found: true, client_pos_from_right: 1 });
  });

  it("never matches with the wrong key, even for the same IP", () => {
    const expected = hmacHex(KEY, "203.0.113.77");
    const result = findClientPosition([], "203.0.113.77", expected, "a-different-key");
    expect(result).toEqual({ client_found: false, client_pos_from_right: null });
  });
});
