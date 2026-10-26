import { describe, expect, it } from "vitest";
import { matcherBanner } from "./homePage";
import { renderNewCatsPage } from "./newCatsPage";

describe("Home's look-alike banner (SYC-532)", () => {
  const status = (failing: boolean) => ({ ok: true as const, value: { failing, failed: 7, windowMinutes: 15 } });

  it("shows in words, with the count, only while failing", () => {
    const html = matcherBanner(status(true));
    expect(html).toContain("The look-alike check is failing.");
    expect(html).toContain("7 photo checks failed in the last 15 minutes");
    expect(html).toContain("/api/team/new-cats-to-check");
    expect(matcherBanner(status(false))).toBe("");
  });

  it("an unreadable status draws nothing rather than a false alarm", () => {
    expect(matcherBanner({ ok: false })).toBe("");
  });
});

describe("New cats to check page (SYC-531)", () => {
  const cat = { catId: 12, name: "<b>Tiger</b>", namePending: false, at: new Date("2026-10-24T10:00:00Z"), photoUrl: "/api/team/photos/abc" };

  it("links each cat to its page, escapes the name and uses the team photo route", () => {
    const html = renderNewCatsPage([cat], "Sam");
    expect(html).toContain('href="/api/team/cats/12"');
    expect(html).toContain("&lt;b&gt;Tiger&lt;/b&gt;");
    expect(html).not.toContain("<b>Tiger</b>");
    expect(html).toContain('src="/api/team/photos/abc"');
    expect(html).toContain("1 cat to check");
  });

  it("says plainly when there is nothing to check", () => {
    expect(renderNewCatsPage([], "Sam")).toContain("Nothing to check.");
  });
});
