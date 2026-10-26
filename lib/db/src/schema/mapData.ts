import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { bytea } from "./bytea";

/**
 * The dashboard map's style and font files (SYC-705 Phase 2). The dashboard
 * may load files only from its own address, so the server keeps a copy of each
 * map data file here, as fetched, instead of the browser reaching out for it.
 * Postgres, not disk: Replit's disk doesn't survive a restart.
 *
 * One row per file per version. `version` is the map data release the file
 * belongs to; `path` is the file's path inside it (for example a style file or
 * a font range). `sha256` is the lowercase hex digest of `bytes`, and `size`
 * the byte count, which the check below keeps honest.
 *
 * These are public map files, not anyone's position or data.
 */

export const mapDataFilesTable = pgTable(
  "map_data_files",
  {
    version: integer("version").notNull(),
    path: text("path").notNull(),
    bytes: bytea("bytes").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "map_data_files_version_path_pk",
      columns: [t.version, t.path],
    }),
    check("map_data_files_version_ck", sql`${t.version} > 0`),
    check("map_data_files_sha256_ck", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("map_data_files_size_ck", sql`${t.size} = octet_length(${t.bytes})`),
  ],
);

export type MapDataFile = typeof mapDataFilesTable.$inferSelect;
