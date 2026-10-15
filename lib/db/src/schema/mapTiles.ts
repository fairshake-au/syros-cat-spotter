import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
} from "drizzle-orm/pg-core";
import { bytea } from "./bytea";

/**
 * The team map's picture cache (SYC-209 PR 3.1; feeding-sites spec §3,
 * §11.4). The dashboard has no scripts and may load pictures only from its
 * own address, so the server fetches each OpenStreetMap tile once and keeps
 * it here. Postgres, not disk: Replit's disk doesn't survive a restart, and
 * photos already live in Postgres.
 *
 * One row per OpenStreetMap tile, as the provider sent it (256 px PNG). The
 * smaller pictures phones are shown are made from it on the way out, so one
 * row serves every size. `size` is the row's byte count, for the 200 MB cap
 * (oldest `fetched_at` out first); a row older than 30 days is fetched again.
 *
 * Only Syros at zooms 12–19 is ever stored: the tile route refuses anything
 * else before it looks here, and the zoom check below holds the line too.
 *
 * Map pictures are public map data, not anyone's position, but which tiles
 * are here says which streets the team has looked at. The table is never
 * read by a public route and its rows are never logged.
 */

export const mapTileCacheTable = pgTable(
  "map_tile_cache",
  {
    z: smallint("z").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    bytes: bytea("bytes").notNull(),
    size: integer("size").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.z, t.x, t.y] }),
    index("map_tile_cache_fetched_at_idx").on(t.fetchedAt),
    check("map_tile_cache_zoom_ck", sql`${t.z} between 12 and 19`),
    check("map_tile_cache_tile_ck", sql`${t.x} >= 0 and ${t.y} >= 0`),
    check("map_tile_cache_size_ck", sql`${t.size} = octet_length(${t.bytes})`),
  ],
);
