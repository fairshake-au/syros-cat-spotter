import {
  createThrowawayDatabase,
  dropThrowawayDatabase,
} from "@workspace/db/testDatabase";

/**
 * SYC-111. Before any test file runs, create a fresh, disposable database
 * on the same Postgres server DATABASE_URL points at, apply every
 * checked-in migration to it (triggers included — so an append-only table
 * behaves exactly as it does in production), and point DATABASE_URL at it
 * for the rest of the run. `@workspace/db`'s pool is a module-level
 * singleton created from `process.env.DATABASE_URL` at import time
 * (src/index.ts), so this must run — and finish — before any test file
 * imports `../app` (which imports `@workspace/db`). Vitest's globalSetup
 * runs once, in the main process, strictly before test files are loaded,
 * and `process.env` changes made here are inherited by the worker(s) that
 * load and run those files.
 *
 * Previously every test file shared one fixed database (CI's
 * `catspotter_test`, migrated by api-server's old `pretest` script) and
 * cleaned up after itself with `delete from ...`. That breaks the moment a
 * table is append-only (SYC-111's trigger proof, and the "sightings"
 * append-only guard this unblocks) — a shared database and delete-based
 * cleanup can never work with a table that refuses delete. A throwaway
 * database per run sidesteps the problem entirely: nothing needs to be
 * deleted, because the whole database is dropped at the end.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error(
      "DATABASE_URL must be set, pointing at a local or CI Postgres server " +
        "(never Neon production or development) — api-server's tests create " +
        "their own throwaway database on it.",
    );
  }

  const { url, name } = await createThrowawayDatabase(baseUrl, {
    prefix: "api_server_test",
  });
  process.env.DATABASE_URL = url;

  return async () => {
    // DATABASE_URL is restored first so a later hook (or a future test
    // runner reusing this process) never ends up pointed at a database
    // that's about to be dropped.
    process.env.DATABASE_URL = baseUrl;
    await dropThrowawayDatabase(baseUrl, name);
  };
}
