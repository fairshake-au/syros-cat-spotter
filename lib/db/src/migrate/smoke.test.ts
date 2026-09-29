import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { smoke } from "./cli";

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
