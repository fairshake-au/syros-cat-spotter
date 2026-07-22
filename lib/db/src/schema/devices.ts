import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Server-side device credentials.
 *
 * Device ids are client-generated identifiers that unavoidably appear in
 * request paths/bodies, so they cannot serve as a secret on their own.
 * Each device also generates a private `deviceSecret`, sent only via the
 * `X-Device-Secret` header. The server stores a sha256 hash of it,
 * bound to the device id on first authenticated use (trust-on-first-use),
 * and requires a matching secret for owner-only endpoints thereafter.
 */
export const deviceCredentialsTable = pgTable("device_credentials", {
  deviceId: text("device_id").primaryKey(),
  secretHash: text("secret_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
