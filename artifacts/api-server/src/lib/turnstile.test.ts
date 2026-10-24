import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_TOKEN_LENGTH,
  acceptedHostnames,
  SITEVERIFY_URL,
  turnstileHealth,
  turnstileMode,
  verifyTurnstile,
} from "./turnstile";

// SYC-170 PR 1.1: lib/turnstile.ts on its own. Siteverify is faked at the
// fetch boundary. The route-level tests (T1-1 … T1-8) are in
// routes/reports.turnstile.test.ts.

const SECRET = "0x-test-secret-never-logged";
const TOKEN = "0.test-token-abcdefghijklmnopqrstuvwxyz";

type Call = { url: string; body: Record<string, unknown>; signal: unknown };
let calls: Call[] = [];

function fakeSiteverify(...replies: (() => Response | Promise<Response>)[]) {
  calls = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal });
      const reply = replies[Math.min(i, replies.length - 1)]!;
      i += 1;
      return reply();
    }),
  );
}

const json = (body: unknown, status = 200) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const good = (over: Record<string, unknown> = {}) =>
  json({ success: true, hostname: "apptest.catspotters.com", action: "welfare_report", cdata: "ref-1", "error-codes": [], ...over });
const timeout = () => {
  throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
};

const KEYS = ["TURNSTILE_SECRET_KEY", "TURNSTILE_HOSTNAMES", "TURNSTILE_MODE", "NODE_ENV", "PRELAUNCH_GATE"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
beforeEach(() => {
  process.env["TURNSTILE_SECRET_KEY"] = SECRET;
  delete process.env["TURNSTILE_HOSTNAMES"];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("verifyTurnstile", () => {
  it("ok when success, hostname, action and cdata all match; sends no remoteip", async () => {
    fakeSiteverify(good());
    const v = await verifyTurnstile(TOKEN, "welfare_report", "ref-1");
    expect(v.outcome).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(SITEVERIFY_URL);
    expect(Object.keys(calls[0]!.body).sort()).toEqual(["idempotency_key", "response", "secret"]);
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["wrong action", good({ action: "welfare_draft" })],
    ["wrong cdata", good({ cdata: "ref-2" })],
    ["team. hostname", good({ hostname: "team.catspotters.com" })],
    ["bare apex hostname", good({ hostname: "catspotters.com" })],
    ["success false", json({ success: false, "error-codes": ["invalid-input-response"] })],
    ["reused token", json({ success: false, "error-codes": ["timeout-or-duplicate"] })],
  ])("rejected: %s", async (_name, reply) => {
    fakeSiteverify(reply);
    expect((await verifyTurnstile(TOKEN, "welfare_report", "ref-1")).outcome).toBe("rejected");
  });

  it("rejects missing, malformed and over-long tokens without calling Cloudflare", async () => {
    fakeSiteverify(good());
    for (const t of [undefined, null, "", 42, "has space", "tab\there", "x".repeat(MAX_TOKEN_LENGTH + 1)]) {
      expect((await verifyTurnstile(t, "welfare_report", "ref-1")).outcome).toBe("rejected");
    }
    expect(calls).toHaveLength(0);
    // Exactly 2,048 characters is still sent.
    await verifyTurnstile("x".repeat(MAX_TOKEN_LENGTH), "welfare_report", "ref-1");
    expect(calls).toHaveLength(1);
  });

  it("the hostname list is exact and comes from TURNSTILE_HOSTNAMES", async () => {
    process.env["TURNSTILE_HOSTNAMES"] = "example.com, apptest.catspotters.com";
    fakeSiteverify(good({ hostname: "example.com" }));
    expect((await verifyTurnstile(TOKEN, "welfare_report", "ref-1")).outcome).toBe("ok");
    fakeSiteverify(good({ hostname: "sub.example.com" }));
    expect((await verifyTurnstile(TOKEN, "welfare_report", "ref-1")).outcome).toBe("rejected");
  });

  it("a timeout is retried once with the same idempotency key, then unreachable", async () => {
    fakeSiteverify(timeout);
    expect((await verifyTurnstile(TOKEN, "welfare_report", "ref-1")).outcome).toBe("unreachable");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body["idempotency_key"]).toBe(calls[1]!.body["idempotency_key"]);
  });

  it("a timeout then an answer is that answer", async () => {
    fakeSiteverify(timeout, good());
    expect((await verifyTurnstile(TOKEN, "welfare_report", "ref-1")).outcome).toBe("ok");
  });

  it.each([
    ["503", json({ error: "down" }, 503)],
    ["429 from Cloudflare", json({}, 429)],
    ["not JSON", () => new Response("<html>oops</html>", { status: 200 })],
  ])("unreachable: %s", async (_name, reply) => {
    fakeSiteverify(reply);
    expect((await verifyTurnstile(TOKEN, "welfare_report", "ref-1")).outcome).toBe("unreachable");
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["internal-error alone", ["internal-error"]],
    ["internal-error with the sender's own fault", ["invalid-input-response", "internal-error"]],
  ])("an answered success:false is rejected, never unreachable: %s (review finding 2)", async (_name, codes) => {
    fakeSiteverify(json({ success: false, "error-codes": codes }));
    expect((await verifyTurnstile(TOKEN, "welfare_report", "ref-1")).outcome).toBe("rejected");
    expect(calls).toHaveLength(1);
  });

  it.each(["invalid-input-secret", "missing-input-secret"])("not_configured: %s (our fault)", async (code) => {
    fakeSiteverify(json({ success: false, "error-codes": [code] }));
    expect((await verifyTurnstile(TOKEN, "welfare_report", "ref-1")).outcome).toBe("not_configured");
  });

  it("not_configured with no secret, without calling Cloudflare", async () => {
    delete process.env["TURNSTILE_SECRET_KEY"];
    fakeSiteverify(good());
    expect((await verifyTurnstile(TOKEN, "welfare_report", "ref-1")).outcome).toBe("not_configured");
    expect(calls).toHaveLength(0);
  });
});

describe("acceptedHostnames", () => {
  it("SYC-662: with TURNSTILE_HOSTNAMES unset, the built-in list is exactly the two production hosts", () => {
    expect(acceptedHostnames()).toEqual(["apptest.catspotters.com", "syros.catspotters.com"]);
  });

  it("the setting replaces the built-in list", () => {
    process.env["TURNSTILE_HOSTNAMES"] = " Example.com ";
    expect(acceptedHostnames()).toEqual(["example.com"]);
  });
});

describe("turnstileMode", () => {
  it("development and test: off unless set", () => {
    process.env["NODE_ENV"] = "test";
    delete process.env["TURNSTILE_MODE"];
    expect(turnstileMode()).toBe("off");
    process.env["TURNSTILE_MODE"] = "observe";
    expect(turnstileMode()).toBe("observe");
    process.env["TURNSTILE_MODE"] = "nonsense";
    expect(turnstileMode()).toBe("off");
  });

  it("production with the pre-launch gate on: observe by default, so published apps without a token aren't refused", () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["TURNSTILE_MODE"];
    delete process.env["PRELAUNCH_GATE"]; // unset means the gate is on
    expect(turnstileMode()).toBe("observe");
    process.env["PRELAUNCH_GATE"] = "on";
    expect(turnstileMode()).toBe("observe");
    for (const m of ["off", "observe", "enforce"]) {
      process.env["TURNSTILE_MODE"] = m;
      expect(turnstileMode()).toBe(m);
    }
    // A typo never turns enforcement on by accident.
    process.env["TURNSTILE_MODE"] = "Enforce";
    expect(turnstileMode()).toBe("observe");
    process.env["TURNSTILE_MODE"] = "nonsense";
    expect(turnstileMode()).toBe("observe");
  });

  it("production with the pre-launch gate off: always enforce, whatever TURNSTILE_MODE says", () => {
    process.env["NODE_ENV"] = "production";
    process.env["PRELAUNCH_GATE"] = "off";
    delete process.env["TURNSTILE_MODE"];
    expect(turnstileMode()).toBe("enforce");
    for (const m of ["off", "observe", "enforce", "nonsense"]) {
      process.env["TURNSTILE_MODE"] = m;
      expect(turnstileMode()).toBe("enforce");
    }
  });

  it("an unset NODE_ENV counts as production (gate on by default, so observe)", () => {
    delete process.env["NODE_ENV"];
    delete process.env["TURNSTILE_MODE"];
    delete process.env["PRELAUNCH_GATE"];
    expect(turnstileMode()).toBe("observe");
    process.env["PRELAUNCH_GATE"] = "off";
    expect(turnstileMode()).toBe("enforce");
  });

  it("health says not_configured when the secret is missing", () => {
    process.env["NODE_ENV"] = "test";
    process.env["TURNSTILE_MODE"] = "enforce";
    delete process.env["TURNSTILE_SECRET_KEY"];
    expect(turnstileHealth()).toEqual({ mode: "enforce", secret: "not_configured" });
  });
});
