import type { ClientBase } from "pg";

/**
 * A schema's shape as a sorted list of lines, one per object, each starting
 * with its kind: table (persistence, row security), column (type with length,
 * precision and scale, collation, nullability, default, identity, generated
 * expression, domain), index (definition and validity), constraint, enum,
 * sequence, view, trigger and function.
 *
 * Used to prove a live database matches the baseline before adopting it, and
 * that a rollback restores the schema it started from. It covers what this
 * app's schema uses and the usual ways a hand edit drifts from it; it is not
 * a full catalogue diff (privileges, comments, statistics and extensions are
 * not compared).
 *
 * Schema names are stripped from every definition so a schema built under a
 * scratch name compares equal to the same schema built in `public`.
 */
export async function schemaSignature(
  client: ClientBase,
  schema: string,
): Promise<string[]> {
  const strip = (s: string | null) =>
    s === null
      ? "null"
      : s.split(`"${schema}".`).join("").split(`${schema}.`).join("");

  const lines: string[] = [];

  const tables = await client.query<{
    relname: string;
    relpersistence: string;
    relrowsecurity: boolean;
  }>(
    `select cl.relname, cl.relpersistence, cl.relrowsecurity
       from pg_class cl
       join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = $1 and cl.relkind in ('r', 'p')`,
    [schema],
  );
  for (const t of tables.rows) {
    lines.push(
      `table ${t.relname} persistence=${t.relpersistence} rls=${t.relrowsecurity}`,
    );
  }

  const columns = await client.query<Record<string, string | null>>(
    `select c.table_name, c.column_name, c.data_type, c.udt_name,
            c.character_maximum_length, c.numeric_precision, c.numeric_scale,
            c.datetime_precision, c.collation_name, c.is_nullable,
            c.column_default, c.is_identity, c.identity_generation,
            c.is_generated, c.generation_expression, c.domain_name
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = $1 and t.table_type = 'BASE TABLE'`,
    [schema],
  );
  for (const c of columns.rows) {
    lines.push(
      `column ${c.table_name}.${c.column_name} ${c.data_type}/${c.udt_name}` +
        ` len=${c.character_maximum_length} prec=${c.numeric_precision}` +
        ` scale=${c.numeric_scale} tprec=${c.datetime_precision}` +
        ` collation=${c.collation_name} nullable=${c.is_nullable}` +
        ` default=${strip(c.column_default)}` +
        ` identity=${c.is_identity}/${c.identity_generation}` +
        ` generated=${c.is_generated}/${strip(c.generation_expression)}` +
        ` domain=${c.domain_name}`,
    );
  }

  const indexes = await client.query<{
    indexname: string;
    indexdef: string;
    indisvalid: boolean;
  }>(
    `select i.indexname, i.indexdef, x.indisvalid
       from pg_indexes i
       join pg_class ic on ic.relname = i.indexname
       join pg_namespace n on n.oid = ic.relnamespace and n.nspname = i.schemaname
       join pg_index x on x.indexrelid = ic.oid
      where i.schemaname = $1`,
    [schema],
  );
  for (const i of indexes.rows) {
    lines.push(
      `index ${i.indexname} ${strip(i.indexdef)} valid=${i.indisvalid}`,
    );
  }

  const constraints = await client.query<{
    relname: string;
    conname: string;
    contype: string;
    def: string;
  }>(
    `select cl.relname, con.conname, con.contype,
            pg_get_constraintdef(con.oid) as def
       from pg_constraint con
       join pg_class cl on cl.oid = con.conrelid
       join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = $1`,
    [schema],
  );
  for (const c of constraints.rows) {
    lines.push(
      `constraint ${c.relname}.${c.conname} ${c.contype} ${strip(c.def)}`,
    );
  }

  const enums = await client.query<{ typname: string; labels: string[] }>(
    `select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
       from pg_type t
       join pg_enum e on e.enumtypid = t.oid
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = $1
      group by t.typname`,
    [schema],
  );
  for (const e of enums.rows) {
    lines.push(`enum ${e.typname} (${e.labels.join(", ")})`);
  }

  const sequences = await client.query<Record<string, string>>(
    `select sequencename, data_type::text, start_value::text, increment_by::text,
            min_value::text, max_value::text, cycle::text
       from pg_sequences where schemaname = $1`,
    [schema],
  );
  for (const s of sequences.rows) {
    lines.push(
      `sequence ${s.sequencename} ${s.data_type} start=${s.start_value}` +
        ` by=${s.increment_by} min=${s.min_value} max=${s.max_value} cycle=${s.cycle}`,
    );
  }

  const views = await client.query<{ viewname: string; definition: string }>(
    `select viewname, definition from pg_views where schemaname = $1`,
    [schema],
  );
  for (const v of views.rows) {
    lines.push(
      `view ${v.viewname} ${strip(v.definition).replace(/\s+/g, " ")}`,
    );
  }

  const triggers = await client.query<{
    relname: string;
    tgname: string;
    def: string;
  }>(
    `select cl.relname, tg.tgname, pg_get_triggerdef(tg.oid) as def
       from pg_trigger tg
       join pg_class cl on cl.oid = tg.tgrelid
       join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = $1 and not tg.tgisinternal`,
    [schema],
  );
  for (const t of triggers.rows) {
    lines.push(`trigger ${t.relname}.${t.tgname} ${strip(t.def)}`);
  }

  const functions = await client.query<{ proname: string; def: string }>(
    `select p.proname, pg_get_functiondef(p.oid) as def
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $1 and p.prokind = 'f'`,
    [schema],
  );
  for (const f of functions.rows) {
    // One line per function; the body's whitespace is not part of its shape.
    lines.push(`function ${f.proname} ${strip(f.def).replace(/\s+/g, " ")}`);
  }

  return lines.sort();
}

/**
 * The kinds of object Drizzle's schema code describes. Triggers, functions
 * and views come only from hand-written migration SQL, so they are left out
 * when comparing the migrations with what the schema code alone would build.
 */
const MODELLED = /^(table|column|index|constraint|enum|sequence) /;

/**
 * A constraint trigger (CREATE CONSTRAINT TRIGGER, e.g. migration 0053's
 * deferred cat_identity check) is listed in pg_constraint with type `t`, but
 * it is a trigger: only migration SQL can make it, and it is compared with
 * the triggers.
 */
const CONSTRAINT_TRIGGER = /^constraint \S+ t /;

export function modelledOnly(signature: string[]): string[] {
  return signature.filter((l) => MODELLED.test(l) && !CONSTRAINT_TRIGGER.test(l));
}

/** Lines present in one signature and not the other, labelled by side. */
export function signatureDiff(
  actual: string[],
  expected: string[],
  labels: { actual: string; expected: string },
): string[] {
  const a = new Set(actual);
  const e = new Set(expected);
  return [
    ...actual
      .filter((l) => !e.has(l))
      .map((l) => `only in ${labels.actual}: ${l}`),
    ...expected
      .filter((l) => !a.has(l))
      .map((l) => `only in ${labels.expected}: ${l}`),
  ];
}
