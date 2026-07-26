import { describe, it, expect } from "vitest";
import { sanitizeDonateUrl } from "./campaign";

describe("sanitizeDonateUrl", () => {
  it("passes an absolute https URL through", () => {
    expect(sanitizeDonateUrl("https://example.org/donate")).toBe(
      "https://example.org/donate",
    );
  });

  it("keeps query strings and ports", () => {
    expect(sanitizeDonateUrl("https://example.org:8443/donate?c=vaporia")).toBe(
      "https://example.org:8443/donate?c=vaporia",
    );
  });

  it("is empty when unset", () => {
    expect(sanitizeDonateUrl(undefined)).toBe("");
    expect(sanitizeDonateUrl("")).toBe("");
    expect(sanitizeDonateUrl("   ")).toBe("");
  });

  // The reason this function exists: the value is opened from a trusted CTA.
  it("rejects javascript: URLs", () => {
    expect(sanitizeDonateUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeDonateUrl("JavaScript:alert(1)")).toBe("");
  });

  it("rejects other non-https schemes", () => {
    expect(sanitizeDonateUrl("http://example.org/donate")).toBe("");
    expect(sanitizeDonateUrl("data:text/html,<script>alert(1)</script>")).toBe("");
    expect(sanitizeDonateUrl("file:///etc/passwd")).toBe("");
    expect(sanitizeDonateUrl("catspotter://donate")).toBe("");
  });

  it("rejects values that are not absolute URLs at all", () => {
    expect(sanitizeDonateUrl("/donate")).toBe("");
    expect(sanitizeDonateUrl("example.org/donate")).toBe("");
    expect(sanitizeDonateUrl("not a url")).toBe("");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(sanitizeDonateUrl("  https://example.org/donate  ")).toBe(
      "https://example.org/donate",
    );
  });
});
