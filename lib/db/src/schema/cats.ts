import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  serial,
  integer,
  doublePrecision,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { foldNameSql } from "../foldSql";

export const catsTable = pgTable(
  "cats",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // SYC-101 (DECISIONS.md Part 2g): the name folded the way `foldName`
    // folds it (accents, case, final sigma, NFC). The database computes it
    // from `name` on every insert and rename, so no writer can forget it or
    // let it go stale. Uniqueness is on this, not on the name as typed,
    // which is still what everyone sees.
    normalisedName: text("normalised_name")
      .notNull()
      .generatedAlwaysAs(sql.raw(foldNameSql(`"name"`))),
    description: text("description").notNull().default(""),
    primaryPhotoId: integer("primary_photo_id").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    // Null only once deletion has unlinked the discoverer (SYC-63); the cat
    // then credits "a spotter". The check below refuses an unstamped null.
    discovererDeviceId: text("discoverer_device_id"),
    ownerDeviceId: text("owner_device_id"),
    ownerName: text("owner_name"),
    homeDescription: text("home_description"),
    // Where the owner says the cat lives (claiming-a-cat.md §5): seen only by
    // the owner and the team, never public, kept on deletion (D13).
    homeLat: doublePrecision("home_lat"),
    homeLng: doublePrecision("home_lng"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // When deletion unlinked this cat's discoverer, and why (§8.5).
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
    redactionReason: text("redaction_reason"),
  },
  (table) => [
    // One cat per folded name: "ΜΙΜΗ" and "Μιμή", "ΣΟΦΊΑΣ" and "Σοφίας",
    // "Zoë" and "Zoe" are each one name. Replaces cats_name_lower_unique.
    uniqueIndex("cats_normalised_name_unique").on(table.normalisedName),
    check(
      "cats_discoverer_ck",
      sql`${table.discovererDeviceId} is not null or ${table.redactedAt} is not null`,
    ),
    check(
      "cats_home_pin_ck",
      sql`(${table.homeLat} is null) = (${table.homeLng} is null)`,
    ),
  ],
);

export type Cat = typeof catsTable.$inferSelect;
