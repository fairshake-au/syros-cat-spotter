import { pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

// SYC-396 PR 3.3a (team-dashboard-redesign.md §9.3): every report download is
// recorded with who, which report, which range and when, but never what was
// in it. Add-only: the migration's trigger refuses any UPDATE, DELETE or
// TRUNCATE. Written before the file is sent (`recordDownload`,
// artifacts/api-server/src/lib/reports/downloads.ts), so a download that
// couldn't be recorded is never sent.

export const reportDownloadsTable = pgTable("report_downloads", {
  id: serial("id").primaryKey(),
  personId: uuid("person_id")
    .notNull()
    .references(() => peopleTable.id),
  /** The report's key, e.g. "progress". */
  report: text("report").notNull(),
  /** The range asked for, as its query string: dates only, e.g. "range=custom&from=2026-08-01&to=2026-09-30". */
  range: text("range").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReportDownload = typeof reportDownloadsTable.$inferSelect;
