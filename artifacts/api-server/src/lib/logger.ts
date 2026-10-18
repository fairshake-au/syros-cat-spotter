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
 * looks like a query, or quotes part of a request address. Express's "Failed
 * to decode param '…'" quotes whatever was in the path, which for a map tile
 * (SYC-255) is a position.
 */
const QUERY_TEXT = /failed query|params:|\binsert into\b|\bupdate\b.+\bset\b|\bselect\b.+\bfrom\b/i;
const QUOTES_THE_PATH = /failed to decode param/i;

export function safeError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== "object") return { type: typeof err };
  const e = err as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
  const out: Record<string, unknown> = { type: typeof e.name === "string" ? e.name : "Error" };
  if (typeof e.code === "string" || typeof e.code === "number") out["code"] = e.code;
  const message = typeof e.message === "string" ? e.message : "";
  if (message && !QUERY_TEXT.test(message) && !QUOTES_THE_PATH.test(message)) {
    out["message"] = message.slice(0, 300);
  }
  const cause = e.cause as { name?: unknown; code?: unknown } | undefined;
  if (cause && typeof cause === "object") {
    if (typeof cause.name === "string") out["causeType"] = cause.name;
    if (typeof cause.code === "string" || typeof cause.code === "number") out["causeCode"] = cause.code;
  }
  return out;
}

/**
 * Map tile addresses (SYC-255). At the closest zoom a tile's z/x/y pins a spot
 * on Syros to about 75 m, and the team map's tiles are fetched whenever a
 * private feeding site's page opens, so logging the path would log where the
 * site is. Everything after `map-tiles/` becomes `:tile`, e.g.
 * `/api/team/map-tiles/17/74000/50000.png` → `/api/team/map-tiles/:tile`.
 * Odd spellings that a hand-made request could use (doubled slashes, `/./`,
 * `%2D` for the hyphen, `%2F` for the slash) are caught too.
 *
 * The island map's single squares (SYC-396 PR 1.5) are fetched the same way,
 * by token, at `map-square/`: everything after it becomes `[redacted]`, e.g.
 * `/api/team/map-square/<token>` → `/api/team/map-square/[redacted]`. The
 * token request itself (POST `map-squares`, plural) carries square numbers
 * in its body only, which is never logged, so its path is kept.
 */
const MAP_TILE_IN_PATH = /\/api\/+team(?:\/+\.)*\/+map(?:-|%2d)(tiles|square)(?:\/|%2f)[^?]*/i;

const MAP_TILE_PLACEHOLDER: Record<string, string> = {
  tiles: "/api/team/map-tiles/:tile",
  square: "/api/team/map-square/[redacted]",
};

/**
 * A device id is a credential (SYC-109), and it must not outlive a "Delete my
 * data" request in the logs, so every route that carries one in its path has
 * it replaced: `/profiles/:deviceId…`, `/notifications/:deviceId…`,
 * `/profile/:deviceId/push-token`, SYC-3's `/keep-safe/:deviceId` and SYC-36's
 * `/app-settings/:deviceId/signals`. The line
 * is still logged, with the id swapped for a placeholder. The two static
 * `/profiles/username-*` routes keep their real path.
 */
const DEVICE_ID_IN_PATH =
  /\/(profiles|notifications|profile|keep-safe|app-settings)\/(?!(?:username-availability|username-suggestions)(?:\/|$))[^/]+/i;

/**
 * The request URL as it goes into the request log. Query strings (which can
 * hold a username being checked) are dropped; then map tile addresses and
 * device ids are replaced as above. Case-insensitive, because Express routes
 * are.
 */
export function redactRequestUrl(url: string | undefined): string | undefined {
  const path = url?.split("?")[0];
  // A map address with its letters percent-encoded (`map-squar%65/<token>`)
  // isn't routed, but its line would still carry the token (review of PR
  // #230, finding 6). Matched on the decoded path too; an undecodable path
  // is matched as it is.
  if (path !== undefined) {
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // keep it as it is
    }
    const m = decoded !== path ? new RegExp(MAP_TILE_IN_PATH.source, "i").exec(decoded) : null;
    if (m && !new RegExp(MAP_TILE_IN_PATH.source, "i").test(path)) return MAP_TILE_PLACEHOLDER[m[1]!.toLowerCase()]!;
  }
  return path
    ?.replace(MAP_TILE_IN_PATH, (_m, kind: string) => MAP_TILE_PLACEHOLDER[kind.toLowerCase()]!)
    .replace(DEVICE_ID_IN_PATH, "/$1/:deviceId");
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
