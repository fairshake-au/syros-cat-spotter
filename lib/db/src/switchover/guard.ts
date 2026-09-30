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
  // The full source fingerprint (the JSON `switchover fingerprint` printed
  // for the copy's source), kept so a later carry-back can check the old
  // database hasn't changed since this copy was taken (see carryBack.ts).
  for (const table of [MARKER_TABLE, CUTOVER_TABLE]) {
    await client.query(
      `alter table ${table} add column if not exists source_fingerprint_json jsonb`,
    );
  }
}

/**
 * The switchover markers on a database, read without writing anything
 * (safe on a read-only session, and on a database with no `switchover`
 * schema at all, such as the old Replit database).
 */
export interface MarkerState {
  cutoverDone: boolean;
  rehearsalMarked: boolean;
  /** When the marker present was written (cutover_done wins), or null. */
  markedAt: string | null;
  /** The copy's source fingerprint JSON stored with that marker, or null. */
  sourceFingerprintJson: unknown | null;
}

export async function readMarkers(client: ClientBase): Promise<MarkerState> {
  const state: MarkerState = {
    cutoverDone: false,
    rehearsalMarked: false,
    markedAt: null,
    sourceFingerprintJson: null,
  };
  for (const [name, key] of [
    ["cutover_done", "cutoverDone"],
    ["rehearsal_marker", "rehearsalMarked"],
  ] as const) {
    const reg = await client.query<{ t: string | null }>(
      `select to_regclass($1)::text as t`,
      [`"${SWITCHOVER_SCHEMA}"."${name}"`],
    );
    if (!reg.rows[0]?.t) continue;
    const hasJson = await client.query(
      `select 1 from information_schema.columns
        where table_schema = $1 and table_name = $2
          and column_name = 'source_fingerprint_json'`,
      [SWITCHOVER_SCHEMA, name],
    );
    const r = await client.query<{ created_at: string; fp: unknown }>(
      `select created_at::text as created_at,
              ${(hasJson.rowCount ?? 0) > 0 ? "source_fingerprint_json" : "null"} as fp
         from "${SWITCHOVER_SCHEMA}"."${name}" limit 1`,
    );
    const row = r.rows[0];
    if (!row) continue;
    state[key] = true;
    if (state.markedAt === null) {
      state.markedAt = row.created_at;
      state.sourceFingerprintJson = row.fp ?? null;
    }
  }
  return state;
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
 *
 * `sourceFingerprintJson`, when given, is the copy source's full
 * fingerprint (the JSON `switchover fingerprint` prints: counts and hashes,
 * never row contents). It's stored with the marker so carry-back can later
 * prove the old database hasn't changed since this copy.
 */
export async function mark(
  client: ClientBase,
  mode: GuardMode,
  sourceFingerprint: string,
  sourceFingerprintJson?: unknown,
): Promise<void> {
  await ensureSwitchoverSchema(client);
  const json =
    sourceFingerprintJson === undefined
      ? null
      : JSON.stringify(sourceFingerprintJson);
  await client.query("begin");
  try {
    if (mode === "rehearsal") {
      await client.query(`delete from ${MARKER_TABLE}`);
      await client.query(
        `insert into ${MARKER_TABLE} (id, source_fingerprint_json) values (true, $1::jsonb)`,
        [json],
      );
    } else {
      await client.query(`delete from ${MARKER_TABLE}`);
      await client.query(`delete from ${CUTOVER_TABLE}`);
      await client.query(
        `insert into ${CUTOVER_TABLE} (id, source_fingerprint, source_fingerprint_json)
         values (true, $1, $2::jsonb)`,
        [sourceFingerprint, json],
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
