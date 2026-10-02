import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// SYC-100: integration coverage for the proxy-hop diagnostic mounted on the
// open /api/healthz route (prelaunchGate.test.ts uses the same "mock the
// logger module, capture the raw lines" approach for exactly this reason —
// the real pino-http request logger is what req.log resolves to here).
const spies = { logLines: [] as string[] };

vi.mock("../lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/logger")>();
  const { default: pino } = await import("pino");
  const logger = pino(
    { level: "trace", redact: actual.REDACT_PATHS },
    { write: (line: string) => void spies.logLines.push(line) },
  );
  return { ...actual, logger };
});

import app from "../app";

const DOTTED_QUAD = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
const IPV6_SHAPE = /\b[0-9a-f]{1,4}:(?:[0-9a-f]{0,4}:){1,6}[0-9a-f]{0,4}\b/i;

function proxyProbeLines(): Record<string, unknown>[] {
  return spies.logLines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.msg === "proxy-probe");
}

describe("GET /api/healthz proxy probe (SYC-100)", () => {
  const ORIGINAL_ENV = process.env.PROXY_PROBE_TOKEN;

  afterEach(() => {
    spies.logLines.length = 0;
    if (ORIGINAL_ENV === undefined) delete process.env.PROXY_PROBE_TOKEN;
    else process.env.PROXY_PROBE_TOKEN = ORIGINAL_ENV;
  });

  it("still answers healthz normally and logs nothing extra when the env var is unset", async () => {
    delete process.env.PROXY_PROBE_TOKEN;
    const res = await request(app)
      .get("/api/healthz")
      .set("X-Forwarded-For", "203.0.113.77")
      .set("X-Proxy-Probe", "anything-at-all")
      .expect(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(proxyProbeLines()).toHaveLength(0);
  });

  it("logs nothing when the probe header carries the wrong token", async () => {
    process.env.PROXY_PROBE_TOKEN = "the-real-token";
    await request(app)
      .get("/api/healthz")
      .set("X-Forwarded-For", "203.0.113.77")
      .set("X-Proxy-Probe", "not-the-real-token")
      .expect(200);
    expect(proxyProbeLines()).toHaveLength(0);
  });

  it("logs one proxy-probe line with the right token, with no raw IP anywhere in the output", async () => {
    process.env.PROXY_PROBE_TOKEN = "the-real-token";
    await request(app)
      .get("/api/healthz")
      .set("X-Forwarded-For", "198.51.100.9")
      .set("X-Proxy-Probe", "the-real-token")
      .expect(200);

    const lines = proxyProbeLines();
    expect(lines).toHaveLength(1);
    const entry = lines[0]!;
    expect(typeof entry.ips).toBe("number");
    expect(["public", "private", "loopback", "unknown"]).toContain(entry.ip_kind);
    expect(typeof entry.ip_matches_xff_first).toBe("boolean");
    expect(typeof entry.ip_matches_xff_last).toBe("boolean");
    expect(typeof entry.xff_hops).toBe("number");

    for (const line of spies.logLines) {
      expect(line).not.toMatch(DOTTED_QUAD);
      expect(line).not.toMatch(IPV6_SHAPE);
    }
  });
});
