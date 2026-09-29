import type { ClientBase } from "pg";

/**
 * SYC-121, task B.3. The `switchover` schema sits outside `public`, so it
 * never affects the runner's exact-match baseline adoption, which compares
 * `public` only.
 */
export const SWITCHOVER_SCHEMA = "switchover";
const MARKER_TABLE = `"${SWITCHOVER_SCHEMA}"."rehearsal_marker"`;
const CUTOVER_TABLE = `"${SWITCHOVER_SCHEMA}"."cutover_done"`;

export type GuardMode = "rehearsal" | "cutover";

export class GuardRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardRefusedError";
  }
}

async function ensureSwitchoverSchema(client: ClientBase): Promise<void> {
  await client.query(`create schema if not exists "${SWITCHOVER_SCHEMA}"`);
  await client.query(
    `create table if not exists ${MARKER_TABLE} (
       id boolean primary key default true,
       created_at timestamptz not null default now(),
       constraint rehearsal_marker_singleton check (id)
     )`,
  );
  await client.query(
    `create table if not exists ${CUTOVER_TABLE} (
       id boolean primary key default true,
       created_at timestamptz not null default now(),
       source_fingerprint text not null,
       constraint cutover_done_singleton check (id)
     )`,
  );
}

async function hasRow(client: ClientBase, table: string): Promise<boolean> {
  const r = await client.query(`select 1 from ${table} limit 1`);
  return (r.rowCount ?? 0) > 0;
}

async function publicHasTables(client: ClientBase): Promise<boolean> {
  const r = await client.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' limit 1`,
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Refuses if `switchover.cutover_done` exists (R5: this branch has already
 * been cut over). In cutover mode, also refuses if `public` has any table
 * and there is no `rehearsal_marker` (a target must either be empty, or
 * carry a marked rehearsal copy, before a cutover copy overwrites it).
 * Otherwise drops `public` and `drizzle` and recreates an empty `public`.
 * Never drops `rehearsal_marker`: it stays until `mark --mode cutover`
 * replaces it, so a copy that fails anywhere before its last step can
 * always be retried.
 */
export async function guardTarget(
  client: ClientBase,
  mode: GuardMode,
): Promise<void> {
  await ensureSwitchoverSchema(client);

  if (await hasRow(client, CUTOVER_TABLE)) {
    throw new GuardRefusedError(
      "This branch already has switchover.cutover_done: it has already been cut over. Refusing.",
    );
  }

  if (mode === "cutover") {
    const hasTables = await publicHasTables(client);
    const hasMarker = await hasRow(client, MARKER_TABLE);
    if (hasTables && !hasMarker) {
      throw new GuardRefusedError(
        "public has tables and there is no rehearsal_marker: refusing a cutover copy onto an unmarked target.",
      );
    }
  }

  await client.query(`drop schema if exists "public" cascade`);
  await client.query(`create schema "public"`);
  await client.query(`drop schema if exists "drizzle" cascade`);
}

/**
 * The last step of a copy. In rehearsal mode, writes (or rewrites) the
 * `rehearsal_marker` row. In cutover mode, deletes `rehearsal_marker` and
 * writes `cutover_done` in one transaction, so the two are never both
 * present and never both absent, even if the process is killed between
 * them.
 */
export async function mark(
  client: ClientBase,
  mode: GuardMode,
  sourceFingerprint: string,
): Promise<void> {
  await ensureSwitchoverSchema(client);
  await client.query("begin");
  try {
    if (mode === "rehearsal") {
      await client.query(`delete from ${MARKER_TABLE}`);
      await client.query(`insert into ${MARKER_TABLE} (id) values (true)`);
    } else {
      await client.query(`delete from ${MARKER_TABLE}`);
      await client.query(`delete from ${CUTOVER_TABLE}`);
      await client.query(
        `insert into ${CUTOVER_TABLE} (id, source_fingerprint) values (true, $1)`,
        [sourceFingerprint],
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}

export async function cutoverDone(client: ClientBase): Promise<boolean> {
  await ensureSwitchoverSchema(client);
  return hasRow(client, CUTOVER_TABLE);
}

export async function rehearsalMarked(client: ClientBase): Promise<boolean> {
  await ensureSwitchoverSchema(client);
  return hasRow(client, MARKER_TABLE);
}
