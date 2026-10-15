import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAIL_PURPOSES,
  NEVER_SHED_PURPOSES,
  PURPOSE_RULES,
  describeMail,
  escapeHtml,
  isPurposeEnabled,
  sendMail,
  __setEnabledPurposesForTest,
  __setTemplatesForTest,
  type MailPurpose,
} from "./send";

// SYC-42 plan, Slice 0 item 0.1 and tests 1–2 (spec §8.3, §2.10). Built to
// the interface the SYC-3 plan specifies (Slice 1 step 2, test 14), so SYC-3
// reuses this function and there is never a second one.

type FetchCall = { url: string; init: RequestInit };

function fakeFetch(
  respond: () => Response | Promise<Response> = () =>
    new Response(JSON.stringify({ id: "re_test_123" }), { status: 200 }),
) {
  const calls: FetchCall[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function sentBody(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

function quietLog() {
  return { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

const ALERT = {
  purpose: "welfare_alert" as const,
  subject: "Cat report: needs attention",
  text: "plain",
  html: "<p>plain</p>",
};

describe("sendMail", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env["RESEND_API_KEY"] = "re_test_key_not_real";
    process.env["RESEND_NEWS_API_KEY"] = "re_test_news_key_not_real";
    process.env["WELFARE_ALERT_TO"] = "team@example.org";
    delete process.env["RESEND_API_BASE"];
    // A stand-in for the fixed templates SYC-3 and Slice 3 will register.
    __setTemplatesForTest({
      test_fixture: () => ({ subject: "Fixed subject", text: "Fixed text", html: "<p>Fixed text</p>" }),
    });
  });
  afterEach(() => {
    process.env = { ...saved };
    __setEnabledPurposesForTest(null);
    __setTemplatesForTest(null);
  });

  it("test 1: refuses a purpose outside the closed list, at run time", async () => {
    const { impl, calls } = fakeFetch();
    const result = await sendMail(
      // @ts-expect-error: not a purpose, and the type system says so
      { ...ALERT, purpose: "anything_goes" },
      { fetchImpl: impl, log: quietLog() },
    );
    expect(result).toEqual({ ok: false, reason: "unknown_purpose" });
    expect(calls).toHaveLength(0);
  });

  it("test 1: refuses a listed purpose that is not switched on (urgent_alert stays off, Decision 1)", async () => {
    const { impl, calls } = fakeFetch();
    const result = await sendMail(
      { ...ALERT, purpose: "urgent_alert" },
      { fetchImpl: impl, log: quietLog() },
    );
    expect(result).toEqual({ ok: false, reason: "purpose_disabled" });
    expect(calls).toHaveLength(0);
    expect(isPurposeEnabled("urgent_alert")).toBe(false);
  });

  it("switched on: welfare_alert (SYC-42), SYC-3's two keep-safe emails, the reporter's three (SYC-42 Slice 3) and SYC-53's two people emails; forget stays off (A9)", () => {
    expect(MAIL_PURPOSES.filter((p) => isPurposeEnabled(p))).toEqual([
      "welfare_alert",
      "public_verify",
      "report_ack",
      "report_outcome",
      "keep_safe_verify",
      "restore_link",
      "person_invite",
      "access_change_notice",
    ]);
  });

  it("welfare alerts and restore links are in the never-shed group (spec §2.10; SYC-3 A7); an invitation can be shed (roles spec §8.5)", () => {
    expect(NEVER_SHED_PURPOSES).toEqual(["welfare_alert", "restore_link"]);
    expect(NEVER_SHED_PURPOSES).not.toContain("person_invite");
    expect(PURPOSE_RULES.person_invite).toMatchObject({
      identity: "transactional",
      from: "Cat Spotters <signin@mail.catspotters.com>",
      recipient: "person",
    });
    expect(PURPOSE_RULES.access_change_notice).toMatchObject({ identity: "transactional", recipient: "management" });
  });

  describe("recipients are decided by purpose (review fix 1)", () => {
    it("welfare_alert goes to WELFARE_ALERT_TO, resolved inside send.ts", async () => {
      const { impl, calls } = fakeFetch();
      const result = await sendMail(ALERT, { fetchImpl: impl, log: quietLog() });
      expect(result.ok).toBe(true);
      expect(sentBody(calls[0]!)["to"]).toEqual(["team@example.org"]);
    });

    it("a caller-supplied `to` on a team purpose is refused", async () => {
      const { impl, calls } = fakeFetch();
      const result = await sendMail(
        // @ts-expect-error: team purposes take no recipient
        { ...ALERT, to: "stranger@example.net" },
        { fetchImpl: impl, log: quietLog() },
      );
      expect(result).toEqual({ ok: false, reason: "recipient_not_allowed" });
      expect(calls).toHaveLength(0);
    });

    it("with WELFARE_ALERT_TO unset or not a single address, nothing is sent", async () => {
      const { impl, calls } = fakeFetch();
      delete process.env["WELFARE_ALERT_TO"];
      expect(await sendMail(ALERT, { fetchImpl: impl, log: quietLog() })).toEqual({
        ok: false,
        reason: "bad_recipient",
      });
      process.env["WELFARE_ALERT_TO"] = "a@example.org, b@example.org";
      expect(await sendMail(ALERT, { fetchImpl: impl, log: quietLog() })).toEqual({
        ok: false,
        reason: "bad_recipient",
      });
      process.env["WELFARE_ALERT_TO"] = "a@example.org\r\nBcc: b@example.org";
      expect(await sendMail(ALERT, { fetchImpl: impl, log: quietLog() })).toEqual({
        ok: false,
        reason: "bad_recipient",
      });
      expect(calls).toHaveLength(0);
    });

    it("Reply-To is set by purpose, never by the caller", async () => {
      expect(PURPOSE_RULES.welfare_alert.replyTo).toBeUndefined();
      expect(PURPOSE_RULES.report_ack.replyTo).toBe("admin@syroscats.com");
      expect(PURPOSE_RULES.report_outcome.replyTo).toBe("admin@syroscats.com");
      const { impl, calls } = fakeFetch();
      await sendMail(
        // @ts-expect-error: callers can't set Reply-To
        { ...ALERT, replyTo: "a@example.org, b@example.org" },
        { fetchImpl: impl, log: quietLog() },
      );
      expect(calls).toHaveLength(0);
    });

    it("every purpose that emails the public uses a fixed template, not caller text (SYC-3 test 14)", async () => {
      for (const p of MAIL_PURPOSES) {
        const rule = PURPOSE_RULES[p];
        if (rule.recipient !== "team") expect(rule.body, p).toBe("fixed_template");
      }
      __setEnabledPurposesForTest(["welfare_alert", "public_verify"]);
      const { impl, calls } = fakeFetch();
      const result = await sendMail(
        // @ts-expect-error: public purposes take a template id, not free text
        { purpose: "public_verify", to: "someone@example.net", subject: "hi", text: "free", html: "<p>free</p>" },
        { fetchImpl: impl, log: quietLog(), isSuppressed: async () => false, isVerified: async () => true },
      );
      expect(result.ok).toBe(false);
      expect(calls).toHaveLength(0);
    });
  });

  describe("public recipients need the suppression check (review fix 2)", () => {
    it("a public purpose is refused when no isSuppressed check is supplied", async () => {
      __setEnabledPurposesForTest(["welfare_alert", "report_ack"]);
      const { impl, calls } = fakeFetch();
      const result = await sendMail(
        { purpose: "report_ack", to: "someone@example.net", template: "test_fixture", params: {} },
        { fetchImpl: impl, log: quietLog(), isVerified: async () => true },
      );
      expect(result).toEqual({ ok: false, reason: "suppression_check_missing" });
      expect(calls).toHaveLength(0);
    });

    it("a suppressed address gets nothing", async () => {
      __setEnabledPurposesForTest(["welfare_alert", "report_ack"]);
      const { impl, calls } = fakeFetch();
      const result = await sendMail(
        { purpose: "report_ack", to: "someone@example.net", template: "test_fixture", params: {} },
        { fetchImpl: impl, log: quietLog(), isSuppressed: async () => true, isVerified: async () => true },
      );
      expect(result).toEqual({ ok: false, reason: "suppressed" });
      expect(calls).toHaveLength(0);
    });

    it("a verified-only purpose refuses an unverified address (F7b)", async () => {
      __setEnabledPurposesForTest(["welfare_alert", "report_ack"]);
      const { impl, calls } = fakeFetch();
      const missing = await sendMail(
        { purpose: "report_ack", to: "someone@example.net", template: "test_fixture", params: {} },
        { fetchImpl: impl, log: quietLog(), isSuppressed: async () => false },
      );
      expect(missing).toEqual({ ok: false, reason: "verification_check_missing" });
      const unverified = await sendMail(
        { purpose: "report_ack", to: "someone@example.net", template: "test_fixture", params: {} },
        { fetchImpl: impl, log: quietLog(), isSuppressed: async () => false, isVerified: async () => false },
      );
      expect(unverified).toEqual({ ok: false, reason: "unverified" });
      expect(calls).toHaveLength(0);
    });

    it("an unknown template is refused", async () => {
      __setEnabledPurposesForTest(["welfare_alert", "report_ack"]);
      const { impl, calls } = fakeFetch();
      const result = await sendMail(
        { purpose: "report_ack", to: "someone@example.net", template: "nope", params: {} },
        { fetchImpl: impl, log: quietLog(), isSuppressed: async () => false, isVerified: async () => true },
      );
      expect(result).toEqual({ ok: false, reason: "unknown_template" });
      expect(calls).toHaveLength(0);
    });
  });

  describe("one key per sending identity (review fix 3, spec §2.10, D2)", () => {
    it("transactional mail uses RESEND_API_KEY", async () => {
      const { impl, calls } = fakeFetch();
      await sendMail(ALERT, { fetchImpl: impl, log: quietLog() });
      expect((calls[0]!.init.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer re_test_key_not_real",
      );
    });

    it("news-identity mail uses RESEND_NEWS_API_KEY, and refuses without it", async () => {
      __setEnabledPurposesForTest(["welfare_alert", "public_verify"]);
      const deps = { isSuppressed: async () => false, isVerified: async () => true };
      const { impl, calls } = fakeFetch();
      await sendMail(
        { purpose: "public_verify", to: "someone@example.net", template: "test_fixture", params: {} },
        { fetchImpl: impl, log: quietLog(), ...deps },
      );
      expect((calls[0]!.init.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer re_test_news_key_not_real",
      );
      expect(sentBody(calls[0]!)["from"]).toBe("Cat Spotters <news@news.catspotters.com>");
      delete process.env["RESEND_NEWS_API_KEY"];
      const result = await sendMail(
        { purpose: "public_verify", to: "someone@example.net", template: "test_fixture", params: {} },
        { fetchImpl: impl, log: quietLog(), ...deps },
      );
      expect(result).toEqual({ ok: false, reason: "not_configured" });
    });

    it("test 1: refuses to send with no transactional key, and logs why", async () => {
      delete process.env["RESEND_API_KEY"];
      const { impl, calls } = fakeFetch();
      const log = quietLog();
      const result = await sendMail(ALERT, { fetchImpl: impl, log });
      expect(result).toEqual({ ok: false, reason: "not_configured" });
      expect(calls).toHaveLength(0);
      expect(JSON.stringify(log.error.mock.calls)).toMatch(/RESEND_API_KEY/);
    });

    it("the start-up lines report each identity's key, never its value, and warn at warn level", () => {
      process.env["RESEND_API_KEY"] = "re_secret_value_never_logged";
      delete process.env["RESEND_NEWS_API_KEY"];
      const lines = describeMail();
      const all = JSON.stringify(lines);
      expect(all).not.toContain("re_secret_value_never_logged");
      expect(lines).toContainEqual({ level: "info", line: "mail: transactional key (RESEND_API_KEY) present" });
      // SYC-42 Slice 3 switched on public_verify, which the news key signs.
      expect(lines.find((l) => l.line.includes("RESEND_NEWS_API_KEY"))!.level).toBe("warn");
      delete process.env["RESEND_API_KEY"];
      const warn = describeMail().find((l) => l.line.includes("RESEND_API_KEY") && !l.line.includes("NEWS"))!;
      expect(warn.level).toBe("warn");
      expect(warn.line).not.toMatch(/mail_outbox/);
    });

    it("RESEND_API_BASE is ignored in production (review nit 11)", async () => {
      process.env["NODE_ENV"] = "production";
      process.env["RESEND_API_BASE"] = "https://evil.example";
      const { impl, calls } = fakeFetch();
      await sendMail(ALERT, { fetchImpl: impl, log: quietLog() });
      expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    });
  });

  it("sends welfare_alert from the transactional identity through Resend, photo attached", async () => {
    const { impl, calls } = fakeFetch();
    const result = await sendMail(
      { ...ALERT, attachments: [{ filename: "photo.jpg", content: Buffer.from("x") }] },
      { fetchImpl: impl, log: quietLog() },
    );
    expect(result).toEqual({ ok: true, providerMessageId: "re_test_123" });
    const call = calls[0]!;
    expect(call.url).toBe("https://api.resend.com/emails");
    const body = sentBody(call);
    expect(body["from"]).toBe("Syros Cats via Cat Spotters <reports@mail.catspotters.com>");
    expect(body).not.toHaveProperty("reply_to");
    expect(body["attachments"]).toEqual([
      { filename: "photo.jpg", content: Buffer.from("x").toString("base64") },
    ]);
  });

  it("an inline photo carries its content id to Resend as content_id", async () => {
    const { impl, calls } = fakeFetch();
    await sendMail(
      { ...ALERT, attachments: [{ filename: "photo.jpg", content: Buffer.from("x"), contentId: "cat-photo" }] },
      { fetchImpl: impl, log: quietLog() },
    );
    expect(sentBody(calls[0]!)["attachments"]).toEqual([
      { filename: "photo.jpg", content: Buffer.from("x").toString("base64"), content_id: "cat-photo" },
    ]);
  });

  it("test 2: a newline in the subject can't add a header", async () => {
    const { impl, calls } = fakeFetch();
    await sendMail(
      { ...ALERT, subject: "Cat report\r\nBcc: victim@example.org" },
      { fetchImpl: impl, log: quietLog() },
    );
    const body = sentBody(calls[0]!);
    expect(String(body["subject"])).not.toMatch(/[\r\n]/);
    expect(body).not.toHaveProperty("bcc");
  });

  it("a provider error is reported, logged loudly, and never swallowed", async () => {
    const { impl } = fakeFetch(
      () => new Response(JSON.stringify({ message: "nope" }), { status: 500 }),
    );
    const log = quietLog();
    const result = await sendMail(ALERT, { fetchImpl: impl, log });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("provider_error");
    expect(log.error).toHaveBeenCalled();
  });

  it("nit 9: an error that echoes the recipient is logged and returned without it", async () => {
    const { impl } = fakeFetch(
      () =>
        new Response(JSON.stringify({ message: "Invalid `to` field: team@example.org is not allowed" }), {
          status: 422,
        }),
    );
    const log = quietLog();
    const result = await sendMail(ALERT, { fetchImpl: impl, log });
    const everything = JSON.stringify([log.error.mock.calls, log.info.mock.calls, log.warn.mock.calls, result]);
    expect(everything).not.toContain("team@example.org");
  });

  it("logs the recipient only as a hash", async () => {
    const { impl } = fakeFetch();
    const log = quietLog();
    await sendMail(ALERT, { fetchImpl: impl, log });
    const everything = JSON.stringify([log.info.mock.calls, log.error.mock.calls, log.warn.mock.calls]);
    expect(everything).not.toContain("team@example.org");
    expect(everything).toContain("re_test_123");
  });

  it("a timeout is a provider error, not a hang", async () => {
    const impl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    const result = await sendMail(ALERT, { fetchImpl: impl, timeoutMs: 20, log: quietLog() });
    expect(result).toMatchObject({ ok: false, reason: "provider_error" });
  });

  it("purposes are a closed list", () => {
    const p: MailPurpose = "welfare_alert";
    expect(MAIL_PURPOSES).toContain(p);
  });
});

describe("escapeHtml (test 2, spec §8.3)", () => {
  it("escapes everything a reporter could type into markup", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)"> & 'q'`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;q&#39;",
    );
  });
});
