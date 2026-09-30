import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { smoke } from "./smoke";

// SYC-121, task B.5. A stub HTTP server that stands in for the pre-launch
// gate: 401 without X-Prelaunch-Key, 200 (with the smoke routes' expected
// shapes) with it.

let server: http.Server;
let baseUrl: string;
let seenHeaders: string[] = [];

function startStubGate(expectedKey: string): Promise<void> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      seenHeaders.push(req.headers["x-prelaunch-key"] as string | undefined ?? "");
      const key = req.headers["x-prelaunch-key"];
      if (key !== expectedKey) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "prelaunch_pass_required",
            message: "Cat Spotters isn't open yet.",
          }),
        );
        return;
      }
      if (req.url === "/api/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === "/api/cats") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([]));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

beforeEach(() => {
  seenHeaders = [];
});

afterEach(async () => {
  // A hanging-endpoint test leaves a connection open on purpose; close it
  // out from under the request so server.close()'s callback still fires.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("smoke through the pre-launch gate", () => {
  it("without PRELAUNCH_KEY, an unauthenticated request gets the gate's 401 and smoke fails", async () => {
    await startStubGate("tester-key-123");
    await expect(smoke(baseUrl, {})).rejects.toThrow(/returned 401/);
  });

  it("with PRELAUNCH_KEY set, every request carries X-Prelaunch-Key and smoke passes", async () => {
    await startStubGate("tester-key-123");
    await expect(
      smoke(baseUrl, { PRELAUNCH_KEY: "tester-key-123" }),
    ).resolves.toBeUndefined();
    expect(seenHeaders.every((h) => h === "tester-key-123")).toBe(true);
    expect(seenHeaders.length).toBeGreaterThanOrEqual(2); // healthz + cats
  });

  it("without PRELAUNCH_KEY, a gate that's off (no key required) still passes", async () => {
    await startStubGate(""); // "" never matches a real header value, so simulate "off" directly
    server.close();
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        if (req.url === "/api/healthz") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url === "/api/cats") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify([]));
          return;
        }
        res.writeHead(404);
        res.end();
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
    await expect(smoke(baseUrl, {})).resolves.toBeUndefined();
  });
});

describe("smoke against a hanging endpoint", () => {
  // SYC-141. Without a per-request timeout, an endpoint that never responds
  // hangs the whole smoke job (and, on the real cutover, the CI step running
  // it). SMOKE_TIMEOUT_MS lets the test use a short timeout instead of
  // waiting out the real 30s default.
  it("fails fast with a clear timeout message instead of hanging", async () => {
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        if (req.url === "/api/healthz") {
          // Never respond — simulates a stuck endpoint.
          return;
        }
        res.writeHead(404);
        res.end();
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
    await expect(
      smoke(baseUrl, { SMOKE_TIMEOUT_MS: "200" }),
    ).rejects.toThrow(/smoke: GET \/api\/healthz timed out after 0\.2 s\. Roll back now\./);
  }, 5000);

  // Fable review of PR #40: headers can arrive fine while the *body* stalls
  // — the fetch() call itself succeeds, so a try/catch around only fetch()
  // misses it. Without reading the body inside the same try/catch, this
  // used to print "ok  GET /api/cats 200" and then throw a raw, uncaught
  // DOMException instead of the "Roll back now" message.
  it("a body that stalls after headers times out with the message, and never logs ok for that path", async () => {
    const logs: string[] = [];
    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation((msg: string) => {
        logs.push(msg);
      });
    try {
      await new Promise<void>((resolve) => {
        server = http.createServer((req, res) => {
          if (req.url === "/api/healthz") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          if (req.url === "/api/cats") {
            // Headers sent, then the body stalls forever.
            res.writeHead(200, { "Content-Type": "application/json" });
            res.write('[{"pho');
            return;
          }
          res.writeHead(404);
          res.end();
        });
        server.listen(0, "127.0.0.1", () => {
          const { port } = server.address() as AddressInfo;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
      await expect(
        smoke(baseUrl, { SMOKE_TIMEOUT_MS: "200" }),
      ).rejects.toThrow(
        /smoke: GET \/api\/cats timed out after 0\.2 s\. Roll back now\./,
      );
      expect(logs.some((l) => l.includes("ok  GET /api/cats"))).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  }, 5000);
});

describe("SMOKE_TIMEOUT_MS validation", () => {
  // Fable review of PR #40, item 3. A typo in this env var must say plainly
  // what's wrong, not read as a broken endpoint ("timed out"/"Roll back
  // now") or silently do something unintended (0 meant "every request times
  // out instantly" before this validation existed). And it must be checked
  // before any request goes out — port 1 refuses the connection instantly,
  // so if these ever reached fetch() the test would still finish fast, but
  // it would fail with a connection error rather than this message.
  it.each(["abc", "1.5", "-5", "0"])(
    "SMOKE_TIMEOUT_MS=%s is refused up front, before any request",
    async (value) => {
      await expect(
        smoke("http://127.0.0.1:1", { SMOKE_TIMEOUT_MS: value }),
      ).rejects.toThrow(/SMOKE_TIMEOUT_MS must be a positive integer \(ms\)/);
    },
  );

  it("an unset or empty SMOKE_TIMEOUT_MS falls back to the default instead of being refused", async () => {
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        if (req.url === "/api/healthz" || req.url === "/api/cats") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(req.url === "/api/cats" ? "[]" : JSON.stringify({ ok: true }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
    await expect(
      smoke(baseUrl, { SMOKE_TIMEOUT_MS: "" }),
    ).resolves.toBeUndefined();
  });
});
