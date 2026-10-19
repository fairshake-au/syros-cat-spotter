import { createHash } from "node:crypto";
import type { ClientBase } from "pg";
import {
  BASELINE_TABLES,
  compare,
  applyCanonicalSettings,
  fingerprint,
  quoteIdent,
  projectedColumnExpr,
  rowTextExpr,
  tableColumns,
  type ColumnInfo,
  type CompareDiff,
} from "./fingerprint";
import { readMarkers } from "./guard";

/**
 * SYC-121, task B.3: carry-back. Copies testers' writes on Neon back into
 * the old database during a rollback (plan Part F.2/F.3). See
 * docs/superpowers/plans/syc-121-neon-switchover.md, §B.3 "Carry-back".
 *
 * `source` is Neon production (read only, always). `target` is the old
 * database (the old Replit production in a real rollback, or Neon's
 * `rehearsal` branch standing in for it in D.5).
 *
 * It makes each of the nine baseline tables in the target equal to the
 * source's rows, projected onto the target's columns, by primary key:
 * rows only on the source are inserted, rows on both with different values
 * are updated, rows only on the target are deleted. Inserts and updates go
 * parents first, deletes children first, following the target's foreign
 * keys. Each serial sequence is then moved past every id either side has
 * used. A projected compare runs inside the same transaction, and the
 * transaction commits only if the target now matches exactly.
 *
 * Without `apply` (the default) it's a dry run: both sessions are read-only
 * transactions, and it only reports what it would do.
 *
 * Safety checks, all before anything is written:
 *  - The source must carry a switchover marker (it's a Neon copy); the
 *    target must not carry `cutover_done` (that's a live Neon production,
 *    never a carry-back target); and they must not be the same database.
 *  - Every column the target has must exist on the source. Otherwise the
 *    old schema isn't the baseline, so it stops (R0, plan test 5).
 *  - **The old database must be unchanged since the copy.** The source's
 *    marker stores the copy source's fingerprint (per-table row hashes of
 *    the old database at copy time). Any table that has changed on the
 *    target since then, and that the carry-back would write to, is refused:
 *    its new rows could share ids with testers' rows on Neon (an id
 *    collision), and mirroring would overwrite or delete them. Those need
 *    recovering by hand (F.3). A table that already equals the source is
 *    fine, which is what makes a re-run after a successful apply a no-op.
 *
 *    After a successful apply, carry-back records the target's new
 *    fingerprint in `switchover.carry_back_done` (created on the old
 *    database at apply time only, as part of the approved write, and
 *    outside `public`). A later pass accepts a table matching either the
 *    copy's fingerprint or that anchor, but only an anchor recorded against
 *    the same copy. So a second pass works after testers write again, and
 *    anyone else's writes are still refused.
 *
 * Unique indexes (the baseline's lower(name) and lower(username)) are
 * dropped for the writes and rebuilt exactly. Unique *constraints* aren't:
 * the baseline has none, and R0 forbids changing the old database's schema.
 * One added later would make a value moving between rows refuse, and roll
 * back cleanly.
 *
 * It reports primary keys only, never row contents.
 */

export interface CarryBackTableReport {
  table: string;
  /** Primary-key values (never row contents) of rows that would be/were inserted. */
  toInsert: PkValue[];
  /** Primary-key values of rows that would be/were updated. */
  toUpdate: PkValue[];
  /** Primary-key values of rows that would be/were deleted. */
  toDelete: PkValue[];
}

/** A primary key: a number (integer keys), a string, or an object (composite keys). */
export type PkValue = number | string | Record<string, number | string>;

export interface CarryBackSequenceReport {
  sequence: string;
  /** The target's last_value before (null when the sequence was never used). */
  from: number | null;
  /** What it is (or would be) set to, so nextval returns to + 1. */
  to: number;
}

export type BaselineStatus =
  /** The target is unchanged since the copy, wherever the carry-back writes. */
  | "ok"
  /** Some tables changed on the target since the copy: apply is refused. */
  | "changed"
  /** The source's marker has no stored copy fingerprint: apply is refused. */
  | "missing";

export interface CarryBackReport {
  /** Per baseline table, what changed (or would change without --apply). */
  tables: CarryBackTableReport[];
  /**
   * Tables the old (target) database doesn't have at all, added by a
   * migration after the baseline, that hold rows on the source. They stay on
   * Neon ("no home in the old database"). Names only, never contents.
   */
  noHomeInTarget: string[];
  /** Row counts for `noHomeInTarget`. */
  noHomeRows: Record<string, number>;
  /** Source columns the target lacks (their values stay on Neon only). */
  droppedColumns: { table: string; columns: string[] }[];
  sequences: CarryBackSequenceReport[];
  baseline: { status: BaselineStatus; changedTables: string[] };
  applied: boolean;
}

export interface CarryBackOptions {
  /** Without this, carryBack is a dry run: it reports and changes nothing. */
  apply?: boolean;
}

/** Refused before writing anything: the report says why. */
export class CarryBackRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CarryBackRefusedError";
  }
}

/** The target didn't match the source after the writes: rolled back. */
export class CarryBackVerifyError extends Error {
  constructor(
    message: string,
    readonly diffs: CompareDiff[],
  ) {
    super(message);
    this.name = "CarryBackVerifyError";
  }
}

interface TablePlan {
  table: string;
  primaryKey: readonly string[];
  /** The target's columns (the projection), with the target's types. */
  columns: ColumnInfo[];
  inserts: string[];
  updates: string[];
  deletes: string[];
  /** key -> primary-key texts, for every key in inserts/updates/deletes. */
  pkTexts: Map<string, string[]>;
}

const INTEGER_TYPES = new Set(["integer", "bigint", "smallint"]);

async function databaseIdentity(client: ClientBase): Promise<string> {
  const r = await client.query<{ id: string }>(
    `select concat_ws('|', current_database(), pg_postmaster_start_time()::text,
                      coalesce(inet_server_addr()::text, 'local'),
                      coalesce(inet_server_port()::text, '')) as id`,
  );
  return r.rows[0]!.id;
}

async function publicTables(client: ClientBase): Promise<string[]> {
  const r = await client.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
  );
  return r.rows.map((row) => row.relname);
}

/**
 * The nine tables, parents before children, following the target's foreign
 * keys among them. Ties keep BASELINE_TABLES' order. Self-references are
 * ignored (the baseline has none).
 */
async function parentsFirst(target: ClientBase): Promise<string[]> {
  const names = BASELINE_TABLES.map((t) => t.table);
  const r = await target.query<{ child: string; parent: string }>(
    `select c.relname as child, p.relname as parent
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join pg_class p on p.oid = k.confrelid
       join pg_namespace n on n.oid = c.relnamespace
      where k.contype = 'f' and n.nspname = 'public'`,
  );
  const parents = new Map<string, Set<string>>(names.map((n) => [n, new Set()]));
  for (const { child, parent } of r.rows) {
    if (child === parent) continue;
    if (parents.has(child) && parents.has(parent)) parents.get(child)!.add(parent);
  }
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < names.length) {
    const next = names.find(
      (n) => !done.has(n) && [...parents.get(n)!].every((p) => done.has(p)),
    );
    if (!next) {
      throw new CarryBackRefusedError(
        "The baseline tables' foreign keys form a cycle on the target; carry-back can't order its writes.",
      );
    }
    order.push(next);
    done.add(next);
  }
  return order;
}

async function rowKeys(
  client: ClientBase,
  table: string,
  primaryKey: readonly string[],
  columns: readonly string[],
): Promise<Map<string, { pk: string[]; hash: string }>> {
  const pkSelect = primaryKey
    .map((c, i) => `t.${quoteIdent(c)}::text as "k${i}"`)
    .join(", ");
  const r = await client.query<Record<string, string>>(
    `select ${pkSelect}, md5(${rowTextExpr(columns, table)}) as "h" from ${quoteIdent(table)} t`,
  );
  const out = new Map<string, { pk: string[]; hash: string }>();
  for (const row of r.rows) {
    const pk = primaryKey.map((_, i) => row[`k${i}`]!);
    out.set(JSON.stringify(pk), { pk, hash: row.h! });
  }
  return out;
}

function pkValue(plan: TablePlan, key: string): PkValue {
  const texts = plan.pkTexts.get(key)!;
  const typed = plan.primaryKey.map((name, i) => {
    const type = plan.columns.find((c) => c.name === name)?.type ?? "text";
    return INTEGER_TYPES.has(type) ? Number(texts[i]) : texts[i]!;
  });
  if (typed.length === 1) return typed[0]!;
  return Object.fromEntries(plan.primaryKey.map((name, i) => [name, typed[i]!]));
}

function sortKeys(keys: string[]): string[] {
  return keys.sort((a, b) => {
    const pa = JSON.parse(a) as string[];
    const pb = JSON.parse(b) as string[];
    // Numeric order only for keys that are whole integers (so "" or " "
    // never becomes 0); everything else sorts as text.
    const isInt = (s: string) => /^-?\d+$/.test(s);
    for (let i = 0; i < pa.length; i++) {
      const c =
        isInt(pa[i]!) && isInt(pb[i]!)
          ? Number(pa[i]) - Number(pb[i])
          : pa[i]!.localeCompare(pb[i]!);
      if (c !== 0) return c;
    }
    return 0;
  });
}

interface SequenceInfo {
  sequence: string;
  table: string;
  column: string;
}

async function ownedSequences(
  client: ClientBase,
  tables: readonly string[],
): Promise<SequenceInfo[]> {
  const r = await client.query<SequenceInfo>(
    `select s.relname as sequence, t.relname as table, a.attname as column
       from pg_class s
       join pg_depend d on d.objid = s.oid and d.deptype = 'a'
       join pg_class t on t.oid = d.refobjid
       join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
       join pg_namespace n on n.oid = s.relnamespace
      where s.relkind = 'S' and n.nspname = 'public' and t.relname = any($1)
      order by s.relname`,
    [tables as string[]],
  );
  return r.rows;
}

/** The highest value a sequence has handed out, or null if it never has. */
async function sequenceUsed(
  client: ClientBase,
  sequence: string,
): Promise<{ lastValue: number; isCalled: boolean } | null> {
  const exists = await client.query<{ t: string | null }>(
    `select to_regclass($1)::text as t`,
    [`public.${quoteIdent(sequence)}`],
  );
  if (!exists.rows[0]?.t) return null;
  const r = await client.query<{ last_value: string; is_called: boolean }>(
    `select last_value, is_called from public.${quoteIdent(sequence)}`,
  );
  const row = r.rows[0]!;
  return { lastValue: Number(row.last_value), isCalled: row.is_called };
}

async function maxOf(
  client: ClientBase,
  table: string,
  column: string,
): Promise<number | null> {
  const r = await client.query<{ max: string | null }>(
    `select max(${quoteIdent(column)})::text as max from ${quoteIdent(table)}`,
  );
  return r.rows[0]?.max == null ? null : Number(r.rows[0].max);
}

/**
 * The value each sequence must hold (with is_called = true) so nextval
 * never hands out an id either side has already used: the greatest of the
 * target's last value, the source's last value and max(id).
 */
async function planSequences(
  source: ClientBase,
  target: ClientBase,
  maxFrom: ClientBase,
): Promise<CarryBackSequenceReport[]> {
  const out: CarryBackSequenceReport[] = [];
  for (const seq of await ownedSequences(
    target,
    BASELINE_TABLES.map((t) => t.table),
  )) {
    const t = await sequenceUsed(target, seq.sequence);
    const s = await sequenceUsed(source, seq.sequence);
    const max = await maxOf(maxFrom, seq.table, seq.column);
    const candidates: number[] = [];
    if (t?.isCalled) candidates.push(t.lastValue);
    if (s?.isCalled) candidates.push(s.lastValue);
    if (max !== null) candidates.push(max);
    if (candidates.length === 0) continue;
    const to = Math.max(...candidates);
    const from = t?.isCalled ? t.lastValue : null;
    if (from === to) continue;
    out.push({ sequence: seq.sequence, from, to });
  }
  return out;
}

interface BaselineFingerprint {
  tables: { table: string; rows: number; hash: string }[];
}

function parseBaseline(json: unknown): BaselineFingerprint | null {
  if (!json || typeof json !== "object") return null;
  const tables = (json as { tables?: unknown }).tables;
  if (!Array.isArray(tables)) return null;
  for (const t of tables) {
    if (
      !t ||
      typeof t.table !== "string" ||
      typeof t.hash !== "string" ||
      typeof t.rows !== "number"
    ) {
      return null;
    }
  }
  return { tables: tables as BaselineFingerprint["tables"] };
}

const ANCHOR_TABLE = `"switchover"."carry_back_done"`;

/**
 * The fingerprint the last successful carry-back recorded on the target,
 * and the copy marker (by its timestamp) it was carried back from. Read
 * without writing: safe in a dry run, and on a target that has never had
 * a carry-back (no `switchover` schema at all).
 */
async function readCarryBackAnchor(
  target: ClientBase,
): Promise<{ copyMarkedAt: string; fingerprint: BaselineFingerprint } | null> {
  const reg = await target.query<{ t: string | null }>(
    `select to_regclass($1)::text as t`,
    [ANCHOR_TABLE],
  );
  if (!reg.rows[0]?.t) return null;
  const r = await target.query<{ copy_marked_at: string; fp: unknown }>(
    `select copy_marked_at, target_fingerprint_json as fp from ${ANCHOR_TABLE} limit 1`,
  );
  const row = r.rows[0];
  const fp = row ? parseBaseline(row.fp) : null;
  return row && fp ? { copyMarkedAt: row.copy_marked_at, fingerprint: fp } : null;
}

async function writeCarryBackAnchor(
  target: ClientBase,
  copyMarkedAt: string,
  fp: unknown,
): Promise<void> {
  await target.query(`create schema if not exists "switchover"`);
  await target.query(
    `create table if not exists ${ANCHOR_TABLE} (
       id boolean primary key default true,
       created_at timestamptz not null default now(),
       copy_marked_at text not null,
       target_fingerprint_json jsonb not null,
       constraint carry_back_done_singleton check (id)
     )`,
  );
  await target.query(`delete from ${ANCHOR_TABLE}`);
  await target.query(
    `insert into ${ANCHOR_TABLE} (id, copy_marked_at, target_fingerprint_json)
     values (true, $1, $2::jsonb)`,
    [copyMarkedAt, JSON.stringify(fp)],
  );
}

async function rollbackQuietly(client: ClientBase): Promise<void> {
  try {
    await client.query("rollback");
  } catch {
    // The connection may already be broken; the transaction dies with it.
  }
}

export async function carryBack(
  source: ClientBase,
  target: ClientBase,
  opts: CarryBackOptions = {},
): Promise<CarryBackReport> {
  const apply = opts.apply === true;
  // One consistent snapshot of Neon for the whole run, read-only whatever
  // the connection allows.
  await source.query("begin isolation level repeatable read read only");
  try {
    await target.query(
      apply ? "begin" : "begin isolation level repeatable read read only",
    );
    try {
      const report = await carryBackInTransaction(source, target, apply);
      if (apply) await target.query("commit");
      else await rollbackQuietly(target);
      return report;
    } catch (err) {
      await rollbackQuietly(target);
      throw err;
    }
  } finally {
    await rollbackQuietly(source);
  }
}

async function carryBackInTransaction(
  source: ClientBase,
  target: ClientBase,
  apply: boolean,
): Promise<CarryBackReport> {
  if (apply) await target.query("set local lock_timeout = '30s'");

  // 1. The right two databases.
  if ((await databaseIdentity(source)) === (await databaseIdentity(target))) {
    throw new CarryBackRefusedError(
      "The source and target are the same database. Refusing.",
    );
  }
  const sourceMarkers = await readMarkers(source);
  if (!sourceMarkers.cutoverDone && !sourceMarkers.rehearsalMarked) {
    throw new CarryBackRefusedError(
      "The source has no switchover marker, so it isn't a Neon copy of the old database. Refusing.",
    );
  }
  const targetMarkers = await readMarkers(target);
  if (targetMarkers.cutoverDone) {
    throw new CarryBackRefusedError(
      "The target has switchover.cutover_done: it's a cut-over Neon branch, not the old database. Refusing.",
    );
  }

  // 2. The target's schema must be the baseline: every column it has must
  // exist on the source (R0, test 5). Source columns it lacks are dropped.
  const plans: TablePlan[] = [];
  const droppedColumns: CarryBackReport["droppedColumns"] = [];
  for (const t of BASELINE_TABLES) {
    const tgt = await tableColumns(target, t.table);
    const src = await tableColumns(source, t.table);
    if (!tgt) {
      throw new CarryBackRefusedError(
        `The target has no table "${t.table}", so it isn't at the baseline schema. Refusing (R0).`,
      );
    }
    if (!src) {
      throw new CarryBackRefusedError(
        `The source has no table "${t.table}". Refusing (R0).`,
      );
    }
    const srcNames = new Set(src.map((c) => c.name));
    const extra = tgt.filter((c) => !srcNames.has(c.name)).map((c) => c.name);
    if (extra.length) {
      throw new CarryBackRefusedError(
        `The target has column(s) the source lacks (${t.table}: ${extra.join(", ")}), so the old schema isn't the baseline. Refusing (R0).`,
      );
    }
    const tgtNames = new Set(tgt.map((c) => c.name));
    const dropped = src.filter((c) => !tgtNames.has(c.name)).map((c) => c.name);
    if (dropped.length) droppedColumns.push({ table: t.table, columns: dropped });
    plans.push({
      table: t.table,
      primaryKey: t.primaryKey,
      columns: tgt,
      inserts: [],
      updates: [],
      deletes: [],
      pkTexts: new Map(),
    });
  }

  // 3. Hold off the old app's writes for the rest of the transaction.
  if (apply) {
    await target.query(
      `lock table ${BASELINE_TABLES.map((t) => quoteIdent(t.table)).join(", ")} in exclusive mode`,
    );
  }

  // The same canonical session settings as every fingerprint, on both sides
  // and for the rest of both transactions: equal values hash equal whatever
  // each server's defaults, and are written back exactly.
  await applyCanonicalSettings(source);
  await applyCanonicalSettings(target);

  // 4. What the target looks like now, against the copy's fingerprint.
  // A table passes if it matches the copy's fingerprint, or the fingerprint
  // the last successful carry-back recorded on the target (its own writes),
  // but only an anchor recorded against this same copy.
  const baseline = parseBaseline(sourceMarkers.sourceFingerprintJson);
  const changedSinceCopy = new Set<string>();
  if (baseline) {
    const anchor = await readCarryBackAnchor(target);
    const anchorTables =
      anchor && anchor.copyMarkedAt === sourceMarkers.markedAt
        ? new Map(anchor.fingerprint.tables.map((t) => [t.table, t]))
        : null;
    const now = await fingerprint(target, { inTransaction: true });
    const then = new Map(baseline.tables.map((t) => [t.table, t]));
    const same = (
      a: { hash: string; rows: number } | undefined,
      b: { hash: string; rows: number },
    ) => !!a && a.hash === b.hash && a.rows === b.rows;
    for (const t of now.tables) {
      if (same(then.get(t.table), t)) continue;
      if (anchorTables && same(anchorTables.get(t.table), t)) continue;
      changedSinceCopy.add(t.table);
    }
  }

  // 5. The differences, by primary key.
  for (const plan of plans) {
    const names = plan.columns.map((c) => c.name);
    const src = await rowKeys(source, plan.table, plan.primaryKey, names);
    const tgt = await rowKeys(target, plan.table, plan.primaryKey, names);
    for (const [key, s] of src) {
      const t = tgt.get(key);
      if (!t) plan.inserts.push(key);
      else if (t.hash !== s.hash) plan.updates.push(key);
      else continue;
      plan.pkTexts.set(key, s.pk);
    }
    for (const [key, t] of tgt) {
      if (!src.has(key)) {
        plan.deletes.push(key);
        plan.pkTexts.set(key, t.pk);
      }
    }
    sortKeys(plan.inserts);
    sortKeys(plan.updates);
    sortKeys(plan.deletes);
  }

  const touched = plans.filter(
    (p) => p.inserts.length + p.updates.length + p.deletes.length > 0,
  );
  const changedTables = touched
    .map((p) => p.table)
    .filter((t) => changedSinceCopy.has(t));
  const baselineStatus: BaselineStatus = !baseline
    ? "missing"
    : changedTables.length
      ? "changed"
      : "ok";

  // 6. Tables with no home in the old database.
  const targetTables = new Set(await publicTables(target));
  const noHomeRows: Record<string, number> = {};
  for (const table of await publicTables(source)) {
    if (targetTables.has(table)) continue;
    const r = await source.query<{ n: string }>(
      `select count(*)::bigint as n from ${quoteIdent(table)}`,
    );
    const n = Number(r.rows[0]!.n);
    if (n > 0) noHomeRows[table] = n;
  }

  const report: CarryBackReport = {
    tables: plans.map((p) => ({
      table: p.table,
      toInsert: p.inserts.map((k) => pkValue(p, k)),
      toUpdate: p.updates.map((k) => pkValue(p, k)),
      toDelete: p.deletes.map((k) => pkValue(p, k)),
    })),
    noHomeInTarget: Object.keys(noHomeRows),
    noHomeRows,
    droppedColumns,
    sequences: [],
    baseline: { status: baselineStatus, changedTables },
    applied: false,
  };

  if (!apply) {    report.sequences = await planSequences(source, target, source);
    return report;
  }

  if (baselineStatus === "missing") {
    throw new CarryBackRefusedError(
      "The source's switchover marker has no stored copy fingerprint, so there's no proof the old database is unchanged since the copy. Refusing to apply.",
    );
  }
  if (baselineStatus === "changed") {
    throw new CarryBackRefusedError(
      `The old database has changed since the copy in: ${changedTables.join(", ")}. ` +
        "Its new rows could share ids with testers' rows on Neon, and mirroring would overwrite or delete them. " +
        "Refusing to apply: recover these by hand (plan F.3).",
    );
  }

  // 7. Write: inserts and updates parents first, deletes children first.
  await target.query("set constraints all deferred");
  // Unique indexes (the baseline's lower(name) and lower(username)) would
  // refuse any carry-back where a unique value moves between rows (a rename
  // plus a new row taking the old name, a swap): row by row, two rows
  // briefly share the value. So they're dropped for the writes and rebuilt
  // from their exact definitions afterwards, all inside this transaction.
  // A genuine violation in the end state fails the rebuild and rolls
  // everything back, index included.
  const indexesBefore = await indexDefinitions(target);
  const uniqueIndexes = await droppableUniqueIndexes(target);
  for (const ix of uniqueIndexes) {
    await target.query(`drop index public.${quoteIdent(ix.name)}`);
  }
  const order = await parentsFirst(target);
  const byTable = new Map(plans.map((p) => [p.table, p]));
  for (const table of order) {
    const plan = byTable.get(table)!;
    if (plan.inserts.length + plan.updates.length === 0) continue;
    await writeRows(source, target, plan);
  }
  for (const table of [...order].reverse()) {
    const plan = byTable.get(table)!;
    for (const key of plan.deletes) {
      const pk = plan.pkTexts.get(key)!;
      const where = pkWhere(plan, 1);
      await target.query(`delete from ${quoteIdent(plan.table)} where ${where}`, pk);
    }
  }

  for (const ix of uniqueIndexes) {
    await target.query(ix.definition);
  }

  // 8. Sequences past every id either side has used.
  report.sequences = await planSequences(source, target, target);
  for (const s of report.sequences) {
    await target.query(`select setval($1::regclass, $2, true)`, [
      `public.${quoteIdent(s.sequence)}`,
      s.to,
    ]);
  }

  // 9. Commit only if the target now matches Neon's projection exactly.
  const diffs = (
    await compare(source, target, {
      projected: true,
      onto: "target",
      inTransaction: true,
    })
  ).filter((d) => d.kind !== "sequence");
  diffs.push(...(await sequencesBehind(source, target)));
  // The projected compare skips the schema signature, so check directly
  // that every index on the nine tables is back exactly as it was.
  const indexesAfter = await indexDefinitions(target);
  if (JSON.stringify(indexesAfter) !== JSON.stringify(indexesBefore)) {
    diffs.push({
      kind: "index",
      detail: `the target's indexes changed during the writes (before: ${indexesBefore.length}, after: ${indexesAfter.length})`,
    });
  }
  if (diffs.length) {
    throw new CarryBackVerifyError(
      `After the writes, the target still differs from the source (${diffs
        .map((d) => `${d.kind}: ${d.detail}`)
        .join("; ")}). Rolled back; nothing changed.`,
      diffs,
    );
  }

  // 10. Record what this carry-back left behind, as part of the approved
  // write, so a later pass (testers wrote again on Neon before the
  // rollback finished) can tell carry-back's own changes from anyone
  // else's. It lives in the `switchover` schema, outside `public`, so the
  // old app, its schema signature and later copies (pg_dump -n public)
  // never see it.
  await writeCarryBackAnchor(
    target,
    sourceMarkers.markedAt!,
    await fingerprint(target, { inTransaction: true }),
  );

  report.applied = true;
  return report;
}

/** Every index definition on the nine tables, sorted. */
async function indexDefinitions(client: ClientBase): Promise<string[]> {
  const r = await client.query<{ d: string }>(
    `select pg_get_indexdef(i.indexrelid) as d
       from pg_index i
       join pg_class c on c.oid = i.indrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any($1)
      order by 1`,
    [BASELINE_TABLES.map((t) => t.table)],
  );
  return r.rows.map((row) => row.d);
}

/**
 * The unique indexes on the nine tables that aren't a primary key and don't
 * back a constraint (those can't be dropped with DROP INDEX; the baseline
 * has none besides the primary keys), with their exact definitions.
 */
async function droppableUniqueIndexes(
  client: ClientBase,
): Promise<{ name: string; definition: string }[]> {
  const r = await client.query<{ name: string; definition: string }>(
    `select ic.relname as name, pg_get_indexdef(i.indexrelid) as definition
       from pg_index i
       join pg_class ic on ic.oid = i.indexrelid
       join pg_class c on c.oid = i.indrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any($1)
        and i.indisunique and not i.indisprimary
        and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
      order by 1`,
    [BASELINE_TABLES.map((t) => t.table)],
  );
  return r.rows;
}

/**
 * The sequence half of the final check. The target's sequences must be
 * past max(id) and at least where the source's are, so the old app's next
 * insert can't reuse an id. (compare's own sequence check wants the two
 * last values equal, which would refuse a harmless case: the old database's
 * sequence having moved on, with no row to show for it, since the copy.)
 */
async function sequencesBehind(
  source: ClientBase,
  target: ClientBase,
): Promise<CompareDiff[]> {
  const out: CompareDiff[] = [];
  for (const seq of await ownedSequences(
    target,
    BASELINE_TABLES.map((t) => t.table),
  )) {
    const t = await sequenceUsed(target, seq.sequence);
    const s = await sequenceUsed(source, seq.sequence);
    const max = await maxOf(target, seq.table, seq.column);
    const used = t?.isCalled ? t.lastValue : null;
    const needs = Math.max(
      max ?? -Infinity,
      s?.isCalled ? s.lastValue : -Infinity,
    );
    if (needs === -Infinity) continue;
    if (used === null || used < needs) {
      out.push({
        kind: "sequence",
        detail: `${seq.sequence}: target last_value=${used} but ids up to ${needs} are used`,
      });
    }
  }
  return out;
}

function pkWhere(plan: TablePlan, firstParam: number): string {
  return plan.primaryKey
    .map((name, i) => {
      const type = plan.columns.find((c) => c.name === name)!.type;
      return `${quoteIdent(name)} = $${firstParam + i}::${type}`;
    })
    .join(" and ");
}

/**
 * Inserts and updates one table's rows, reading the source's values as text
 * and casting each back through the target column's own type, so every
 * value (timestamps to the microsecond, floats, enums, photo data) arrives
 * exactly.
 */
async function writeRows(
  source: ClientBase,
  target: ClientBase,
  plan: TablePlan,
): Promise<void> {
  const cols = plan.columns;
  const select = cols
    // projectedColumnExpr: a removed photo (SYC-462) is written as an empty picture.
    .map((c, i) => `${projectedColumnExpr(plan.table, c.name)}::text as "c${i}"`)
    .join(", ");
  const pkSelect = plan.primaryKey
    .map((c, i) => `t.${quoteIdent(c)}::text as "k${i}"`)
    .join(", ");
  // Only the rows being inserted or updated, matched by their key text.
  const wanted = [...plan.inserts, ...plan.updates].map(
    (k) => plan.pkTexts.get(k)!,
  );
  if (wanted.length === 0) return;
  const keyTuple = plan.primaryKey
    .map((c) => `t.${quoteIdent(c)}::text`)
    .join(", ");
  const unnestArgs = plan.primaryKey.map((_, i) => `$${i + 1}::text[]`).join(", ");
  const r = await source.query<Record<string, string | null>>(
    `select ${pkSelect}, ${select} from ${quoteIdent(plan.table)} t
      where (${keyTuple}) in (select * from unnest(${unnestArgs}))`,
    plan.primaryKey.map((_, i) => wanted.map((pk) => pk[i]!)),
  );
  const rows = new Map<string, (string | null)[]>();
  for (const row of r.rows) {
    const key = JSON.stringify(plan.primaryKey.map((_, i) => row[`k${i}`]));
    rows.set(
      key,
      cols.map((_, i) => row[`c${i}`] ?? null),
    );
  }

  const insertSql = `insert into ${quoteIdent(plan.table)} (${cols
    .map((c) => quoteIdent(c.name))
    .join(", ")}) values (${cols.map((c, i) => `$${i + 1}::${c.type}`).join(", ")})`;
  for (const key of plan.inserts) {
    await target.query(insertSql, rows.get(key)!);
  }

  const pkSet = new Set(plan.primaryKey);
  const setCols = cols.filter((c) => !pkSet.has(c.name));
  if (setCols.length === 0) return;
  const updateSql = `update ${quoteIdent(plan.table)} set ${setCols
    .map((c, i) => `${quoteIdent(c.name)} = $${i + 1}::${c.type}`)
    .join(", ")} where ${pkWhere(plan, setCols.length + 1)}`;
  for (const key of plan.updates) {
    const values = rows.get(key)!;
    const setValues = setCols.map((c) => values[cols.indexOf(c)]!);
    const res = await target.query(updateSql, [
      ...setValues,
      ...plan.pkTexts.get(key)!,
    ]);
    if (res.rowCount !== 1) {
      throw new Error(
        `carry-back: updating ${plan.table} ${printablePk(pkValue(plan, key))} touched ${res.rowCount} rows, expected 1.`,
      );
    }
  }
}

/** A text key never printed as is: device ids appear as a short hash. */
function printablePk(value: PkValue): string {
  const one = (v: number | string) =>
    typeof v === "number"
      ? String(v)
      : `#${createHash("sha256").update(v).digest("hex").slice(0, 12)}`;
  if (typeof value === "object") {
    return `(${Object.entries(value)
      .map(([k, v]) => `${k}=${one(v)}`)
      .join(", ")})`;
  }
  return one(value);
}

/**
 * The human-readable report Samuel reads before saying "apply" (F.2 step
 * 3). Ids only: never row contents, never a connection string, and text
 * keys (device ids) only as a short one-way hash.
 */
export function formatCarryBackReport(report: CarryBackReport): string {
  const lines: string[] = [];
  lines.push(
    report.applied
      ? "carry-back: APPLIED. The old database now matches Neon (projected)."
      : "carry-back: DRY RUN. Nothing was written.",
  );
  const b = report.baseline;
  lines.push(
    b.status === "ok"
      ? "Old database unchanged since the copy (where carry-back writes): ok."
      : b.status === "missing"
        ? "WARNING: no copy fingerprint stored on Neon, so apply will refuse."
        : `WARNING: the old database changed since the copy in ${b.changedTables.join(", ")}. Apply will refuse; recover by hand (F.3).`,
  );
  lines.push("Text keys (device ids) are shown as a short one-way hash (#...).");
  lines.push("");
  let total = 0;
  for (const t of report.tables) {
    const n = t.toInsert.length + t.toUpdate.length + t.toDelete.length;
    total += n;
    lines.push(
      `${t.table}: ${t.toInsert.length} insert, ${t.toUpdate.length} update, ${t.toDelete.length} delete`,
    );
    const list = (label: string, ids: PkValue[]) => {
      if (ids.length) lines.push(`  ${label}: ${ids.map(printablePk).join(", ")}`);
    };
    list("insert", t.toInsert);
    list("update", t.toUpdate);
    list("delete", t.toDelete);
  }
  lines.push(`Total rows: ${total}`);
  lines.push("");
  if (report.sequences.length) {
    lines.push("Sequences:");
    for (const s of report.sequences) {
      lines.push(`  ${s.sequence}: ${s.from ?? "unused"} -> ${s.to} (next id ${s.to + 1})`);
    }
  } else {
    lines.push("Sequences: no change needed.");
  }
  if (report.droppedColumns.length) {
    lines.push(
      "Columns Neon has and the old database lacks (their values stay on Neon only):",
    );
    for (const d of report.droppedColumns) {
      lines.push(`  ${d.table}: ${d.columns.join(", ")}`);
    }
  }
  if (report.noHomeInTarget.length) {
    lines.push("No home in the old database (these rows stay on Neon, which is kept):");
    for (const t of report.noHomeInTarget) {
      lines.push(`  ${t}: ${report.noHomeRows[t]} row(s)`);
    }
  } else {
    lines.push("No home in the old database: none.");
  }
  return lines.join("\n");
}
