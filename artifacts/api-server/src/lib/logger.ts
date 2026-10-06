import pino from "pino";

// Exported so the SYC-113 log test builds a capturing logger with exactly
// the production redaction.
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-prelaunch-key']",
  "res.headers['set-cookie']",
];

/**
 * What an error looks like in the logs (SYC-42 review S1). Database errors
 * carry the whole query and its parameters in their message and stack
 * ("Failed query: … params: …"), and those parameters can be a reporter's
 * note, exact coordinates, a device id or a photo's bytes. So an error is
 * logged as its name and codes only; an ordinary message is kept unless it
 * looks like a query.
 */
const QUERY_TEXT = /failed query|params:|\binsert into\b|\bupdate\b.+\bset\b|\bselect\b.+\bfrom\b/i;

export function safeError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== "object") return { type: typeof err };
  const e = err as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
  const out: Record<string, unknown> = { type: typeof e.name === "string" ? e.name : "Error" };
  if (typeof e.code === "string" || typeof e.code === "number") out["code"] = e.code;
  const message = typeof e.message === "string" ? e.message : "";
  if (message && !QUERY_TEXT.test(message)) out["message"] = message.slice(0, 300);
  const cause = e.cause as { name?: unknown; code?: unknown } | undefined;
  if (cause && typeof cause === "object") {
    if (typeof cause.name === "string") out["causeType"] = cause.name;
    if (typeof cause.code === "string" || typeof cause.code === "number") out["causeCode"] = cause.code;
  }
  return out;
}

/**
 * The request URL as it goes into the request log (SYC-109). A device id is a
 * credential, and it must not outlive a "Delete my data" request in the logs,
 * so every route that carries one in its path has it replaced:
 * `/profiles/:deviceId…`, `/notifications/:deviceId…` and
 * `/profile/:deviceId/push-token`. The line is still logged, with the id
 * swapped for a placeholder. Query strings (which can hold a username being
 * checked) are dropped. The two static `/profiles/username-*` routes keep
 * their real path. Case-insensitive, because Express routes are.
 */
const DEVICE_ID_IN_PATH =
  /\/(profiles|notifications|profile)\/(?!(?:username-availability|username-suggestions)(?:\/|$))[^/]+/i;

export function redactRequestUrl(url: string | undefined): string | undefined {
  return url?.split("?")[0].replace(DEVICE_ID_IN_PATH, "/$1/:deviceId");
}

// Exported so the capturing loggers in tests use exactly these serializers.
export const LOG_SERIALIZERS = { err: safeError, error: safeError };

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: REDACT_PATHS,
  serializers: LOG_SERIALIZERS,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
