import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import { gateEnabled } from "./prelaunch";

/**
 * Cloudflare Turnstile, the server side (SYC-170; spec
 * docs/specs/report-an-issue.md §9.2, §9.5, §9.6; plan
 * docs/superpowers/plans/syc-44-report-an-issue.md, PR 1.1).
 *
 * `verifyTurnstile` asks Cloudflare's siteverify whether a token is good and
 * answers with exactly one of four outcomes. The difference between
 * `rejected` and `unreachable` is the whole point:
 *
 * - `ok`: Cloudflare said success, and the hostname (exact list), the action
 *   and the cdata all match what this form expects.
 * - `rejected`: the token isn't good, and the SENDER controls why: missing,
 *   malformed, over 2,048 characters (refused before any call), success
 *   false (expired, reused, forged), the wrong action, the wrong cdata, or a
 *   hostname not on our exact list. The routes answer 428 and write nothing.
 * - `unreachable`: our server couldn't get an answer: a timeout (3 s, then
 *   one retry with the same idempotency key), a network error, a 5xx, a 429
 *   or a reply that isn't JSON. Only our side can see this, so a sender
 *   can't fake it. The routes accept the report marked unchecked, behind a
 *   small limit.
 * - `not_configured`: OUR key is missing or wrong (no TURNSTILE_SECRET_KEY,
 *   or Cloudflare says invalid-input-secret / missing-input-secret). Never
 *   the sender's fault and never accepted as unchecked, since a broken key
 *   would then let every report in. The routes answer 503, which the app
 *   retries with no strike.
 *
 * No `remoteip` is sent (spec §9.2, recorded for the privacy policy). The
 * token and the secret are never logged: request bodies aren't logged, and
 * the only lines written here carry the outcome, the hostname Cloudflare
 * reported, match booleans and Cloudflare's error codes.
 *
 * Development and Replit previews use Cloudflare's published test keys, whose
 * tokens report the hostname `example.com`: set TURNSTILE_HOSTNAMES to that
 * there, never in production. Those test tokens don't echo the action or
 * cdata, so local runs with test keys work only in TURNSTILE_MODE=observe:
 * in enforce every token is rejected (action-mismatch) and the route answers 428.
 */

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const MAX_TOKEN_LENGTH = 2048;
export const SITEVERIFY_TIMEOUT_MS = 3000;
// Exact list, never catspotters.com itself (SYC-662: syros is the launch address).
const DEFAULT_HOSTNAMES = ["apptest.catspotters.com", "syros.catspotters.com"];

// Tokens are printable ASCII with no spaces. Anything else is malformed and
// never sent to Cloudflare.
const TOKEN_RE = /^[\x21-\x7e]+$/;

// Our own key is wrong: our fault, never the sender's.
const SECRET_ERRORS = new Set(["invalid-input-secret", "missing-input-secret"]);
// Any other answered `success: false` is `rejected`, whatever its codes,
// `internal-error` included (spec §9.2, §9.5; review of #151, finding 2):
// "unreachable" is only what our server alone can see (timeout, 5xx, 429,
// not JSON). Cloudflare doesn't say what causes internal-error, so a sender
// might; a real one costs the phone a retry, never the report.

export type TurnstileOutcome = "ok" | "rejected" | "unreachable" | "not_configured";

export type TurnstileAction = "welfare_report" | "welfare_draft" | "report_issue";

export interface TurnstileVerdict {
  outcome: TurnstileOutcome;
  /** The hostname Cloudflare reported, when it answered. Never the token. */
  hostname: string | null;
  hostnameMatch: boolean;
  actionMatch: boolean;
  cdataMatch: boolean;
  /** Cloudflare's error codes, or our own short reason (e.g. "too-long"). */
  errorCodes: string[];
}

function verdict(
  outcome: TurnstileOutcome,
  errorCodes: string[],
  extra: Partial<TurnstileVerdict> = {},
): TurnstileVerdict {
  return {
    outcome,
    hostname: null,
    hostnameMatch: false,
    actionMatch: false,
    cdataMatch: false,
    errorCodes,
    ...extra,
  };
}

/** TURNSTILE_HOSTNAMES as an exact list (comma-separated), lower-cased. */
export function acceptedHostnames(): string[] {
  const raw = (process.env["TURNSTILE_HOSTNAMES"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return raw.length ? raw : [...DEFAULT_HOSTNAMES];
}

function secretKey(): string {
  return (process.env["TURNSTILE_SECRET_KEY"] ?? "").trim();
}

export function turnstileConfigured(): boolean {
  return secretKey() !== "";
}

type SiteverifyReply = {
  success?: unknown;
  "error-codes"?: unknown;
  hostname?: unknown;
  action?: unknown;
  cdata?: unknown;
};

type Attempt =
  | { kind: "answer"; reply: SiteverifyReply }
  | { kind: "no_answer"; reason: string };

async function callSiteverify(
  secret: string,
  token: string,
  idempotencyKey: string,
): Promise<Attempt> {
  let res: Response;
  try {
    res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, idempotency_key: idempotencyKey }),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
  } catch (err) {
    // Only the error's type: never anything that could quote the request.
    const name = err && typeof err === "object" && "name" in err ? String(err.name) : "Error";
    return { kind: "no_answer", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
  if (res.status >= 500) return { kind: "no_answer", reason: `http-${res.status}` };
  if (res.status === 429) return { kind: "no_answer", reason: "http-429" };
  let reply: unknown;
  try {
    reply = await res.json();
  } catch {
    return { kind: "no_answer", reason: "not-json" };
  }
  if (!reply || typeof reply !== "object") return { kind: "no_answer", reason: "not-json" };
  return { kind: "answer", reply: reply as SiteverifyReply };
}

function errorCodesOf(reply: SiteverifyReply): string[] {
  const codes = reply["error-codes"];
  return Array.isArray(codes) ? codes.filter((c): c is string => typeof c === "string").slice(0, 10) : [];
}

/**
 * Checks one token for one form and one report. See the file comment for
 * what each outcome means.
 */
export async function verifyTurnstile(
  token: unknown,
  expectedAction: TurnstileAction,
  expectedCdata: string,
): Promise<TurnstileVerdict> {
  const secret = secretKey();
  if (!secret) return verdict("not_configured", ["missing-secret"]);

  if (typeof token !== "string" || token === "") return verdict("rejected", ["missing-input-response"]);
  if (token.length > MAX_TOKEN_LENGTH) return verdict("rejected", ["too-long"]);
  if (!TOKEN_RE.test(token)) return verdict("rejected", ["malformed"]);

  // One key for both tries, so Cloudflare treats the retry as the same check
  // and doesn't call the token "already used".
  const idempotencyKey = randomUUID();
  let attempt = await callSiteverify(secret, token, idempotencyKey);
  if (attempt.kind === "no_answer") {
    attempt = await callSiteverify(secret, token, idempotencyKey);
  }
  if (attempt.kind === "no_answer") return verdict("unreachable", [attempt.reason]);

  const reply = attempt.reply;
  const codes = errorCodesOf(reply);
  if (codes.some((c) => SECRET_ERRORS.has(c))) return verdict("not_configured", codes);

  const hostname = typeof reply.hostname === "string" ? reply.hostname : null;
  const matches = {
    hostname,
    hostnameMatch: hostname !== null && acceptedHostnames().includes(hostname),
    actionMatch: reply.action === expectedAction,
    cdataMatch: reply.cdata === expectedCdata,
  };
  if (reply.success !== true) return verdict("rejected", codes, matches);
  if (!matches.hostnameMatch) return verdict("rejected", [...codes, "hostname-mismatch"], matches);
  if (!matches.actionMatch) return verdict("rejected", [...codes, "action-mismatch"], matches);
  if (!matches.cdataMatch) return verdict("rejected", [...codes, "cdata-mismatch"], matches);
  return verdict("ok", codes, matches);
}

// ── TURNSTILE_MODE ─────────────────────────────────────────────────────────

export type TurnstileMode = "off" | "observe" | "enforce";
const MODES: readonly TurnstileMode[] = ["off", "observe", "enforce"];

/**
 * off: no check (the default in development and tests). observe: check and
 * log every outcome, refuse nothing. enforce: refuse a rejected token.
 *
 * Production (any NODE_ENV but exactly "development" or "test", the same rule
 * as the pre-launch gate):
 * - with the pre-launch gate OFF, always enforce, whatever TURNSTILE_MODE
 *   says, so the gate can never come off with the check asleep;
 * - with the gate ON, observe unless TURNSTILE_MODE is exactly "enforce" or
 *   "off". Published phone builds don't send a token yet, so a default of
 *   enforce would refuse every cat-in-trouble report the moment this code is
 *   published (SYC-170). An unrecognised value is observe too, never enforce.
 */
export function turnstileMode(): TurnstileMode {
  const raw = process.env["TURNSTILE_MODE"];
  const mode = MODES.find((m) => m === raw);
  const nodeEnv = process.env["NODE_ENV"];
  if (nodeEnv === "development" || nodeEnv === "test") return mode ?? "off";
  if (!gateEnabled()) return "enforce";
  return mode === "enforce" || mode === "off" ? mode : "observe";
}

/** What /api/healthz says (the mode, and whether the secret is set). */
export function turnstileHealth(): { mode: TurnstileMode; secret: "configured" | "not_configured" } {
  return { mode: turnstileMode(), secret: turnstileConfigured() ? "configured" : "not_configured" };
}

/** Start-up lines: the mode, and an error line if the secret is missing. */
export function describeTurnstile(): { level: "info" | "error"; line: string }[] {
  const mode = turnstileMode();
  const lines: { level: "info" | "error"; line: string }[] = [
    { level: "info", line: `turnstile: ${mode}` },
  ];
  if (mode !== "off" && !turnstileConfigured()) {
    lines.push({
      level: "error",
      line: "turnstile: TURNSTILE_SECRET_KEY is not set; public reports will be refused with 503 until it is",
    });
  }
  return lines;
}

/** One log line for a check: never the token, never the secret. */
export function logVerdict(mode: TurnstileMode, action: TurnstileAction, v: TurnstileVerdict): void {
  const fields = {
    turnstile: v.outcome,
    mode,
    action,
    hostname: v.hostname,
    hostnameMatch: v.hostnameMatch,
    actionMatch: v.actionMatch,
    cdataMatch: v.cdataMatch,
    errorCodes: v.errorCodes,
  };
  if (v.outcome === "not_configured") logger.error(fields, "turnstile check: our key is missing or wrong");
  else if (v.outcome === "unreachable") logger.warn(fields, "turnstile check: Cloudflare unreachable");
  else logger.info(fields, "turnstile check");
}
