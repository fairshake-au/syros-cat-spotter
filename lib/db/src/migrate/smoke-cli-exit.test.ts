import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// SYC-141. `db-ops -f command=smoke` made its requests and printed `ok` for
// each within seconds, then the process didn't exit for about 10 minutes.
// The root cause was simpler than an open socket: main() never called
// process.exit() on success, so the CLI just waited for Node's event loop to
// drain on its own — however long that happened to take against the real
// endpoint. (A keep-alive fetch/undici socket was the suspected culprit, but
// it did not reproduce here even with a server advertising a 20s Keep-Alive
// timeout: this Node/undici version unrefs it. Whatever specifically held
// the CI run's event loop open, forcing an explicit exit the moment the
// command settles removes the dependency on it.)
//
// This drives the real CLI as a subprocess (the in-process smoke() tests in
// smoke.test.ts can't see a process-exit bug) and asserts it exits quickly
// and cleanly on its own once its checks are done.

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

describe("smoke CLI process exit", () => {
  it("exits within ~5s once its checks are done, against a stub server", async () => {
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
