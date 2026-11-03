import { describe, expect, it } from "vitest";
import { ipFingerprint } from "./fingerprint";

// SYC-667: the keep-safe and reporter-email per-network counts compare these
// hashes, so they must group an address the way the shared limiters do.
describe("ipFingerprint groups the address before hashing", () => {
  it("counts an IPv6 /56 as one network", () => {
    expect(ipFingerprint("2001:db8:1:100::1")).toBe(ipFingerprint("2001:db8:1:1ff:abcd::9"));
    expect(ipFingerprint("2001:db8:1:100::1")).not.toBe(ipFingerprint("2001:db8:1:200::1"));
  });

  it("counts an IPv4-mapped address as the IPv4 one, and keeps IPv4 addresses apart", () => {
    expect(ipFingerprint("::ffff:198.51.100.7")).toBe(ipFingerprint("198.51.100.7"));
    expect(ipFingerprint("198.51.100.7")).not.toBe(ipFingerprint("198.51.100.8"));
  });

  it("treats a missing address as \"unknown\"", () => {
    expect(ipFingerprint("")).toBe(ipFingerprint("unknown"));
  });
});
