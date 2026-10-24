import { describe, expect, it } from "vitest";
import { donateAddressProblem } from "./appSwitches";

// SYC-383: an address the team types must be a safe https page, or be refused.
describe("donateAddressProblem", () => {
  it("accepts an https address and stores it in the form the app reads", () => {
    expect(donateAddressProblem("  https://syroscats.com/donations ")).toEqual({ url: "https://syroscats.com/donations" });
  });

  it.each([
    ["", "Type the address"],
    ["   ", "Type the address"],
    ["http://syroscats.com/donations", "https://"],
    ["javascript:alert(1)", "https://"],
    ["ftp://syroscats.com", "https://"],
    ["//syroscats.com/donations", "web address"],
    ["syroscats.com/donations", "web address"],
    ["not an address", "web address"],
    ["https://localhost/donate", "website name"],
    ["https://user:secret@syroscats.com/donations", "user name and password"],
    [`https://syroscats.com/${"a".repeat(300)}`, "too long"],
  ])("refuses %j", (typed, words) => {
    const r = donateAddressProblem(typed);
    expect(r).toHaveProperty("problem");
    expect((r as { problem: string }).problem).toContain(words);
  });
});
