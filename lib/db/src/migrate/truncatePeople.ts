import type pg from "pg";

// Tests only: this switches add-only guards off. Refuse to load anywhere else.
if (!process.env["VITEST"]) {
  throw new Error("truncatePeople is for tests only (VITEST is not set).");
}

// SYC-53 PR 0.1 (review minor 11). `people` is now referenced by tables whose
// TRUNCATE is guarded (photo_visibility_events, mapping_events,
// feeding_site_old_codes and, since this PR, person_events, the record of who
// changed what). A test that clears people with `truncate ... cascade` must
// switch each guard off for that one statement, inside a transaction, and back
// on. Every test that creates people uses this, so a new guarded table is
// added in one place.
const GUARDS: [table: string, trigger: string][] = [
  ["photo_visibility_events", "photo_visibility_events_no_truncate"],
  ["mapping_events", "mapping_events_no_truncate"],
  ["feeding_site_old_codes", "feeding_site_old_codes_no_truncate"],
  ["person_events", "person_events_no_truncate"],
  // SYC-298: sites and colonies refuse TRUNCATE too, and people reach them.
  ["feeding_sites", "feeding_sites_no_truncate"],
  ["colonies", "colonies_no_truncate"],
];

/** `truncate <tables> cascade` with the guards the cascade reaches off. */
export async function truncateWithGuardsOff(
  c: pg.Client,
  tables: string,
): Promise<void> {
  await c.query("begin");
  try {
    // A test database migrated only part of the way lacks the newer guards.
    const present = new Set(
      (
        await c.query<{ tgname: string }>(
          `select tgname from pg_trigger where not tgisinternal`,
        )
      ).rows.map((r) => r.tgname),
    );
    const guards = GUARDS.filter(([, trigger]) => present.has(trigger));
    for (const [table, trigger] of guards) {
      await c.query(`alter table ${table} disable trigger ${trigger}`);
    }
    await c.query(`truncate ${tables} cascade`);
    for (const [table, trigger] of guards) {
      await c.query(`alter table ${table} enable trigger ${trigger}`);
    }
    await c.query("commit");
  } catch (err) {
    await c.query("rollback");
    throw err;
  }
}
