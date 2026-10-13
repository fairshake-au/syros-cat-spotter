import { vi } from "vitest";

/**
 * A stand-in for Resend: every send is recorded, nothing leaves the machine.
 * Shared by the keep-safe tests (SYC-3).
 */
export type SentMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  from: string;
  idempotencyKey: string | null;
};

export function installFakeResend(opts: { fail?: () => boolean } = {}): SentMail[] {
  const sent: SentMail[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (opts.fail?.()) throw new Error("network down");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const headers = new Headers(init?.headers);
      sent.push({
        to: (body["to"] as string[])[0]!,
        subject: String(body["subject"]),
        text: String(body["text"]),
        html: String(body["html"]),
        from: String(body["from"]),
        idempotencyKey: headers.get("Idempotency-Key"),
      });
      return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 });
    }),
  );
  return sent;
}

/** The link token in a sent email, for the given path. */
export function tokenFrom(mail: SentMail, path: "/restore" | "/api/mail/confirm" | "/api/mail/forget"): string {
  // Restore links carry the token in the fragment (#t=, Decision 12); the
  // confirm and forget links in the query (?t=).
  const match = mail.text.match(new RegExp(`${path.replace(/\//g, "\\/")}[?#]t=([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`no ${path} link in the email`);
  return match[1]!;
}
