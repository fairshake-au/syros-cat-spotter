import { pool } from "@workspace/db";

/**
 * Tests only (SYC-298). The database refuses to delete a feeding site or a
 * colony (migration "refuse_deleting_sites_and_colonies"). A test cleaning up
 * its own rows switches that one trigger off for one statement, inside a
 * transaction, and back on: the same way the other guards are bypassed.
 */
const GUARDS = {
  feeding_sites: "feeding_sites_never_deleted",
  colonies: "colonies_never_deleted",
} as const;

/**
 * Runs one `delete from <table> where ...` with that table's never-deleted
 * guard off. `where` and `params` are the test's own SQL, never user input.
 */
export async function deleteTestRows(
  table: keyof typeof GUARDS,
  where: string,
  params: unknown[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`alter table ${table} disable trigger ${GUARDS[table]}`);
    await client.query(`delete from ${table} where ${where}`, params);
    await client.query(`alter table ${table} enable trigger ${GUARDS[table]}`);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
