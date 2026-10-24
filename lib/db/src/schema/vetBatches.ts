import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { catsTable } from "./cats";
import { coloniesTable } from "./colonies";
import { peopleTable } from "./people";
import { photosTable } from "./photos";

/**
 * Vet visit batches (SYC-677): one day's round of cats at the vet, entered
 * as a draft until saved. A batch is one clinic day with at most one place
 * (a colony or an area, never both); each row in vet_batch_cats is one cat
 * in the round, matched to an existing cat or described as a new one.
 */
export const vetBatchesTable = pgTable(
  "vet_batches",
  {
    id: serial("id").primaryKey(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => peopleTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    savedAt: timestamp("saved_at", { withTimezone: true }),
    // YYYY-MM-DD
    date: text("date").notNull(),
    clinicId: text("clinic_id"),
    colonyId: integer("colony_id").references(() => coloniesTable.id),
    areaKey: text("area_key"),
    priceEur: numeric("price_eur", { precision: 7, scale: 2 }),
    paidBy: text("paid_by").notNull().default(""),
    vaccines: jsonb("vaccines").notNull().default(sql`'[]'::jsonb`),
    vaccineOther: text("vaccine_other").notNull().default(""),
    note: text("note").notNull().default(""),
  },
  (t) => [
    check(
      "vet_batches_place_ck",
      sql`${t.colonyId} is null or ${t.areaKey} is null`,
    ),
  ],
);

export const vetBatchCatsTable = pgTable(
  "vet_batch_cats",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => vetBatchesTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    catId: integer("cat_id").references(() => catsTable.id),
    // { name: string | null, description: string }
    newCat: jsonb("new_cat"),
    confirmed: boolean("confirmed").notNull().default(false),
    did: jsonb("did").notNull().default(sql`'[]'::jsonb`),
    treatedNote: text("treated_note").notNull().default(""),
    // As typed.
    costEur: text("cost_eur").notNull().default(""),
    // Blank means "as the batch".
    paidBy: text("paid_by").notNull().default(""),
    note: text("note").notNull().default(""),
    alsoSameDay: boolean("also_same_day").notNull().default(false),
    suggestions: jsonb("suggestions"),
  },
  (t) => [
    index("vet_batch_cats_batch_idx").on(t.batchId, t.position),
    check(
      "vet_batch_cats_identity_ck",
      sql`${t.catId} is null or ${t.newCat} is null`,
    ),
  ],
);

export const vetBatchPhotosTable = pgTable(
  "vet_batch_photos",
  {
    id: serial("id").primaryKey(),
    batchCatId: integer("batch_cat_id")
      .notNull()
      .references(() => vetBatchCatsTable.id, { onDelete: "cascade" }),
    photoId: integer("photo_id")
      .notNull()
      .references(() => photosTable.id),
    position: integer("position").notNull(),
  },
  (t) => [index("vet_batch_photos_cat_idx").on(t.batchCatId, t.position)],
);

/** The kept photos of a saved visit. Add-only. */
export const vetVisitPhotosTable = pgTable("vet_visit_photos", {
  photoId: integer("photo_id")
    .primaryKey()
    .references(() => photosTable.id),
  // The vet-visit observation. Deliberately not a foreign key: nothing
  // references `observations` (it is append-only, and a FK would stop
  // TRUNCATE reaching its guard trigger), the same as cat_identity.
  visitId: integer("visit_id").notNull(),
  catId: integer("cat_id")
    .notNull()
    .references(() => catsTable.id),
});

export type VetBatch = typeof vetBatchesTable.$inferSelect;
export type VetBatchCat = typeof vetBatchCatsTable.$inferSelect;
export type VetBatchPhoto = typeof vetBatchPhotosTable.$inferSelect;
export type VetVisitPhoto = typeof vetVisitPhotosTable.$inferSelect;
