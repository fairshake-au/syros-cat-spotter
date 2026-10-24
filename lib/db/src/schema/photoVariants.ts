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
import { photosTable } from "./photos";

/**
 * Small and medium copies of each catalogue photo (SYC-396 PR 1.2; team
 * dashboard redesign spec §11). Lists and grids load these, never the
 * full-size photo, so they stay quick on island mobile data.
 *
 * One row per photo and size: "small" (about 160 px wide) and "medium" (about
 * 640 px wide), both JPEG with no location data. Made on first request and
 * kept. Removing a photo removes its versions with it (the cascade). The
 * versions are only ever served through the visibility-checked team route.
 */

export const photoVariantsTable = pgTable(
  "photo_variants",
  {
    photoId: integer("photo_id")
      .notNull()
      .references(() => photosTable.id, { onDelete: "cascade" }),
    size: text("size").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.photoId, t.size] }),
    check("photo_variants_size_ck", sql`${t.size} in ('small','medium','card')`),
  ],
);
