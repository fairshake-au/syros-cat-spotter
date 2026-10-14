import {
  date,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// SYC-105 PR 2.1: rate limits counted in Postgres, so a limit holds across
// every running copy of the server and survives a restart.
//
// An address is never stored in the clear. `key` is a SHA-256 of the address after
// it has been grouped the way the limits group it (an IPv6 address by its
// /56 network, an IPv4-mapped one as the IPv4 one) and of that day's salt.
// The salt sits in the same database for up to about 48 hours, so this is
// pseudonymous, not anonymous. A verified device id is hashed the same way.
// Each row keeps its window's length, so the sweep removes a window only once
// it has ended (a day-long limit survives the hourly sweep). Old windows are swept from
// the mail drain (artifacts/api-server/src/lib/limits.ts).
export const rateLimitCountersTable = pgTable(
  "rate_limit_counters",
  {
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowMs: integer("window_ms").notNull(),
    hits: integer("hits").notNull(),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.key, t.windowStart] })],
);

// One row per day. The server makes the salt itself (random bytes, inserted
// the first time a day is seen), so there is no secret to configure. A new
// day's salt makes yesterday's keys unrecoverable.
export const rateLimitSaltsTable = pgTable("rate_limit_salts", {
  day: date("day").primaryKey(),
  salt: text("salt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
