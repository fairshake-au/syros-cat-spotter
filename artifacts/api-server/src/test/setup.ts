import crypto from "node:crypto";
import type { AddressInfo, Server } from "node:net";
import { Server as TlsServer } from "node:tls";
import { Test } from "supertest";
import { beforeAll, beforeEach } from "vitest";
import { _resetBucketForTests } from "../lib/limits";

// SYC-3: the keyed address fingerprint (lib/mail/fingerprint.ts). A fresh
// random key per run; no real key is ever in a file.
process.env["EMAIL_FINGERPRINT_KEY"] ??= crypto.randomBytes(32).toString("base64url");

// SYC-195 / SYC-105: every test request comes from the same address (::1,
// see below), and many suites register far more than one hour's allowance of
// new devices or send more reports than an hour's limit allows. Limits are
// counted in the one throwaway database the whole run shares, so unlike the
// old per-file memory they would carry over from one file to the next. Every
// count is cleared before each file's beforeAll (which often seeds over HTTP)
// and before each test; the limit tests exercise the caps within single
// tests. A failure to clear is a failure, not something to skip: a count
// left behind would make a later test fail for the wrong reason.
beforeAll(async () => {
  await _resetBucketForTests();
});

beforeEach(async () => {
  await _resetBucketForTests();
});

// SYC-144, SYC-301, SYC-304: supertest starts the app on a fresh
// port for every request with listen(0), which binds every address ("::",
// IPv6 and IPv4 together), then sends the request to 127.0.0.1. On a Mac the
// kernel can hand out a port that another program already holds on IPv4 only
// (Spotify keeps *:57621 and *:49251), and a connection to 127.0.0.1 then
// reaches that program, not the app: "Parse Error: Expected HTTP/" (it
// answered {"type":"Tier1",...}), "socket hang up", or a stranger's reply
// counted as ours. It can't happen on IPv6, where the kernel never hands out
// a port someone else holds, so connect to [::1]. Falls back to 127.0.0.1
// where the server isn't on IPv6. CI (Linux) never saw it; local runs did.
// Assumes a host that binds "::" also has ::1 on loopback (true on Macs and
// GitHub's runners); if not, every request fails loudly with ECONNREFUSED.
// serverAddress is supertest's private method, so supertestAddress.test.ts
// fails if an upgrade stops calling it.
type SupertestInternals = {
  serverAddress(this: { _server?: Server }, app: Server, path: string): string;
};
(Test.prototype as unknown as SupertestInternals).serverAddress = function (
  app,
  path,
) {
  if (!app.address()) this._server = app.listen(0);
  const { port, family } = app.address() as AddressInfo;
  const host = family === "IPv6" ? "[::1]" : "127.0.0.1";
  const protocol = app instanceof TlsServer ? "https" : "http";
  return `${protocol}://${host}:${port}${path}`;
};
