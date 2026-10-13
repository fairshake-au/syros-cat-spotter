import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * SYC-245 (SYC-209 PR 0.2, Decision 2 option B).
 *
 * Answers one question: is this position within 50 m of any feeding site?
 * Yes or no only; the site itself is never returned, so nothing built from
 * this answer can say where a site is.
 *
 * Every `feeding_sites` row counts, retired or not (there is no retired column
 * yet, and a retired spot is still a known place). The distance is worked out
 * in the query (haversine on the earth's mean radius), so no site position
 * ever reaches the application.
 */
export const FEEDING_SITE_RADIUS_M = 50;

const EARTH_RADIUS_M = 6_371_000;

export interface ProximityPoint {
  key: string;
  lat: number;
  lng: number;
}

/**
 * The keys of the points that are within 50 m of a feeding site. One query for
 * the whole batch. Throws if the database does: callers decide what a failed
 * check means (the queue page shows the link as before; the alert email sends
 * without links).
 */
export async function pointsNearFeedingSite(
  points: ProximityPoint[],
): Promise<Set<string>> {
  if (!points.length) return new Set();
  const values = sql.join(
    points.map((p, i) => sql`(${i}::int, ${p.lat}::float8, ${p.lng}::float8)`),
    sql`, `,
  );
  const result = await db.execute(sql`
    select p.i
    from (values ${values}) as p(i, lat, lng)
    where exists (
      select 1 from feeding_sites s
      where ${2 * EARTH_RADIUS_M}::float8 * asin(least(1::float8, sqrt(
              power(sin(radians(s.lat - p.lat) / 2), 2)
              + cos(radians(p.lat)) * cos(radians(s.lat))
                * power(sin(radians(s.lng - p.lng) / 2), 2)
            ))) <= ${FEEDING_SITE_RADIUS_M}::float8
    )
  `);
  const near = new Set<string>();
  for (const row of result.rows as { i: number }[]) {
    const p = points[Number(row.i)];
    if (p) near.add(p.key);
  }
  return near;
}

/** Is this one position within 50 m of any feeding site? */
export async function isNearFeedingSite(
  lat: number,
  lng: number,
): Promise<boolean> {
  return (await pointsNearFeedingSite([{ key: "p", lat, lng }])).has("p");
}

/** How long a caller waits for the check before treating it as failed. */
export const FEEDING_SITE_CHECK_TIMEOUT_MS = 2000;

/**
 * Bound the check. The database pool has no query timeout, and neither an
 * urgent alert nor the queue page may wait on a hung query. A timeout rejects,
 * which every caller treats as "the check failed": no map links.
 */
export function withCheckTimeout<T>(
  work: Promise<T>,
  ms: number = FEEDING_SITE_CHECK_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("feeding-site check timed out")),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
