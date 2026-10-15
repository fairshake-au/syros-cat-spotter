import { describe, expect, it } from "vitest";
import { renderConfirmPage } from "./confirm";

// The "Are you sure?" page (SYC-362, Decision 1).

const page = (fields: Record<string, string | undefined>) =>
  renderConfirmPage({
    title: "Remove Mimi's owner?",
    lines: ["The owner stops seeing the exact spot and getting alerts.", "The owner is not told."],
    action: "/api/team/cats/7/remove-owner",
    fields,
    yes: "Yes, remove the owner",
    cancelHref: "/api/team/cats/7",
    cancelLabel: "Back to the cat (nothing changed)",
    personName: "Maria",
    active: "cats",
  });

const form = (html: string) => /<form method="post" action="[^"]*" class="sureform">[\s\S]*?<\/form>/.exec(html)![0];

describe("renderConfirmPage", () => {
  it("posts every field back to the same action, with confirm=1 added", () => {
    const f = form(page({ status: "street", reason: "Not theirs", date: "2026-10-01" }));
    expect(f).toContain('action="/api/team/cats/7/remove-owner"');
    expect(f).toContain('<input type="hidden" name="status" value="street">');
    expect(f).toContain('<input type="hidden" name="reason" value="Not theirs">');
    expect(f).toContain('<input type="hidden" name="date" value="2026-10-01">');
    expect(f).toContain('<input type="hidden" name="confirm" value="1">');
    expect(f).toContain('<button type="submit" class="risky">Yes, remove the owner</button>');
  });

  it("leaves out a field that wasn't sent, and never carries an old confirm twice", () => {
    const f = form(page({ status: "street", reason: "x", date: undefined, confirm: "1" }));
    expect(f).not.toContain('name="date"');
    expect(f.match(/name="confirm"/g)).toHaveLength(1);
  });

  it("escapes what the person typed, and the sentences", () => {
    const html = page({ reason: '"><script>alert(1)</script>', status: "street" });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(html).toContain("<li>The owner is not told.</li>");
  });

  it("offers Cancel as a plain link back, which changes nothing", () => {
    const html = page({ status: "street", reason: "x" });
    expect(html).toContain('<a class="tap" href="/api/team/cats/7">Back to the cat (nothing changed)</a>');
    expect(html).toContain("<h1>Remove Mimi&#39;s owner?</h1>");
  });
});
