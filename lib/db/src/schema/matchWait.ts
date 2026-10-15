import { date, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// SYC-36 / SYC-48 (match-wait plan, PR 1, Samuel's Decision 1): the switches
// the team can change without a new app. One row per key; the server reads
// them through artifacts/api-server/src/lib/appSettings.ts, which knows the
// three keys, checks each value's shape and falls back to a safe default for a
// missing or wrongly shaped row. Until the team dashboard has a page for them
// (SYC-383), they are changed with `db-ops set-setting`.
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// SYC-36 (Samuel's Decisions 5 and 6 on the feeding nudge): how many times
// "Help feed a cat" was tapped, one number per Athens calendar day. Nothing
// about who tapped is kept: no device, address, name or place.
export const donationLinkTapsTable = pgTable("donation_link_taps", {
  day: date("day").primaryKey(),
  taps: integer("taps").notNull().default(0),
});
