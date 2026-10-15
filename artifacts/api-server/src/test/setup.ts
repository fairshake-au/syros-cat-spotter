import crypto from "node:crypto";
import { beforeAll, beforeEach } from "vitest";
import { _resetBucketForTests } from "../lib/limits";

// SYC-3: the keyed address fingerprint (lib/mail/fingerprint.ts). A fresh
// random key per run; no real key is ever in a file.
process.env["EMAIL_FINGERPRINT_KEY"] ??= crypto.randomBytes(32).toString("base64url");

// SYC-195 / SYC-105: every test request comes from the same address
// (127.0.0.1), and many suites register far more than one hour's allowance of
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
