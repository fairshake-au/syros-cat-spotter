/**
 * The one call to Resend (spec §2.10, DECISIONS D2). Plain `fetch`, so no
 * library is needed. SYC-42 plan, Slice 0 item 0.1.
 *
 * - 10-second timeout by default; a timeout is a provider error, never a hang.
 * - Returns Resend's message id so callers can log it. Never logs the
 *   recipient (that's send.ts's job, as a hash).
 * - `RESEND_API_BASE` exists only so a local build can point at a fake mail
 *   endpoint for the browser check (plan test 26). Production leaves it unset.
 */

export type ResendAttachment = { filename: string; content: string };

export type ResendMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments?: ResendAttachment[];
  idempotencyKey?: string;
};

export type ResendResult =
  | { ok: true; id: string }
  | { ok: false; status: number | null; error: string };

export const DEFAULT_TIMEOUT_MS = 10_000;

export function resendBase(): string {
  return (process.env["RESEND_API_BASE"] || "https://api.resend.com").replace(
    /\/+$/,
    "",
  );
}

export async function resendSend(
  apiKey: string,
  message: ResendMessage,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ResendResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (message.idempotencyKey) headers["Idempotency-Key"] = message.idempotencyKey;
  const body: Record<string, unknown> = {
    from: message.from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
  };
  if (message.replyTo) body["reply_to"] = message.replyTo;
  if (message.attachments?.length) body["attachments"] = message.attachments;
  try {
    const res = await fetchImpl(`${resendBase()}/emails`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, error: text.slice(0, 300) };
    }
    let id = "";
    try {
      id = String((JSON.parse(text) as { id?: unknown }).id ?? "");
    } catch {
      /* fall through */
    }
    if (!id) return { ok: false, status: res.status, error: "no message id" };
    return { ok: true, id };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return {
      ok: false,
      status: null,
      error: name === "AbortError" ? "timeout" : String(err).slice(0, 300),
    };
  } finally {
    clearTimeout(timer);
  }
}
