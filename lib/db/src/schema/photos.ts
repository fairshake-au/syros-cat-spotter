import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const photosTable = pgTable("photos", {
  id: serial("id").primaryKey(),
  data: text("data").notNull(), // base64-encoded image
  mime: text("mime").notNull().default("image/jpeg"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Photo = typeof photosTable.$inferSelect;
