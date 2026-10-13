import crypto from "node:crypto";
import { beforeEach } from "vitest";
import { _resetNewDeviceLimitForTests } from "../middlewares/newDeviceLimit";

// SYC-195: every test request comes from the same address (127.0.0.1), and
// many suites register far more than one hour's allowance of new devices.
// Each test starts with a fresh allowance; newDeviceLimit.test.ts exercises
// the cap within single tests.
// SYC-3: the keyed address fingerprint (lib/mail/fingerprint.ts). A fresh
// random key per run; no real key is ever in a file.
process.env["EMAIL_FINGERPRINT_KEY"] ??= crypto.randomBytes(32).toString("base64url");

beforeEach(() => {
  _resetNewDeviceLimitForTests();
});
