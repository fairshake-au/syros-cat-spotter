import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// SYC-396 PR 2.4 (team-dashboard-redesign.md §3.3; plan Decision 9): the
// named areas the team can edit. A place belongs to the area whose centre is
// nearest. Rows are never deleted: an area is retired. Every change writes a
// `named_area` row to mapping_events in the same transaction, holding the
// whole row before and after, so the list can be rebuilt as it stood at any
// moment (`namedAreasAt`, artifacts/api-server/src/lib/areas/areaHistory.ts).
//
// Write through `changeArea` (lib/areas/areaWrites.ts), never directly.

export const namedAreasTable = pgTable(
  "named_areas",
  {
    id: serial("id").primaryKey(),
    // Short key used in addresses ("?area=kini"). Never changes. "off" is
    // reserved for Off Syros.
    key: text("key").notNull().unique("named_areas_key_unique"),
    name: text("name").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("named_areas_key_ck", sql`${t.key} ~ '^[a-z][a-z0-9-]{1,30}$' and ${t.key} <> 'off'`),
    // Two areas still in use can't share a name, even in a race.
    uniqueIndex("named_areas_live_name_unique")
      .on(sql`lower(${t.name})`)
      .where(sql`${t.retiredAt} is null`),
  ],
);

export type NamedAreaRow = typeof namedAreasTable.$inferSelect;
