import type { ClientBase } from "pg";
import { schemaSignature } from "../migrate/signature";

/**
 * SYC-121, task B.3. The nine baseline tables (from 0000_baseline.sql) and
 * the primary-key columns used to order each table's row hash, so the hash
 * is the same regardless of insert order.
 */
export const BASELINE_TABLES: readonly {
  table: string;
  primaryKey: readonly string[];
}[] = [
  { table: "photos", primaryKey: ["id"] },
  { table: "cats", primaryKey: ["id"] },
  { table: "sightings", primaryKey: ["id"] },
  { table: "profiles", primaryKey: ["device_id"] },
  { table: "cat_subscriptions", primaryKey: ["device_id", "cat_id"] },
  { table: "cat_updates", primaryKey: ["id"] },
  { table: "notifications", primaryKey: ["id"] },
  { table: "push_tokens", primaryKey: ["device_id"] },
  { table: "device_credentials", primaryKey: ["device_id"] },
];

export interface TableFingerprint {
  table: string;
  rows: number;
  hash: string;
}

export interface SequenceFingerprint {
  sequence: string;
  lastValue: number | null;
  maxId: number | null;
}

export interface Fingerprint {
  tables: TableFingerprint[];
  sequences: SequenceFingerprint[];
  serverVersion: string;
  datcollate: string;
  datctype: string;
  encoding: string;
  schemaSignatureHash: string;
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** A table's column in `public`, with its SQL type. */
export interface ColumnInfo {
  name: string;
  /** `format_type(atttypid, atttypmod)`, e.g. `text`, `timestamp with time zone`. */
  type: string;
}

/** A `public` table's columns in column order, or null if there's no such table. */
export async function tableColumns(
  client: ClientBase,
  table: string,
): Promise<ColumnInfo[] | null> {
  const exists = await client.query(
    `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = $1 and c.relkind = 'r'`,
    [table],
  );
  if ((exists.rowCount ?? 0) === 0) return null;
  const r = await client.query<ColumnInfo>(
    `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = $1 and c.relkind = 'r'
        and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [table],
  );
  return r.rows;
}

/**
 * The SQL expression hashed per row. Unprojected, it's the whole row
 * (`t::text`, as the plan specifies, so a copy's fingerprint covers every
 * column). Projected, it's a row built from exactly the named columns, in
 * the given order, so two databases whose tables have different column sets
 * are compared on the columns they share.
 */
export function rowTextExpr(columns?: readonly string[], table?: string): string {
  if (!columns) return "t::text";
  return `row(${columns.map((c) => projectedColumnExpr(table, c)).join(", ")})::text`;
}

/**
 * How one column reads in a projected comparison or copy onto the old
 * database (SYC-462, T17). A photo removed for good has no picture (data
 * null); the old database's photos.data is NOT NULL and has no removed_*
 * columns, so a removed photo goes back, and compares, as an empty picture.
 * Only projected reads use this: a plain fingerprint (`t::text`) is unchanged.
 */
export function projectedColumnExpr(table: string | undefined, column: string): string {
  if (table === "photos" && column === "data") return `coalesce(t."data", '')`;
  return `t.${quoteIdent(column)}`;
}

/**
 * The rows a projected read (a comparison, or carry-back's diff) looks at.
 * Notifications of a kind other than 'cat' (SYC-706's weekly-result bell
 * entries) have no cat_update_id, which the old database cannot hold, so
 * they are not carried back and neither side counts them. A plain
 * fingerprint (no columns) still covers every row. Empty when the client's
 * notifications table has no `kind` column: the old database can't hold
 * such rows at all.
 */
export async function projectedRowFilter(
  client: ClientBase,
  table: string,
  columns?: readonly string[],
): Promise<string> {
  if (!columns || table !== "notifications") return "";
  const cols = await tableColumns(client, table);
  return cols?.some((c) => c.name === "kind") ? ` where t."kind" = 'cat'` : "";
}

async function fingerprintTable(
  client: ClientBase,
  table: string,
  primaryKey: readonly string[],
  columns?: readonly string[],
): Promise<TableFingerprint> {
  const orderBy = primaryKey.map(quoteIdent).join(", ");
  const filter = await projectedRowFilter(client, table, columns);
  const sql = `select count(*)::bigint as rows,
       md5(coalesce(string_agg(md5(${rowTextExpr(columns, table)}), '' order by ${orderBy}), '')) as hash
  from ${quoteIdent(table)} t${filter}`;
  const r = await client.query<{ rows: string; hash: string | null }>(sql);
  const row = r.rows[0]!;
  return {
    table,
    rows: Number(row.rows),
    // string_agg over zero rows is NULL; coalesce above already handles it,
    // but md5('') is a fixed value, so an empty table still gets a hash.
    hash: row.hash ?? "",
  };
}

async function fingerprintSequences(
  client: ClientBase,
  schema: string,
): Promise<SequenceFingerprint[]> {
  const r = await client.query<{
    sequencename: string;
    tablename: string;
    columnname: string;
  }>(
    `select s.relname as sequencename, t.relname as tablename, a.attname as columnname
       from pg_class s
       join pg_depend d on d.objid = s.oid and d.deptype = 'a'
       join pg_class t on t.oid = d.refobjid
       join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
       join pg_namespace n on n.oid = s.relnamespace
      where s.relkind = 'S' and n.nspname = $1
      order by s.relname`,
    [schema],
  );
  const out: SequenceFingerprint[] = [];
  for (const row of r.rows) {
    const lastValueRow = await client.query<{ last_value: string }>(
      `select last_value from ${quoteIdent(row.sequencename)}`,
    );
    const maxRow = await client.query<{ max: string | null }>(
      `select max(${quoteIdent(row.columnname)}) as max from ${quoteIdent(row.tablename)}`,
    );
    out.push({
      sequence: row.sequencename,
      lastValue: lastValueRow.rows[0]
        ? Number(lastValueRow.rows[0].last_value)
        : null,
      maxId:
        maxRow.rows[0] && maxRow.rows[0].max !== null
          ? Number(maxRow.rows[0].max)
          : null,
    });
  }
  return out;
}

/**
 * Fingerprints the nine baseline tables plus sequences, server version,
 * collation, encoding and a hash of the `public` schema signature. Prints
 * hashes and counts, never row contents. Intended to be run in a read-only
 * session (§B.3, R1): callers open the connection with
 * `PGOPTIONS='-c default_transaction_read_only=on'` (or set it per-session),
 * so any write attempt fails with SQLSTATE 25006.
 */
/**
 * The session settings that shape a row's `::text` form. Every fingerprint,
 * compare and carry-back diff runs under exactly these, so the hashes don't
 * depend on either server's defaults (a different default timezone would
 * otherwise change every timestamptz's text, and so every row hash).
 */
export const CANONICAL_SETTINGS: readonly [string, string][] = [
  ["timezone", "UTC"],
  ["datestyle", "ISO, YMD"],
  ["intervalstyle", "postgres"],
  ["extra_float_digits", "1"],
  ["bytea_output", "hex"],
];

/** Applies CANONICAL_SETTINGS for the rest of the current transaction. */
export async function applyCanonicalSettings(client: ClientBase): Promise<void> {
  for (const [name, value] of CANONICAL_SETTINGS) {
    await client.query(`select set_config($1, $2, true)`, [name, value]);
  }
}

export interface FingerprintOptions {
  columns?: ReadonlyMap<string, readonly string[]>;
  /**
   * The caller already has a transaction open on this client (carry-back
   * does): fingerprint applies the canonical settings inside it rather than
   * opening its own read-only transaction.
   */
  inTransaction?: boolean;
}

export async function fingerprint(
  client: ClientBase,
  opts: FingerprintOptions = {},
): Promise<Fingerprint> {
  if (opts.inTransaction) {
    await applyCanonicalSettings(client);
    return fingerprintInSession(client, opts);
  }
  await client.query("begin isolation level repeatable read read only");
  try {
    await applyCanonicalSettings(client);
    return await fingerprintInSession(client, opts);
  } finally {
    await client.query("rollback");
  }
}

async function fingerprintInSession(
  client: ClientBase,
  opts: FingerprintOptions,
): Promise<Fingerprint> {
  const tables: TableFingerprint[] = [];
  for (const t of BASELINE_TABLES) {
    tables.push(
      await fingerprintTable(
        client,
        t.table,
        t.primaryKey,
        opts.columns?.get(t.table),
      ),
    );
  }
  const sequences = await fingerprintSequences(client, "public");
  const serverVersionRow = await client.query<{ server_version: string }>(
    "show server_version",
  );
  const dbRow = await client.query<{
    datcollate: string;
    datctype: string;
    encoding: string;
  }>(
    `select datcollate, datctype, pg_encoding_to_char(encoding) as encoding
       from pg_database where datname = current_database()`,
  );
  const signature = await schemaSignature(client, "public");
  const { createHash } = await import("node:crypto");
  const schemaSignatureHash = createHash("md5")
    .update(signature.join("\n"))
    .digest("hex");
  return {
    tables,
    sequences,
    serverVersion: serverVersionRow.rows[0]!.server_version,
    datcollate: dbRow.rows[0]!.datcollate,
    datctype: dbRow.rows[0]!.datctype,
    encoding: dbRow.rows[0]!.encoding,
    schemaSignatureHash,
  };
}

/** A difference found by `compare`. Never carries row contents. */
export interface CompareDiff {
  kind:
    | "row-count"
    | "row-hash"
    | "sequence"
    | "signature"
    | "encoding"
    | "collation"
    | "table-missing"
    | "column-missing"
    | "index";
  detail: string;
}

export interface CompareOptions {
  /**
   * Compare only the source's columns, and skip the schema signature — used
   * after migrations have added tables/columns Neon has but Replit doesn't.
   */
  projected?: boolean;
  /**
   * Which side's columns a projected comparison uses: `source` (the
   * default, which `verify` needs: Replit's columns, checked on Neon) or
   * `target` (carry-back: the old database's columns, checked against Neon,
   * which is carry-back's source). A projection column the other side lacks
   * is itself a difference.
   */
  onto?: "source" | "target";
  /** Both clients are already inside transactions (see FingerprintOptions). */
  inTransaction?: boolean;
}

/**
 * For a projected comparison: per baseline table, the columns both sides
 * are hashed on (the `onto` side's columns, in its order), plus a
 * difference for each of those columns the other side lacks.
 */
async function projectionColumns(
  source: ClientBase,
  target: ClientBase,
  onto: "source" | "target",
): Promise<{ columns: Map<string, string[]>; diffs: CompareDiff[] }> {
  const columns = new Map<string, string[]>();
  const diffs: CompareDiff[] = [];
  const [from, other] = onto === "source" ? [source, target] : [target, source];
  for (const t of BASELINE_TABLES) {
    const mine = await tableColumns(from, t.table);
    const theirs = await tableColumns(other, t.table);
    if (!mine || !theirs) continue; // fingerprint() fails on a missing table
    const theirNames = new Set(theirs.map((c) => c.name));
    for (const c of mine) {
      if (!theirNames.has(c.name)) {
        diffs.push({
          kind: "column-missing",
          detail: `${t.table}.${c.name}: on the ${onto}, missing on the other side`,
        });
      }
    }
    columns.set(
      t.table,
      mine.filter((c) => theirNames.has(c.name)).map((c) => c.name),
    );
  }
  return { columns, diffs };
}

/**
 * Fingerprints both sides (each read-only) and reports every difference in
 * counts, row hashes, sequences, signature, encoding or collation.
 */
export async function compare(
  source: ClientBase,
  target: ClientBase,
  opts: CompareOptions = {},
): Promise<CompareDiff[]> {
  const diffs: CompareDiff[] = [];
  let columns: Map<string, string[]> | undefined;
  if (opts.projected) {
    const p = await projectionColumns(source, target, opts.onto ?? "source");
    columns = p.columns;
    diffs.push(...p.diffs);
  }
  const inTransaction = opts.inTransaction === true;
  const [a, b] = await Promise.all([
    fingerprint(source, { columns, inTransaction }),
    fingerprint(target, { columns, inTransaction }),
  ]);

  const byTable = new Map(b.tables.map((t) => [t.table, t]));
  for (const t of a.tables) {
    const other = byTable.get(t.table);
    if (!other) {
      diffs.push({
        kind: "table-missing",
        detail: `${t.table}: present on the source, missing on the target`,
      });
      continue;
    }
    if (t.rows !== other.rows) {
      diffs.push({
        kind: "row-count",
        detail: `${t.table}: ${t.rows} rows vs ${other.rows}`,
      });
    } else if (t.hash !== other.hash) {
      diffs.push({
        kind: "row-hash",
        detail: `${t.table}: row hash differs`,
      });
    }
  }

  const seqByName = new Map(b.sequences.map((s) => [s.sequence, s]));
  for (const s of a.sequences) {
    const other = seqByName.get(s.sequence);
    if (!other) continue;
    const behind = (f: SequenceFingerprint) =>
      f.lastValue !== null && f.maxId !== null && f.lastValue < f.maxId;
    if (
      s.lastValue !== other.lastValue ||
      s.maxId !== other.maxId ||
      behind(s) ||
      behind(other)
    ) {
      diffs.push({
        kind: "sequence",
        detail: `${s.sequence}: last_value=${s.lastValue} max=${s.maxId} vs last_value=${other.lastValue} max=${other.maxId}`,
      });
    }
  }

  if (a.encoding !== b.encoding) {
    diffs.push({
      kind: "encoding",
      detail: `${a.encoding} vs ${b.encoding}`,
    });
  }
  if (a.datcollate !== b.datcollate || a.datctype !== b.datctype) {
    diffs.push({
      kind: "collation",
      detail: `datcollate=${a.datcollate}/${a.datctype} vs ${b.datcollate}/${b.datctype}`,
    });
  }
  if (!opts.projected && a.schemaSignatureHash !== b.schemaSignatureHash) {
    diffs.push({
      kind: "signature",
      detail: `schema signature differs: ${a.schemaSignatureHash} vs ${b.schemaSignatureHash}`,
    });
  }

  return diffs;
}
