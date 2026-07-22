import {
  pgTable,
  pgEnum,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";

export const catUpdateTypeEnum = pgEnum("cat_update_type", [
  "sighting",
  "desexed",
  "adopted",
  "general",
]);

export const catSubscriptionsTable = pgTable(
  "cat_subscriptions",
  {
    deviceId: text("device_id").notNull(),
    catId: integer("cat_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.catId] })],
);

export const catUpdatesTable = pgTable("cat_updates", {
  id: serial("id").primaryKey(),
  catId: integer("cat_id").notNull(),
  updateType: catUpdateTypeEnum("update_type").notNull(),
  message: text("message").notNull(),
  triggerSightingId: integer("trigger_sighting_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  catUpdateId: integer("cat_update_id").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const pushTokensTable = pgTable("push_tokens", {
  deviceId: text("device_id").primaryKey(),
  token: text("token").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CatSubscription = typeof catSubscriptionsTable.$inferSelect;
export type CatUpdate = typeof catUpdatesTable.$inferSelect;
export type NotificationRow = typeof notificationsTable.$inferSelect;
export type PushToken = typeof pushTokensTable.$inferSelect;
