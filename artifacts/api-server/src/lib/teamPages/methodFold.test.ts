import { describe, expect, it } from "vitest";
import { methodFold } from "./methodFold";

describe("methodFold (SYC-619 §3)", () => {
  it("wraps each line in a hint paragraph inside one closed fold", () => {
    expect(methodFold(["One.", "Two."])).toBe(
      '<details class="method"><summary>How this is worked out</summary><p class="hint">One.</p><p class="hint">Two.</p></details>',
    );
  });

  it("escapes every line", () => {
    const html = methodFold(['<script>alert("x")</script> & \'y\'']);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;");
  });

  it("returns an empty string when there is nothing to say", () => {
    expect(methodFold([])).toBe("");
  });
});

describe("methodFold html items (SYC-619 task 16)", () => {
  it("inserts an { html } item as it is, and still escapes string items", () => {
    const html = methodFold(["<b>plain</b>", { html: '<p class="hint" id="areas-version">Version 3.</p>' }]);
    expect(html).toContain('<p class="hint">&lt;b&gt;plain&lt;/b&gt;</p>');
    expect(html).toContain('<p class="hint" id="areas-version">Version 3.</p>');
    expect(html.indexOf("plain")).toBeLessThan(html.indexOf("areas-version"));
  });

  it("an html-only list still makes a fold", () => {
    expect(methodFold([{ html: "<p>x</p>" }])).toBe('<details class="method"><summary>How this is worked out</summary><p>x</p></details>');
  });
});
