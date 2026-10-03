/**
 * Request-duration logging for `GET /cats` and `GET /cats/{id}`
 * (cat-record-data-spine.md §2.3): "Today there is no timing
 * instrumentation, no slow-query log and no metrics anywhere in the API, so
 * [§13 risk 6's 200 ms revisit trigger] is unobservable and therefore not a
 * mitigation. Request-duration logging on `GET /cats` and `GET /cats/{id}`
 * ships in the same change as the resolver." pino-http's own default
 * completion log already carries a generic `responseTime`, but it isn't
 * filterable by route or compared against the spec's own 200 ms figure —
 * this gives that trigger an explicit, grep-able, named log line instead.
 */
import type { Request } from "express";
import { logger } from "./logger";

/** §13 risk 6's own figure — see the doc comment above. */
export const SLOW_ROUTE_THRESHOLD_MS = 200;

export function logRouteDuration(
  req: Request,
  route: "GET /cats" | "GET /cats/:id",
  startedAtMs: number,
  extra: Record<string, unknown> = {},
): void {
  const durationMs = Math.round(performance.now() - startedAtMs);
  const payload = { route, durationMs, reqId: req.id, ...extra };
  if (durationMs > SLOW_ROUTE_THRESHOLD_MS) {
    logger.warn(payload, "slow cat-page query (§13 risk 6 trigger)");
  } else {
    logger.info(payload, "cat-page query duration");
  }
}
