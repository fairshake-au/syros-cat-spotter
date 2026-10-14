import crypto from "node:crypto";
import { beforeEach } from "vitest";
import { _resetBucketForTests } from "../lib/limits";

// SYC-3: the keyed address fingerprint (lib/mail/fingerprint.ts). A fresh
// random key per run; no real key is ever in a file.
process.env["EMAIL_FINGERPRINT_KEY"] ??= crypto.randomBytes(32).toString("base64url");

// SYC-195 / SYC-105: every test request comes from the same address
// (127.0.0.1), and many suites register far more than one hour's allowance of
// new devices or send more reports than an hour's limit allows. Limits are
// counted in the one throwaway database the whole run shares, so unlike the
// old per-file memory they would carry over from one file to the next. Each
// test starts with every count cleared; the limit tests (newDeviceLimit,
// limits, the report and keep-safe limit tests) exercise the caps within
// single tests.
//
// A test that replaces `@workspace/db` with a stub has no table to clear, so a
// failure here is ignored: that test cannot be counting anything either.
beforeEach(async () => {
  try {
    await _resetBucketForTests();
  } catch {
    /* no database in this test */
  }
});
