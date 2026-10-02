import { describe, expect, it, afterEach } from "vitest";
import pino from "pino";
import type { Request } from "express";
import { classifyIp, runProxyProbe, tokenMatches } from "./proxyProbe";

// SYC-100: unit tests for the proxy-hop diagnostic. The overriding rule
// across every test here: a raw IP address (dotted-quad or IPv6) must never
// appear in a logged line, even when the request carries one.
const DOTTED_QUAD = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
// A loose IPv6 shape: at least two groups of hex digits separated by "::" or
// multiple ":" — enough to catch a leaked address without false-triggering
// on ordinary log punctuation.
const IPV6_SHAPE = /\b[0-9a-f]{1,4}:(?:[0-9a-f]{0,4}:){1,6}[0-9a-f]{0,4}\b/i;

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
}): Request {
  const headers: Record<string, string> = {};
  if (opts.xff !== undefined) headers["x-forwarded-for"] = opts.xff;
  if (opts.probeHeader !== undefined) headers["x-proxy-probe"] = opts.probeHeader;
  return {
    ip: opts.ip,
    ips: opts.ips ?? [],
    headers,
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
});
