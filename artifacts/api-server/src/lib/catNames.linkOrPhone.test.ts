import { describe, expect, it } from "vitest";
import { hasLinkOrPhoneNumber } from "./catNames";

// SYC-709 (docs/specs/syc-709-naming-limits.md): no web link or phone number
// in a name the public types. Best effort; these are the cases the spec names.
describe("hasLinkOrPhoneNumber", () => {
  it.each([
    "buy-stuff.com",
    "BUY.COM",
    "kitty.fr",
    "Visit www.kitty",
    "http://x",
    "https://kitty",
    "t.me/kitty",
    "wa.me/306912345678",
    "buy-stuff．com",
    "12345",
    "Call 6912345678",
    "691 234 5678",
    "+30 691-234-5678",
    "691.234.5678",
    // Zero-width spaces between the digits or before the web ending.
    "691​234​5678",
    "buy-stuff.​com",
    "١٢٣٤٥",
  ])("refuses %j", (name) => {
    expect(hasLinkOrPhoneNumber(name)).toBe(true);
  });

  it.each([
    "Mr.Whiskers",
    "Dr. Who",
    "St. Nick",
    "Mr.Co",
    "Comet",
    "Agent 007",
    "Kitty 2026",
    "No. 5",
    "Cat 1 2 3 4 5",
    "Μαύρη",
    "Minou",
    "Le Chat",
  ])("allows %j", (name) => {
    expect(hasLinkOrPhoneNumber(name)).toBe(false);
  });
});
