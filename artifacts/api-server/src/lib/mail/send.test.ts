import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAIL_PURPOSES,
  NEVER_SHED_PURPOSES,
  describeMail,
  escapeHtml,
  isPurposeEnabled,
  sendMail,
  type MailPurpose,
} from "./send";

// SYC-42 plan, Slice 0 item 0.1 and tests 1–2 (spec §8.3). Built to the
// interface the SYC-3 plan specifies (Slice 1 step 2), so SYC-3 reuses this
// function and there is never a second one.

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

const BASE = {
  to: "probe@example.org",
  subject: "Cat report: needs attention",
  text: "plain",
  html: "<p>plain</p>",
};

describe("sendMail", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env["RESEND_API_KEY"] = "re_test_key_not_real";
    delete process.env["RESEND_API_BASE"];
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("test 1: refuses a purpose outside the closed list, at run time", async () => {
    const { impl, calls } = fakeFetch();
    const result = await sendMail(
      // @ts-expect-error: not a purpose, and the type system says so
      { ...BASE, purpose: "anything_goes" },
      { fetchImpl: impl },
    );
    expect(result).toEqual({ ok: false, reason: "unknown_purpose" });
    expect(calls).toHaveLength(0);
  });

  it("test 1: refuses a listed purpose that is not switched on (urgent_alert stays off, Decision 1)", async () => {
    const { impl, calls } = fakeFetch();
    const result = await sendMail(
      { ...BASE, purpose: "urgent_alert" },
      { fetchImpl: impl },
    );
    expect(result).toEqual({ ok: false, reason: "purpose_disabled" });
    expect(calls).toHaveLength(0);
    expect(isPurposeEnabled("urgent_alert")).toBe(false);
  });

  it("only welfare_alert is switched on in Slice 1", () => {
    const enabled = MAIL_PURPOSES.filter((p) => isPurposeEnabled(p));
    expect(enabled).toEqual(["welfare_alert"]);
  });

  it("welfare alerts are in the never-shed group (spec §2.10)", () => {
    expect(NEVER_SHED_PURPOSES).toContain("welfare_alert");
  });

  it("test 1: refuses to send with no key, and logs why", async () => {
    delete process.env["RESEND_API_KEY"];
    const { impl, calls } = fakeFetch();
    const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const result = await sendMail(
      { ...BASE, purpose: "welfare_alert" },
      { fetchImpl: impl, log },
    );
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(calls).toHaveLength(0);
    expect(log.error).toHaveBeenCalled();
    expect(JSON.stringify(log.error.mock.calls)).toMatch(/RESEND_API_KEY/);
  });

  it("the start-up line says whether the key is present, never its value", () => {
    process.env["RESEND_API_KEY"] = "re_secret_value_never_logged";
    const lines = describeMail().join("\n");
    expect(lines).not.toContain("re_secret_value_never_logged");
    expect(lines).toMatch(/mail: RESEND_API_KEY present/);
    delete process.env["RESEND_API_KEY"];
    expect(describeMail().join("\n")).toMatch(/WARNING.*RESEND_API_KEY/);
  });

  it("sends welfare_alert from the transactional identity through Resend", async () => {
    const { impl, calls } = fakeFetch();
    const result = await sendMail(
      {
        ...BASE,
        purpose: "welfare_alert",
        attachments: [{ filename: "photo.jpg", content: Buffer.from("x") }],
      },
      { fetchImpl: impl },
    );
    expect(result).toEqual({ ok: true, providerMessageId: "re_test_123" });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://api.resend.com/emails");
    expect((call.init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer re_test_key_not_real",
    );
    const body = sentBody(call);
    expect(body["from"]).toBe(
      "Syros Cats via Cat Spotters <reports@mail.catspotters.com>",
    );
    expect(body["to"]).toEqual(["probe@example.org"]);
    expect(body["attachments"]).toEqual([
      { filename: "photo.jpg", content: Buffer.from("x").toString("base64") },
    ]);
  });

  it("test 2: a newline in the subject can't add a header", async () => {
    const { impl, calls } = fakeFetch();
    await sendMail(
      {
        ...BASE,
        purpose: "welfare_alert",
        subject: "Cat report\r\nBcc: victim@example.org",
      },
      { fetchImpl: impl },
    );
    const body = sentBody(calls[0]!);
    expect(String(body["subject"])).not.toMatch(/[\r\n]/);
    expect(body).not.toHaveProperty("bcc");
  });

  it("test 2: a recipient with a newline or a comma list is refused", async () => {
    const { impl, calls } = fakeFetch();
    const r1 = await sendMail(
      { ...BASE, purpose: "welfare_alert", to: "a@example.org\r\nBcc: b@example.org" },
      { fetchImpl: impl },
    );
    const r2 = await sendMail(
      { ...BASE, purpose: "welfare_alert", to: "a@example.org, b@example.org" },
      { fetchImpl: impl },
    );
    expect(r1).toEqual({ ok: false, reason: "bad_recipient" });
    expect(r2).toEqual({ ok: false, reason: "bad_recipient" });
    expect(calls).toHaveLength(0);
  });

  it("a provider error is reported, logged loudly, and never swallowed", async () => {
    const { impl } = fakeFetch(
      () => new Response(JSON.stringify({ message: "nope" }), { status: 500 }),
    );
    const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const result = await sendMail(
      { ...BASE, purpose: "welfare_alert" },
      { fetchImpl: impl, log },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("provider_error");
    expect(log.error).toHaveBeenCalled();
  });

  it("logs the recipient only as a hash", async () => {
    const { impl } = fakeFetch();
    const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    await sendMail({ ...BASE, purpose: "welfare_alert" }, { fetchImpl: impl, log });
    const everything = JSON.stringify([
      log.info.mock.calls,
      log.error.mock.calls,
      log.warn.mock.calls,
    ]);
    expect(everything).not.toContain("probe@example.org");
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
    const result = await sendMail(
      { ...BASE, purpose: "welfare_alert" },
      { fetchImpl: impl, timeoutMs: 20 },
    );
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
