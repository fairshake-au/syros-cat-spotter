import { appSettingsTable, db, mappingEventsTable, peopleTable, settingShapeProblem } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { clearAppSettingsCache, settingsFromRows } from "./appSettings";
import { recordMappingEvent } from "./mappingEvents";

// The Vet settings (SYC-396 PR 3.1b; dashboard §8.4, §10.3): the standard
// sterilisation price, in whole euros, with its history. **This is the only
// writer of the price from the app.** (`db-ops set-setting` can still change
// it, as a fallback, and leaves no history row.) Each change runs in one
// transaction: the setting and its `vet_settings` / `price_changed` history
// row commit or fail together. Then this server's settings cache is cleared,
// so it uses the new price at once; other servers within SETTINGS_CACHE_MS.
//
// This module reads and writes mapping_events, so it is registered in
// guardianView.source.test.ts ISLAND_ONLY_MODULES: a route calls it only
// behind `edit_vet_settings` (island-only).

const KEY = "standard_sterilisation_price_eur";
/** There is one set of vet settings: its history rows are all subject 1. */
const SUBJECT_ID = 1;

export class PriceRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceRefused";
  }
}

/** A history row's `{ eur }`, if it still holds one (not redacted). */
function priceOf(v: unknown): number | null {
  if (typeof v !== "object" || v === null) return null;
  const eur = (v as Record<string, unknown>).eur;
  return typeof eur === "number" ? eur : null;
}

/**
 * Changes the standard price, with its history row, in one transaction.
 * Returns the price before and after. Throws {@link PriceRefused} for a price
 * that isn't a whole number of euros from 1 to 500, or that it already is.
 */
export async function setStandardPrice(
  person: { id: string },
  eur: number,
): Promise<{ before: number; after: number }> {
  if (settingShapeProblem(KEY, eur)) throw new PriceRefused("Type a whole number of euros from 1 to 500.");
  const result = await db.transaction(async (tx) => {
    // One change at a time, even when there is no row yet to lock, so each
    // history row's `before` is the price the change really replaced.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vet_settings.standard_price'))`);
    const rows = await tx
      .select({ key: appSettingsTable.key, value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, KEY));
    // The price the app has been using: the stored one, or the default for a
    // missing or wrongly shaped row (as getAppSettings reads it).
    const before = settingsFromRows(rows).sterilisationPriceEur;
    if (before === eur) throw new PriceRefused(`The standard price is already €${eur}.`);
    await tx
      .insert(appSettingsTable)
      .values({ key: KEY, value: eur })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: eur, updatedAt: sql`now()` } });
    await recordMappingEvent(tx, {
      personId: person.id,
      subjectKind: "vet_settings",
      subjectId: SUBJECT_ID,
      kind: "price_changed",
      before: { eur: before },
      after: { eur },
    });
    return { before, after: eur };
  });
  clearAppSettingsCache();
  return result;
}

/**
 * The standard price as the database has it now, read past the settings
 * cache, for the Vet settings page. Unlike getAppSettings it throws if the
 * database can't be read: the page must never show a price it didn't read.
 */
export async function standardPriceNow(): Promise<number> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, KEY));
  return settingsFromRows(rows).sterilisationPriceEur;
}

/** One line of the Vet settings page's history. */
export interface PriceChange {
  at: Date;
  /** The person's name, or null for a row the app wrote itself. */
  who: string | null;
  before: number | null;
  after: number | null;
}

/** The latest changes to the price, newest first, with who made them. */
export async function priceChanges(limit = 50): Promise<PriceChange[]> {
  const rows = await db
    .select({
      at: mappingEventsTable.at,
      who: peopleTable.name,
      before: mappingEventsTable.before,
      after: mappingEventsTable.after,
    })
    .from(mappingEventsTable)
    .leftJoin(peopleTable, eq(peopleTable.id, mappingEventsTable.personId))
    .where(eq(mappingEventsTable.subjectKind, "vet_settings"))
    // By id, the order the changes really committed in (as areaHistory.ts).
    .orderBy(desc(mappingEventsTable.id))
    .limit(limit);
  return rows.map((r) => ({ at: r.at, who: r.who ?? null, before: priceOf(r.before), after: priceOf(r.after) }));
}
