import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// SYC-141. `db-ops -f command=smoke` made its requests and printed `ok` for
// each within seconds, then the process didn't exit for about 10 minutes.
// cli.ts now calls process.exit(0) explicitly after main() resolves, instead
// of letting the event loop drain on its own.
//
// Honesty note (Fable review of PR #40, item 4): THIS TEST IS A REGRESSION
// FENCE, NOT PROOF THE FIX WORKS. It asserts the CLI runs its checks, prints
// the `ok` lines, and exits promptly against a local stub server — real,
// useful things to keep true — but a mutation test that deletes the
// `process.exit(0)` call still leaves this test green here: against a local
// stub, this Node/undici version's event loop already drains on its own in
// well under 5s, with or without the explicit exit. The original ~10-minute
// hang was never reproduced locally (see the PR body), so nothing run
// locally can prove it's gone. That proof is a timed `db-ops
// command=smoke` run on GitHub Actions after this merges — watch that its
// "Run" step finishes in roughly the time the requests themselves take, not
// ~10 minutes longer.
//
// This drives the real CLI as a subprocess (the in-process smoke() tests in
// smoke.test.ts can't see a process-exit bug at all) and asserts it runs its
// checks and exits promptly and cleanly on its own.

const tsxBin = path.resolve(import.meta.dirname, "../../node_modules/.bin/tsx");
const cliPath = path.resolve(import.meta.dirname, "./cli.ts");

let server: http.Server;

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function startStubApi(): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url === "/api/healthz" || req.url === "/api/cats") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(req.url === "/api/cats" ? "[]" : JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    // Advertise a keep-alive timeout well past this test's 5s exit bar, so
    // if this Node/undici version ever does start holding a pooled socket
    // open on a long-lived server-advertised timeout again, this test is
    // positioned to catch it rather than the socket happening to close on
    // its own before the assertion runs.
    server.keepAliveTimeout = 20_000;
    server.headersTimeout = 21_000;
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("smoke CLI regression fence (not proof the CI hang is fixed — see header comment)", () => {
  it("runs its checks, prints the ok lines, and exits within ~5s against a stub server", async () => {
    const baseUrl = await startStubApi();
    const start = Date.now();
    const child = spawn(tsxBin, [cliPath, "smoke", baseUrl], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    const exitCode = await new Promise<number>((resolve, reject) => {
      // A generous safety net well above the ~5s we're asserting — if this
      // fires, the CLI reproduced the SYC-141 hang and the test should fail
      // with a clear message rather than block the suite for 10 minutes.
      const safetyNet = setTimeout(() => {
        child.kill("SIGKILL");
        reject(
          new Error(
            `smoke CLI did not exit within 8s (SYC-141 regression). stdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
      }, 8000);
      child.on("exit", (code) => {
        clearTimeout(safetyNet);
        resolve(code ?? -1);
      });
    });
    const elapsedMs = Date.now() - start;

    expect(stdout).toContain("ok  GET /api/healthz 200");
    expect(exitCode).toBe(0);
    expect(elapsedMs).toBeLessThan(5000);
  }, 10000);
});
